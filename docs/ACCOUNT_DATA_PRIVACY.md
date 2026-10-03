# Inwentarz danych kont Rex.Bid i prywatność — techniczny szkic

## Przegląd 2026-10-03

Pięć dokumentów roboczych znajduje się w `docs/legal/`; każdy ma oznaczenie **DRAFT — REQUIRES OWNER/LEGAL REVIEW**. Eksport `/api/me/export` istnieje w kodzie, ale jego UX nie został w tej sesji potwierdzony w browserze. Usunięcie konta nadal nie jest zaimplementowane i wymaga decyzji o reauth, backendowym Supabase Admin capability i retencji backupów. Service-role nie skonfigurowano.

Stan: 2026-09-29. To inwentarz techniczny, nie finalna polityka prywatności. Retencja i podstawa prawna wymagają decyzji właściciela/prawnika.

| Obszar | Dane w obecnym kodzie | Cel | Retencja / uwagi |
|---|---|---|---|
| Supabase Auth | email, password credentials (Supabase), email confirmation state, provider identity, auth subjects, sessions/refresh tokens u dostawcy | uwierzytelnianie i wiadomości auth | Określić retencję po usunięciu konta, region/umowę/DPA i backup lifecycle |
| Rex.Bid D1 `users` | UUID Rex.Bid, issuer, subject, provider, email_verified, timestamps | mapowanie zewnętrznej identity | E-mail nie jest zapisany w proposal 0003; kasowanie przez cascade wymaga implementacji procesu |
| D1 `user_favorites` | VIN lub LOT+platform oraz timestamps | utrzymanie watchlisty w chmurze | To są identyfikatory pojazdów; retencja po usunięciu konta do ustalenia |
| Browser localStorage | guest favorites w wersjonowanym, ograniczonym formacie; account-scoped curated favorites cache | gościnna watchlista/offline render | Użytkownik może wyczyścić; cache jest usuwany przy logout/401/switch account. Nie ma auth tokens |
| Browser cookies | encrypted access/refresh-token session payload w host-only HttpOnly cookie; krótki encrypted PKCE flow state/verifier | sesja BFF i callback | Session TTL maks. 30 dni; flow cookie krótki/ograniczony do operacji; HttpOnly cookie niewidoczne dla JS |
| Worker logs | staging-only allowlisted operation/stage/status/request ID; Cloudflare platform logs mogą mieć metadane requestu | diagnoza awarii/abuse | Kod nie loguje email/password, cookie, tokenów, apikey ani pełnego body; platform retention i IP logs do sprawdzenia |
| Provider vehicle data | poza zakresem kont; favorite POST ogranicza się do identity | odwołanie do pojazdu | Nie zapisujemy pełnego payloadu Apibara w favorite |

## Minimalizacja i prawa użytkownika

- API odczytuje profil i favorites po zweryfikowanej issuer+subject identity; nie przyjmuje `user_id` z klienta.
- Export `/api/me/export` obejmuje profil Rex.Bid i favorites wyłącznie aktywnego użytkownika. Nie eksportuje auth provider secrets/session material.
- Usunięcie konta pozostaje niezaimplementowane i zablokowane do ustalenia reauth, Supabase Admin deletion, backup retention i audytu.
- Nie deklarować okresów retencji przed zatwierdzeniem polityki i możliwości dostawców.

## Decyzje prawne/biznesowe wymagane

1. Administrator danych, cele/podstawy przetwarzania i privacy contact.
2. Okres retencji kont/favorites/logów i backupów; usunięcie z Supabase i D1.
3. DPA/transfery/region dla Supabase, Cloudflare i dostawcy poczty.
4. Treść privacy notice, terms, cookies, consent oraz obsługa praw dostępu/korekty/usunięcia.
5. Czy po usunięciu konta zachowujemy zanonimizowane statystyki i na jakiej podstawie.
6. Zasady obsługi eksportu, zamknięcia konta, recovery i support identity verification.
