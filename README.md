# Olo Gotuje

Prywatny, rodzinny blog Ola. Gotowanie, LEGO i muzyka są niezależnymi działami; każdy można włączyć dopiero wtedy, kiedy Olo chce w nim publikować.

## Uruchomienie

Wymagany Node.js 20.9 lub nowszy.

```powershell
npm.cmd install
npm.cmd run dev
```

Bez konfiguracji Supabase strona pokaże instrukcję podłączenia projektu. Nie ma lokalnego konta demonstracyjnego. Rodzina może utworzyć konto na `/register`; nowe konto czeka na zatwierdzenie przez administratora.

## Podłączenie Supabase

1. Utwórz projekt Supabase i skopiuj `.env.example` do `.env.local`.
2. Uzupełnij `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` z ustawień projektu.
3. Zastosuj `supabase/migrations/20261017212023_initial_schema.sql` w SQL Editorze Supabase. Migracja tworzy tabele, reguły RLS oraz prywatny bucket na zdjęcia do 8 MB.
4. Włącz rejestrację e-mail/hasło w Supabase Authentication. Po rejestracji konto oczekuje na potwierdzenie adresu e-mail i zatwierdzenie administratora.
5. Zastosuj pozostałe migracje z `supabase/migrations` w kolejności nazw plików. Pierwsze konto rodzica ustaw w `profiles` jako `role = admin`, `is_approved = true`; konto Olo jako `role = owner`, `is_approved = true`.
6. Zaloguj się jako administrator i otwórz **Konta**, aby zatwierdzać konta rodzinne i zarządzać rolami. Admin może nadawać i odbierać role członka, administratora i właściciela. Po zastosowaniu migracji `protect_future_primary_owner` pierwsze zatwierdzone konto `owner` zostaje automatycznie oznaczone jako chronione, również gdy rolę nadano po migracji. Dostęp jest weryfikowany przez Server Actions i RLS.
7. Uruchom ponownie aplikację. Zalogowane i zatwierdzone konta widzą opublikowane wpisy aktywnych działów; admin i owner mogą tworzyć, edytować, publikować, usuwać wpisy i włączać działy.

Do testowania na telefonie w sieci lokalnej ustaw `NEXT_ALLOWED_DEV_ORIGINS` w `.env.local` jako listę hostów oddzielonych przecinkami (bez protokołu), np. `192.168.1.20,olo-pc.tailnet-name.ts.net`. Adresy są zależne od sieci i nie są wpisane do publicznej konfiguracji.

Nigdy nie wkładaj klucza `service_role` do aplikacji ani do zmiennych `NEXT_PUBLIC_*`. Ten prototyp nie ma jeszcze komentowania, subskrypcji powiadomień ani osobnego dziecięcego interfejsu publikowania.

## Role

- `admin`: techniczny administrator rodziny.
- `owner`: Olo, twórca bloga.
- `member`: konto rodzinne, zatwierdzane przez administratora.

## Checks

Run `npm.cmd test` for post save/delete failure scenarios and database authorization regression tests, then `npm.cmd run build` for the production build and TypeScript checks. Database tests run migrations in a disposable in-memory PostgreSQL instance using PGlite; they do not connect to the Supabase project. Supabase-managed Auth and Storage interfaces are represented by minimal local schemas.

Migration filenames match the versions already recorded in the linked project. Do not reapply renamed migrations to that database. The new `protect_future_primary_owner` migration must be applied separately before future owners receive automatic protection.

## Private videos (Cloudflare R2)

Videos use a separate private R2 bucket and the `post_videos` migration. Keep both the public development URL and custom public domains disabled. Use a bucket-scoped **Object Read & Write** token, without bucket administration privileges. Save its S3 credentials in server-only environment variables: `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Use the jurisdiction-specific endpoint for EU buckets (`https://<account-id>.eu.r2.cloudflarestorage.com`), without a bucket suffix. Never use `NEXT_PUBLIC_` for these variables. Add the same server variables to the deployment environment before deploying this feature.

Configure bucket CORS with exact application origins (production and local development), `GET`, `HEAD`, and `PUT`; allow `Content-Type` and `Range`, and expose `ETag`, `Accept-Ranges`, `Content-Range`, and `Content-Length`. Phone testing against a local server additionally requires its exact LAN/Tailscale origin in CORS. CORS does not grant public access: every upload part and read still requires a signed URL.

The post form accepts one MP4 per post, up to **1,000,000,000 bytes (1 GB)**. H.264 video with AAC audio is recommended for desktop and phone compatibility. There is no transcoding. An editor can remove an existing/unfinished video before selecting another. New posts stay drafts until all selected media have been attached successfully. Cancelling an upload leaves the draft available for editing.

The browser uploads directly to R2 in 16 MiB parts, with progress, cancellation, and up to three attempts per part. Retrying the same open form reuses uploaded parts and the same database/object identity. Resuming after closing the form or reloading the page is not supported; remove the unfinished attachment in the editor and start again. R2 is checked for actual part sizes, total size, MIME type, and the MP4 container signature before a video becomes playable. Container validation does not certify its codecs. Upload signatures expire after five minutes; playback signatures expire after fifteen minutes and refresh while the player is mounted.

RLS allows approved members to read ready videos only when the associated post is visible to them. Upload and deletion require an approved admin/owner, checked independently by the API and RLS. R2 credentials are used only on the server; Supabase uses the signed-in user's session, without a service-role key.

Deleting a post retains a detached video cleanup record, even for direct database/API post deletion. Cleanup aborts the multipart upload before deleting the object. Failed cleanup remains retryable; the app retries when an editor opens the home page, after post deletion, or via **Retry video cleanup**. Recent records are retained for an hour to cover in-flight requests; a later cleanup pass removes them. This is an editor-driven retry queue, not a scheduled background worker. Keep R2's default rule that aborts unfinished multipart uploads after seven days as a fallback for interrupted initialization requests.
