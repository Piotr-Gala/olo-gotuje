"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type RegisterState = {
  error?: string;
  message?: string;
};

export async function register(_previousState: RegisterState, formData: FormData): Promise<RegisterState> {
  const firstName = readText(formData, "first_name").trim();
  const lastName = readText(formData, "last_name").trim();
  const nickname = readText(formData, "nickname").trim();
  const birthDate = readText(formData, "birth_date");
  const email = readText(formData, "email").trim();
  const password = readText(formData, "password");

  if (!firstName || !lastName || !nickname || !birthDate || !email || !password) {
    return { error: "Uzupełnij wszystkie pola." };
  }
  if (firstName.length > 80 || lastName.length > 100 || nickname.length > 40 || email.length > 254) {
    return { error: "Jedno z pól przekracza dozwoloną długość." };
  }
  if (password.length < 8) {
    return { error: "Hasło musi mieć co najmniej 8 znaków." };
  }
  if (!isCalendarDate(birthDate)) {
    return { error: "Podaj prawidłową datę urodzenia." };
  }
  if (birthDate > new Date().toISOString().slice(0, 10)) {
    return { error: "Data urodzenia nie może być w przyszłości." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Brakuje konfiguracji Supabase na serwerze." };

  const requestOrigin = (await headers()).get("origin");
  let emailRedirectTo: string | undefined;
  if (requestOrigin) {
    try {
      emailRedirectTo = new URL(requestOrigin).origin;
    } catch {
      emailRedirectTo = undefined;
    }
  }

  let signupData;
  let signupError;
  try {
    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          nickname,
          birth_date: birthDate,
          display_name: nickname,
        },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
    signupData = result.data;
    signupError = result.error;
  } catch {
    return { error: "Nie udało się połączyć z Supabase. Sprawdź połączenie i spróbuj ponownie." };
  }

  if (signupError) {
    const details = `${signupError.code ?? ""} ${signupError.message}`.toLowerCase();
    if (details.includes("already registered") || details.includes("user_already_exists")) {
      return { error: "Konto z tym adresem e-mail już istnieje. Zaloguj się." };
    }
    if (details.includes("rate limit")) {
      return { error: "Wysłano za dużo próśb naraz. Odczekaj chwilę i spróbuj ponownie." };
    }
    if (details.includes("signups not allowed") || details.includes("signup is disabled")) {
      return { error: "Rejestracja jest wyłączona w ustawieniach Supabase." };
    }
    if (details.includes("password") || details.includes("weak_password")) {
      return { error: "Hasło nie spełnia wymagań Supabase. Ustaw inne hasło i spróbuj ponownie." };
    }
    if (details.includes("email") || details.includes("invalid_credentials")) {
      return { error: "Sprawdź adres e-mail i spróbuj ponownie." };
    }
    return { error: "Nie udało się utworzyć konta. Spróbuj ponownie za chwilę lub skontaktuj się z administratorem." };
  }

  if (signupData.session) redirect("/");

  return {
    message: "Konto utworzone. Sprawdź pocztę (również spam) i potwierdź adres e-mail. Potem zaloguj się — administrator zatwierdzi dostęp do strony.",
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
