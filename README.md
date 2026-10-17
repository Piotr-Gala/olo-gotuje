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
3. Zastosuj `supabase/migrations/202610170001_initial_schema.sql` w SQL Editorze Supabase. Migracja tworzy tabele, reguły RLS oraz prywatny bucket na zdjęcia do 8 MB.
4. Włącz rejestrację e-mail/hasło w Supabase Authentication. Po rejestracji konto oczekuje na potwierdzenie adresu e-mail i zatwierdzenie administratora.
5. Zastosuj pozostałe migracje z `supabase/migrations` w kolejności nazw plików. Pierwsze konto rodzica ustaw w `profiles` jako `role = admin`, `is_approved = true`; konto Olo jako `role = owner`, `is_approved = true`.
6. Zaloguj się jako administrator i otwórz **Konta**, aby zatwierdzać konta rodzinne i zarządzać rolami. Dostęp jest weryfikowany przez Server Actions i RLS.
7. Uruchom ponownie aplikację. Zalogowane i zatwierdzone konta widzą opublikowane wpisy aktywnych działów; admin i owner mogą tworzyć, edytować, publikować, usuwać wpisy i włączać działy.

Do testowania na telefonie w sieci lokalnej ustaw `NEXT_ALLOWED_DEV_ORIGINS` w `.env.local` jako listę hostów oddzielonych przecinkami (bez protokołu), np. `192.168.1.20,olo-pc.tailnet-name.ts.net`. Adresy są zależne od sieci i nie są wpisane do publicznej konfiguracji.

Nigdy nie wkładaj klucza `service_role` do aplikacji ani do zmiennych `NEXT_PUBLIC_*`. Ten prototyp nie ma jeszcze komentowania, subskrypcji powiadomień ani osobnego dziecięcego interfejsu publikowania.

## Role

- `admin`: techniczny administrator rodziny.
- `owner`: Olo, twórca bloga.
- `member`: konto rodzinne, zatwierdzane przez administratora.
