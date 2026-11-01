<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Codex test account

- Olo Gotuje has an approved test author account with nickname `codex`, role `owner` (not admin), user ID `f5c41a64-253c-413c-9f3c-b1cfb91a405b`.
- Credentials are stored outside Git in `.appdata/codex-account.json`. `password_dpapi` is encrypted by Windows DPAPI for the local Windows user. In PowerShell, decrypt only in memory with `[System.Net.NetworkCredential]::new('', (ConvertTo-SecureString $credential.password_dpapi)).Password`; never print the password or tokens, commit credentials, or put them in chat/memory.
- Use the nickname-login flow. The email is a technical account identifier, not a monitored inbox; do not use email recovery. The birth date is synthetic test data.
- Use this account when the user requests test posts or other test activity. Account availability does not authorize unsolicited production mutations. Do not reset an existing password on retries.
