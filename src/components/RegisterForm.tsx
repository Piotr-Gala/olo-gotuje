"use client";

import { useActionState } from "react";
import Link from "next/link";
import { register, type RegisterState } from "@/app/register/actions";

export function RegisterForm() {
  const initialState: RegisterState = {};
  const [state, formAction, pending] = useActionState(register, initialState);

  return <main className="gate"><form className="gate-card login-card register-card" action={formAction}>
    <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
    <p className="eyebrow">Rodzinna strona</p>
    <h1>Dołącz do nas</h1>
    <p>Utwórz konto. Dostęp do wpisów włączy administrator.</p>
    <div className="form-grid">
      <label>Imię<input name="first_name" autoComplete="given-name" required maxLength={80} /></label>
      <label>Nazwisko<input name="last_name" autoComplete="family-name" required maxLength={100} /></label>
      <label className="form-wide">Nick<input name="nickname" autoComplete="nickname" required maxLength={40} /></label>
      <label className="form-wide">Data urodzenia<input name="birth_date" type="date" autoComplete="bday" required /></label>
      <label className="form-wide">E-mail<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="form-wide">Hasło<input name="password" type="password" autoComplete="new-password" required minLength={8} /><span>Minimum 8 znaków.</span></label>
    </div>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.message && <p className="form-success" role="status">{state.message}</p>}
    <button className="button orange submit-button" disabled={pending}>{pending ? "Tworzenie konta…" : "Utwórz konto"}</button>
    <small>Masz już konto? <Link className="auth-link" href="/login">Zaloguj się</Link></small>
  </form></main>;
}
