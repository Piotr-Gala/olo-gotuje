# R2 video integration checks — 2026-10-19

This report records local and physical-phone acceptance before production rollout. Commit and production deployment evidence are tracked in Git and Vercel.

## Completed

- Created a private Standard R2 bucket, restricted to the EU jurisdiction. Public development URL and custom public domains are disabled.
- Created an active Object Read & Write account token scoped to that bucket only. Its S3 credentials are stored in ignored `.env.local`; no secrets are included in source files or this report.
- Configured exact-origin CORS for production and localhost, including response headers needed for browser multipart uploads.
- Applied `20261019094304_post_videos_r2.sql` to the linked Supabase project and verified RLS and all four authenticated-role policies. The local migration version matches the remote history.
- `npm.cmd test`: **40/40 pass**. Coverage includes real migration/RLS execution in PGlite, attachment visibility, size and part validation, retry identities, cancellation, lost completion responses, invalid file cleanup, concurrent post deletion, and failed cleanup retries.
- `npm.cmd run build`: **pass**, including TypeScript. The local server is running the production build.
- Production HTTP checks: unauthenticated reads return 401; same-origin unauthenticated writes return 401; foreign-origin writes return 403. An initial rejection of valid local origins was corrected by comparing Origin with the request Host rather than Next.js's reconstructed internal URL.
- Uploaded the user-selected **3,630,892-byte** MP4 through the actual website post form into a draft. R2 confirmed its exact size and `video/mp4`; browser playback reached its full 17.94-second duration without a media error.
- Uploaded a **50,331,648-byte (48 MiB)** copy through the same form into a second draft. The copy contains the original movie plus a valid MP4 `free` box; the original local file was unchanged. R2 confirmed a three-part ETag and the exact size. Browser playback and seeking succeeded without a media error.
- Confirmed the rendered playback URL expires after 900 seconds. Object retrieval without authentication was unsuccessful; no bucket was made public.
- Real phone acceptance: the user confirmed that image, audio, and seeking all work for the multipart test draft. This is user-reported acceptance on a physical phone, not an agent-run device test.
- End-to-end cleanup: after explicit user approval, deleted both test drafts through the website. Supabase confirmed zero remaining test posts; R2 HEAD returned 404 for both videos, with zero objects and zero unfinished multipart uploads remaining in the bucket. The original local movie still exists with its original size.
- Immediately after cleanup, two detached records remained in `deleting` state during the documented one-hour grace period. Their payloads had already been removed; a subsequent cleanup pass can remove the records after the grace period.

## Pending acceptance

- A real near-1-GB video has not been uploaded. The larger fixture verifies multipart transport, not production-scale encoding or long-duration playback.

## Operational limits

- One MP4 per post; no transcoding. Codec compatibility must be checked on the target phone.
- Retry/resume works within the same open form. A page reload requires removing the unfinished attachment and starting again.
- Cleanup retries on an editor visit, after post deletion, and via the retry button. Recent cleanup records remain for one hour to cover outstanding requests; there is no scheduled cleanup worker.
- R2's seven-day incomplete-multipart abort rule remains enabled.

## Existing advisor notices

The post-migration advisor reported the existing `public.update_my_family_profile` SECURITY DEFINER RPC and disabled leaked-password protection; no video-table policy finding was reported. These unrelated settings were not changed. See [RPC advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
