import type { SupabaseClient } from "@supabase/supabase-js";

export async function changeOwnPassword(
  supabase: SupabaseClient,
  currentPassword: string,
  newPassword: string,
  repeatPassword: string,
) {
  if (!currentPassword) return "currentPasswordRequired";
  if (newPassword.length < 8 || newPassword.length > 4096) return "passwordShort";
  if (newPassword !== repeatPassword) return "passwordMismatch";
  if (newPassword === currentPassword) return "passwordUnchanged";

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email) return "passwordChangeFailed";

  // Verify the old password even when Auth does not require current_password.
  // Signing in also creates a recent session without relying on an email nonce.
  const { data, error } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (error || data.user?.id !== user.id) return "currentPasswordInvalid";
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword });
  if (updateError) return updateError.code === "weak_password" ? "weakPassword" : "passwordChangeFailed";
  return "passwordChanged";
}
