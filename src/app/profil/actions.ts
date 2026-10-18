"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  if (cleanDisplayName.length < 1 || cleanDisplayName.length > 40 || cleanBio.length > 280) {
    redirect(`/profil/${userId}?status=error`);
  }

  const { error } = await supabase.rpc("update_my_family_profile", {
    p_display_name: cleanDisplayName,
    p_bio: cleanBio,
  });
  redirect(`/profil/${userId}?status=${error ? "error" : "updated"}`);
}
