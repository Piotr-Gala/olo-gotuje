export function ProfileAvatar({ url, name, x = 50, y = 50, zoom = 1 }: {
  url?: string | null; name: string; x?: number; y?: number; zoom?: number;
}) {
  return <span className="profile-avatar" aria-hidden="true">
    {url ? <img src={url} alt="" style={{ objectPosition: `${x}% ${y}%`, transformOrigin: `${x}% ${y}%`, transform: `scale(${zoom})` }}/>
      : name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? "").join("").toLocaleUpperCase() || "🍳"}
  </span>;
}
