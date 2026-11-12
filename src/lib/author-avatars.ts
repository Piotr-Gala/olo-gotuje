import type { SupabaseClient } from "@supabase/supabase-js";

export const authorProfileColumns = "id, display_name, avatar_path, avatar_x, avatar_y, avatar_zoom";

type ProfileRow = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_x: number;
  avatar_y: number;
  avatar_zoom: number;
};

export type AuthorProfile = {
  name: string;
  url?: string;
  x: number;
  y: number;
  zoom: number;
};

export async function signAuthorAvatars(client: SupabaseClient, profiles: ProfileRow[], authorIds: string[]) {
  const ids = new Set(authorIds);
  const authors = profiles.filter(profile => ids.has(profile.id));
  const paths = [...new Set(authors.flatMap(profile => profile.avatar_path ? [profile.avatar_path] : []))];
  const { data } = paths.length
    ? await client.storage.from("family-avatars").createSignedUrls(paths, 3600)
    : { data: [] };
  const urls = new Map((data ?? []).flatMap(item => item.path && item.signedUrl ? [[item.path, item.signedUrl]] : []));

  return Object.fromEntries(authors.map(profile => [profile.id, {
    name: profile.display_name,
    url: profile.avatar_path ? urls.get(profile.avatar_path) : undefined,
    x: profile.avatar_x,
    y: profile.avatar_y,
    zoom: Number(profile.avatar_zoom),
  }])) as Record<string, AuthorProfile>;
}
