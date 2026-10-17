"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function updateAccountApproval(accountId: string, formData: FormData) {
  const supabase = await requireAdmin();
  if (!accountIdPattern.test(accountId)) redirect("/admin?status=error");
  const isApproved = formData.get("approved") === "true";
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_approved: isApproved })
    .eq("id", accountId)
    .neq("role", "owner")
    .select("id")
    .maybeSingle();
  redirect(data && !error ? "/admin?status=updated" : "/admin?status=error");
}

export async function updateAccountRole(accountId: string, formData: FormData) {
  const supabase = await requireAdmin();
  if (!accountIdPattern.test(accountId)) redirect("/admin?status=error");
  const role = formData.get("role");
  if (role !== "member" && role !== "admin") redirect("/admin?status=error");
  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", accountId)
    .neq("role", "owner")
    .select("id")
    .maybeSingle();
  redirect(data && !error ? "/admin?status=updated" : "/admin?status=error");
}

async function requireAdmin() {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_approved")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.role !== "admin" || !profile.is_approved) redirect("/");
  return supabase;
}
