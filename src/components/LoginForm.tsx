"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";

export function LoginForm() {
  const { language } = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
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
        ? t("emailNotConfirmed")
        : t("loginFailed"));
      setBusy(false);
      return;
    }
    window.location.assign("/");
  }

  return <main className="gate"><form className="gate-card login-card" onSubmit={submit}>
    <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
    <div className="language-row"><LanguageToggle /></div>
    <p className="eyebrow">{t("loginEyebrow")}</p><h1>{t("loginTitle")}</h1><p>{t("loginText")}</p>
    <label>{t("email")}<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>{t("password")}<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button orange submit-button" disabled={busy}>{busy ? t("loginBusy") : t("login")}</button>
    <small>{t("noAccount")} <Link className="auth-link" href="/register">{t("register")}</Link></small>
  </form></main>;
}
