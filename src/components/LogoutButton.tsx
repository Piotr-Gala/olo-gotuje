"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { translate, type Language } from "@/lib/i18n";

export function LogoutButton({ language }: { language: Language }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.assign("/login");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return <div><button className="text-button" type="button" disabled={busy} onClick={() => void logout()}>{translate(language, "logout")}</button>{failed && <p className="form-error" role="alert">{translate(language, "logoutFailed")}</p>}</div>;
}
