import Link from "next/link";
import type { AuthorProfile } from "@/lib/author-avatars";
import { ProfileAvatar } from "./ProfileAvatar";

export function AuthorLink({ id, profile, fallbackName }: {
  id: string;
  profile?: AuthorProfile;
  fallbackName: string;
}) {
  const name = profile?.name ?? fallbackName;
  return (
    <Link className="profile-author-link" href={`/profil/${id}`}>
      <ProfileAvatar name={name} url={profile?.url} x={profile?.x} y={profile?.y} zoom={profile?.zoom}/>
      <span>{name}</span>
    </Link>
  );
}
