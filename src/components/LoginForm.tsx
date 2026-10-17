"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
    if (authError) {
      const emailNotConfirmed = authError.code === "email_not_confirmed" || authError.message.toLowerCase().includes("email not confirmed");
      setError(emailNotConfirmed
        ? "Najpierw potwierdź adres e-mail, klikając link wysłany po rejestracji. Brak akceptacji administratora nie blokuje logowania."
        : "Nie udało się zalogować. Sprawdź email i hasło.");
      setBusy(false);
      return;
    }
    window.location.assign("/");
  }

  return <main className="gate"><form className="gate-card login-card" onSubmit={submit}>
    <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
    <p className="eyebrow">Tylko dla rodziny</p><h1>Miło cię widzieć!</h1><p>Zaloguj się, żeby zobaczyć rodzinne wpisy.</p>
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Hasło<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button orange submit-button" disabled={busy}>{busy ? "Logowanie…" : "Zaloguj się"}</button>
    <small>Nie masz jeszcze konta? <Link className="auth-link" href="/register">Zarejestruj się</Link></small>
  </form></main>;
}
