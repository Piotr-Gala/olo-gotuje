import { createClient } from "@/lib/supabase/server";
import { AdminRefreshButton } from "./AdminRefreshButton";

export async function AdminRefresh() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") return null;
  const { data: profile } = await supabase.from("profiles").select("role,is_approved").eq("id", userId).maybeSingle();
  return profile?.role === "admin" && profile.is_approved ? <AdminRefreshButton/> : null;
}
