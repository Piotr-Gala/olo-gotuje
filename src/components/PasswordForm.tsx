"use client";

import { useActionState } from "react";
import { updateMyPassword } from "@/app/profil/actions";
import { translate, type Language } from "@/lib/i18n";

export function PasswordForm({ language }: { language: Language }) {
  const [state, action, pending] = useActionState(updateMyPassword, {});
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const success = state.message === "passwordChanged";
  return <details className="profile-edit password-settings">
    <summary><h2>{t("changePassword")}</h2></summary>
    <form action={action} className="profile-form">
      <label>{t("currentPassword")}<input type="password" name="current_password" autoComplete="current-password" required maxLength={4096}/></label>
      <label>{t("newPassword")}<input type="password" name="new_password" autoComplete="new-password" required minLength={8} maxLength={4096}/></label>
      <label>{t("repeatPassword")}<input type="password" name="repeat_password" autoComplete="new-password" required minLength={8} maxLength={4096}/></label>
      <small>{t("minPassword")}</small>
      {state.message && <p className={success ? "form-success" : "form-error"} role={success ? "status" : "alert"}>{t(state.message)}</p>}
      <button className="button orange" disabled={pending}>{t(pending ? "passwordChanging" : "changePassword")}</button>
    </form>
  </details>;
}
