import type { SupabaseClient } from "@supabase/supabase-js";

const postColumns = "id, section_slug, author_id, author_name, title, slug, excerpt, content, metadata, status, published_at, created_at, post_images(id, storage_path, alt_text, sort_order)";

type PostValues = {
  section_slug: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  metadata: Record<string, unknown>;
  status: "draft" | "published";
  published_at: string | null;
};

export type PostSaveSession = {
  id: string;
  isNew: boolean;
  busy: boolean;
  imageOffset: number;
  images: Map<string, { id: string; path: string; sortOrder: number; uploaded: boolean }>;
};

export function createPostSaveSession(existing?: { id: string; post_images: unknown[] }): PostSaveSession {
  return {
    id: existing?.id ?? crypto.randomUUID(),
    isNew: !existing,
    busy: false,
    imageOffset: existing?.post_images.length ?? 0,
    images: new Map(),
  };
}

// Keep identities across retries, including requests whose responses were lost.
export async function savePostWithPhotos(
  client: SupabaseClient,
  session: PostSaveSession,
  values: PostValues,
  authorId: string,
  files: File[],
  beforeCommit?: (postId: string) => Promise<void>,
) {
  if (session.busy) return null;
  session.busy = true;
  try {
    if (session.isNew) {
      const { error } = await client.from("posts").upsert({
        ...values, id: session.id, author_id: authorId, status: "draft", published_at: null,
      }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
    }

    for (const [index, file] of files.entries()) {
      const key = JSON.stringify([index, file.name, file.size, file.lastModified]);
      let image = session.images.get(key);
      if (!image) {
        const id = crypto.randomUUID();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        image = { id, path: `${session.id}/${id}-${safeName}`, sortOrder: session.imageOffset + session.images.size, uploaded: false };
        session.images.set(key, image);
      }
      if (!image.uploaded) {
        const { error } = await client.storage.from("family-post-images").upload(image.path, file, {
          contentType: file.type, upsert: true,
        });
        if (error) throw error;
        image.uploaded = true;
      }
      const { error } = await client.from("post_images").upsert({
        id: image.id, post_id: session.id, storage_path: image.path, alt_text: values.title, sort_order: image.sortOrder,
      }, { onConflict: "id" });
      if (error) throw error;
    }

    await beforeCommit?.(session.id);
    // A new post stays private until every selected attachment has been verified.
    const { data, error } = await client.from("posts").update(values).eq("id", session.id).select(postColumns).single();
    if (error) throw error;
    if (!data) throw new Error("The saved post was not returned");
    return data;
  } finally {
    session.busy = false;
  }
}

export async function deletePostWithPhotos(client: SupabaseClient, post: { id: string; post_images: { storage_path: string }[] }) {
  // Never destroy files until the database confirms the post was deleted.
  const { error } = await client.from("posts").delete().eq("id", post.id).select("id").single();
  if (error) throw error;
  if (!post.post_images.length) return { cleanupError: null };
  try {
    const { error: cleanupError } = await client.storage.from("family-post-images").remove(post.post_images.map((image) => image.storage_path));
    return { cleanupError };
  } catch (cleanupError) {
    return { cleanupError };
  }
}
