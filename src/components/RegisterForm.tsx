"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { register, type RegisterState } from "@/app/register/actions";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";

export function RegisterForm() {
  const { language } = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const initialState: RegisterState = {};
  const [state, formAction, pending] = useActionState(register, initialState);
  const [fields, setFields] = useState({ first_name: "", last_name: "", nickname: "", birth_date: "", email: "" });
  const updateField = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.currentTarget;
    setFields((current) => ({ ...current, [name]: value }));
  };

  return <main className="gate"><form className="gate-card login-card register-card" action={formAction}>
    <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
    <div className="language-row"><LanguageToggle /></div>
    <p className="eyebrow">{t("registerEyebrow")}</p>
    <h1>{t("registerTitle")}</h1>
    <p>{t("registerText")}</p>
    <input type="hidden" name="language" value={language} />
    <div className="form-grid">
      <label>{t("firstName")}<input name="first_name" autoComplete="given-name" required maxLength={80} value={fields.first_name} onChange={updateField} /></label>
      <label>{t("lastName")}<input name="last_name" autoComplete="family-name" required maxLength={100} value={fields.last_name} onChange={updateField} /></label>
      <label className="form-wide">{t("nickname")}<input name="nickname" autoComplete="nickname" required maxLength={40} value={fields.nickname} onChange={updateField} /></label>
      <label className="form-wide">{t("birthDate")}<input name="birth_date" type="date" autoComplete="bday" required value={fields.birth_date} onChange={updateField} /></label>
      <label className="form-wide">{t("email")}<input name="email" type="email" autoComplete="email" required maxLength={254} value={fields.email} onChange={updateField} /></label>
      <label className="form-wide">{t("password")}<input name="password" type="password" autoComplete="new-password" required minLength={8} /><span>{t("minPassword")}</span></label>
    </div>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.message && <p className="form-success" role="status">{state.message}</p>}
    <button className="button orange submit-button" disabled={pending}>{pending ? t("createAccountBusy") : t("createAccount")}</button>
    <small>{t("hasAccount")} <Link className="auth-link" href="/login">{t("login")}</Link></small>
  </form></main>;
}
