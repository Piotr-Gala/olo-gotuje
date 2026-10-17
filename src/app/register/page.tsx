import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/RegisterForm";
import { createClient } from "@/lib/supabase/server";

export default async function RegisterPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/");
  return <RegisterForm />;
}
