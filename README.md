# Olo Gotuje

Prywatny, rodzinny blog Ola. Gotowanie, LEGO i muzyka są niezależnymi działami; każdy można włączyć dopiero wtedy, kiedy Olo chce w nim publikować.

## Uruchomienie

Wymagany Node.js 20.9 lub nowszy.

```powershell
npm.cmd install
npm.cmd run dev
```

Bez konfiguracji Supabase strona pokaże instrukcję podłączenia projektu. Nie ma lokalnego konta demonstracyjnego ani publicznej rejestracji.

## Podłączenie Supabase

1. Utwórz projekt Supabase i skopiuj `.env.example` do `.env.local`.
2. Uzupełnij `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` z ustawień projektu.
3. Zastosuj `supabase/migrations/202610170001_initial_schema.sql` w SQL Editorze Supabase. Migracja tworzy tabele, reguły RLS oraz prywatny bucket na zdjęcia do 8 MB.
4. Utwórz konta rodzinne w Supabase Authentication. Wyłącz publiczny signup.
5. W tabeli `profiles` ustaw pierwsze konto rodzica na `role = admin`, `is_approved = true`. Konto Ola ustaw na `role = owner`, `is_approved = true`. Kolejne konta zatwierdzaj przez `is_approved`.
6. Uruchom ponownie aplikację. Zalogowane i zatwierdzone konta widzą opublikowane wpisy aktywnych działów; admin i owner mogą tworzyć, edytować, publikować, usuwać wpisy i włączać działy.

Nigdy nie wkładaj klucza `service_role` do aplikacji ani do zmiennych `NEXT_PUBLIC_*`. Ten prototyp nie ma jeszcze komentowania, subskrypcji powiadomień ani osobnego dziecięcego interfejsu publikowania.

## Role

- `admin`: techniczny administrator rodziny.
- `owner`: Olo, twórca bloga.
- `member`: konto rodzinne, zatwierdzane przez administratora.
