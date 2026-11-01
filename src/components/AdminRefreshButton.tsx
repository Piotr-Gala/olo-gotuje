"use client";

import { useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";

export function AdminRefreshButton() {
  const { language } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);
  const label = translate(language, "adminRefresh");
  return <button className="admin-refresh" type="button" aria-label={label} title={label} disabled={refreshing} onClick={() => {
    setRefreshing(true);
    // Reload client state too: the feed keeps its own post and reaction state.
    window.location.reload();
  }}><span aria-hidden="true">↻</span></button>;
}
