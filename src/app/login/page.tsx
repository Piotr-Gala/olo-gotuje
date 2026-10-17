import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/");
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect("/");
  return <LoginForm />;
}
