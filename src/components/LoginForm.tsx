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
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const supabase = createClient();
    let authError;
    try {
      if (identifier.includes("@")) {
        ({ error: authError } = await supabase.auth.signInWithPassword({ email: identifier.trim(), password }));
      } else {
        const { data, error } = await supabase.functions.invoke("nickname-login", { body: { identifier: identifier.trim(), password } });
        if (error || !data?.access_token || !data?.refresh_token) authError = { code: "invalid_credentials", message: "Invalid credentials" };
        else ({ error: authError } = await supabase.auth.setSession(data));
      }
    } catch {
      authError = { code: "connection_failed", message: "Connection failed" };
    }
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
    <label>{t("emailOrNickname")}<input type="text" autoComplete="username" required maxLength={254} value={identifier} onChange={(e) => setIdentifier(e.target.value)} /></label>
    <label>{t("password")}<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button orange submit-button" disabled={busy}>{busy ? t("loginBusy") : t("login")}</button>
    <small>{t("noAccount")} <Link className="auth-link" href="/register">{t("register")}</Link></small>
  </form></main>;
}
