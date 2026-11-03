import type { SupabaseClient } from "@supabase/supabase-js";

export async function setPostLiked(client: SupabaseClient, postId: string, userId: string, liked: boolean) {
  const { error } = liked
    ? await client.from("post_likes").upsert({ post_id: postId, user_id: userId }, { onConflict: "post_id,user_id", ignoreDuplicates: true })
    : await client.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  // An absent row already satisfies an unlike, including after a lost response.
  if (error) throw error;
}
