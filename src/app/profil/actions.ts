"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { changeOwnPassword } from "@/lib/account-password";
import type { MessageKey } from "@/lib/i18n";

export async function updateMyPassword(_previous: { message?: MessageKey }, formData: FormData): Promise<{ message?: MessageKey }> {
  const supabase = await createClient();
  if (!supabase) return { message: "passwordChangeFailed" };
  const currentPassword = formData.get("current_password");
  const newPassword = formData.get("new_password");
  const repeatPassword = formData.get("repeat_password");
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || typeof repeatPassword !== "string") {
    return { message: "passwordChangeFailed" };
  }
  try {
    return { message: await changeOwnPassword(supabase, currentPassword, newPassword, repeatPassword) };
  } catch {
    return { message: "passwordChangeFailed" };
  }
}

export async function updateMyFamilyProfile(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const displayName = formData.get("display_name");
  const bio = formData.get("bio");
  if (typeof displayName !== "string" || typeof bio !== "string") redirect(`/profil/${userId}?status=error`);
  const cleanDisplayName = displayName.trim();
  const cleanBio = bio.trim();
  if (cleanDisplayName.length < 1 || cleanDisplayName.length > 40 || /[@\u0000-\u001f\u007f]/.test(cleanDisplayName) || cleanBio.length > 280) {
    redirect(`/profil/${userId}?status=error`);
  }

  const { error } = await supabase.rpc("update_my_family_profile", {
    p_display_name: cleanDisplayName,
    p_bio: cleanBio,
  });
  redirect(`/profil/${userId}?status=${error?.code === "23505" ? "nickname-taken" : error ? "error" : "updated"}`);
}
