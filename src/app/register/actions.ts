"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translate, type Language, type MessageKey } from "@/lib/i18n";

export type RegisterState = {
  error?: string;
  message?: string;
};

export async function register(_previousState: RegisterState, formData: FormData): Promise<RegisterState> {
  const language: Language = formData.get("language") === "pl" ? "pl" : "en";
  const message = (key: MessageKey) => translate(language, key);
  const firstName = readText(formData, "first_name").trim();
  const lastName = readText(formData, "last_name").trim();
  const nickname = readText(formData, "nickname").trim();
  const birthDate = readText(formData, "birth_date");
  const email = readText(formData, "email").trim();
  const password = readText(formData, "password");

  if (!firstName || !lastName || !nickname || !birthDate || !email || !password) {
    return { error: message("requiredFields") };
  }
  if (firstName.length > 80 || lastName.length > 100 || nickname.length > 40 || email.length > 254) {
    return { error: message("tooLong") };
  }
  if (password.length < 8) {
    return { error: message("passwordShort") };
  }
  if (!isCalendarDate(birthDate)) {
    return { error: message("invalidBirthDate") };
  }
  if (birthDate > new Date().toISOString().slice(0, 10)) {
    return { error: message("futureBirthDate") };
  }

  const supabase = await createClient();
  if (!supabase) return { error: message("missingSupabase") };

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
    return { error: message("connectionFailed") };
  }

  if (signupError) {
    const details = `${signupError.code ?? ""} ${signupError.message}`.toLowerCase();
    if (details.includes("already registered") || details.includes("user_already_exists")) {
      return { error: message("accountExists") };
    }
    if (details.includes("rate limit")) {
      return { error: message("rateLimit") };
    }
    if (details.includes("signups not allowed") || details.includes("signup is disabled")) {
      return { error: message("signupsDisabled") };
    }
    if (details.includes("password") || details.includes("weak_password")) {
      return { error: message("weakPassword") };
    }
    if (details.includes("email") || details.includes("invalid_credentials")) {
      return { error: message("invalidEmail") };
    }
    return { error: message("registerFailed") };
  }

  if (signupData.session) redirect("/");

  return {
    message: message("accountCreated"),
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
