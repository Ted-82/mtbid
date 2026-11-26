# Prywatne załączniki staging — 2026-10-06

## Stan wdrożony

- Konto Cloudflare Tedn828: `7ff5a57444667c4eda2a6a7f0fc4120d`.
- Worker **rexbid-auth-test**, Version **1d9edf9e-9194-46b8-ae1a-10d4b136716b**; poprzednia wersja `b5200dc0-a934-4665-a838-c3c5799b76fd`.
- D1 **rexbid-auth-test-db**, `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`; schema 0006 zastana, bez migracji.
- Utworzono **rexbid-staging-private-files**, klasa **Standard**, przydzielony region EEUR. Binding **REXBID_PRIVATE_FILES** tylko w `wrangler.staging.jsonc`.
- `REXBID_PORTAL_FILES_ENABLED=enabled`. `/api/portal/config` potwierdza `enabled=true`, `uploads_enabled=true` po deployu. To sprawdza obecność bindingu i poprawność konfiguracji szyfrowania, nie zastępuje testu zapisu.
- Publiczny r2.dev **disabled**, custom domains **0**. CORS nie skonfigurowany (Cloudflare 10059: configuration does not exist); frontend korzysta wyłącznie z własnego uwierzytelnionego API, nigdy bezpośrednio z R2.
- Zachowano istniejące klucze, konfigurację właściciela, sesji i szyfrowania. Nie odczytywano ich wartości, nie wykonywano rotacji.
- Właściciel potwierdził działające 2FA. Usunięto trzy czasowe zmienne `REXBID_OWNER_MFA_PENDING_RESTART`, `REXBID_OWNER_MFA_PENDING_BEFORE`, `REXBID_OWNER_MFA_PENDING_UNTIL`. Żadnych wywołań enrollment/unenroll/verify Supabase. `POST /api/portal/security/restart-pending` teraz zwraca **404** przed operacją MFA. Istniejący zweryfikowany czynnik zachowany.
- Produkcja i DNS bez zmian. Apibara **0**. Bez commitu/pusha; wcześniejsze zmiany projektu i `.codex-wrangler-cache` zachowane.

## Zachowanie załączników

- Dodawanie: wyłącznie skonfigurowany właściciel z sesją **AAL2**, poprawnym Origin i kontrolą CSRF. Klient może pobierać materiały udostępnione jego realizacji; nie może dodawać plików ani zmieniać ich widoczności.
- Typy: PDF, JPEG/JPG, PNG. Maksymalnie **8 MiB = 8 388 608 bajtów** na plik, minimum 1 bajt. Limit dotyczy rzeczywistego strumienia, także przy fałszywym Content-Length. Rozszerzenie, deklarowany MIME, początek formatu i nazwa są sprawdzane.
- Treść szyfrowana **AES-256-GCM** przed R2, z losowym nonce oraz AAD wiążącym szyfrogram z order ID i file ID. Odczyt weryfikuje szyfrogram, długość, format i SHA-256.
- R2: losowy `portal/UUID`, `application/octet-stream`, bez nazw klienta/pliku w metadanych obiektu. D1 przechowuje metadane pliku, w tym nazwę, MIME, rozmiar, hash i powiązanie z realizacją. Te metadane nie są szyfrowane dodatkowo przez aplikację; API chroni je autoryzacją. Treści notatek/wiadomości i plików mają szyfrowanie aplikacyjne.
- Pobieranie przechodzi przez API, ma `Content-Disposition: attachment`, `private, no-store`, `nosniff`, CSP sandbox i same-origin. Nie ma publicznych URL-i ani presigned URL-i omijających kontrolę konta.
- `internal` pliki i notatki są odfiltrowywane w SQL także z list, countów i paginacji klienta. Zgadywanie ich identyfikatora daje 404 przed R2/decrypt.
- Walidacja typu nie jest skanowaniem antywirusowym. Nie dodano skanera, sumarycznego limitu przestrzeni ani limitu liczby plików na realizację. Obecna kontrola obejmuje uprawnienia, ogólny limiter portalu i limit pojedynczego pliku. Awaryjne wyłączenie upload/download: `REXBID_PORTAL_FILES_ENABLED=disabled` + staging deploy; bez kasowania danych/keyringu.

## Rzeczywiście wykonane sprawdzenia

### Zdalny R2 + właściwe moduły aplikacji

`node scripts/verify-staging-private-r2.cjs --remote-staging`:

- Realny Cloudflare R2 przez Wrangler OAuth, dokładny allowlist bucketa, jednorazowy losowy klucz testowy wyłącznie w pamięci.
- Faktyczne moduły `portal/operations.cjs`, `attachments.cjs`, `crypto.cjs`; baza SQLite disposable i jawnie syntetyczne tożsamości właściciel/klient A/klient B. Żadnych zdalnych kont testowych lub tokenów Supabase.
- PDF, PNG, JPEG: upload **201**, download **200**, zgodność bajtowa **PASS**; R2 dostaje szyfrogram RXBID1, nie plaintext.
- Anonymous **401**, inny klient **404**, bez odczytu R2. Klient nie może uploadować (403), właściciel AAL1 także 403.
- Czwarty plik `internal`: właściciel pobiera; klient otrzymuje 404 przed R2. Wewnętrzna notatka i plik nie trafiają do odpowiedzi klienta.
- Za duży deklarowany plik **413**, niezgodny format **415** przed zapisem R2.
- Operacje R2: **4 put / 4 get / 4 delete**. Usunięto wyłącznie cztery obiekty tego testu. Końcowy `bucket info`: **0 obiektów / 0 B**. Zdalna D1: **0 zapisów**.
- Dowody lokalne bez treści dokumentów/kluczy: `.codex-wrangler-cache/r2-verification-2fd6c287-db5e-4f67-938c-ad187853ae11/result.json`, `owned-objects.json`, `wrangler.log`.

**Granica dowodu:** kod aplikacji i autoryzacji wykonał się lokalnie, R2 był rzeczywisty i zdalny. To nie jest test uploadu przez zalogowaną sesję właściciela na wdrożonym Workerze. Dostępna agentowi przeglądarka pozostaje anonimowa. Nie dodano bypassu, endpointu testowego ani dostępu service-role.

### Wdrożony staging

| Sprawdzenie | Wynik |
|---|---|
| `/health`, `/ready` | 200 |
| `/api/portal/config` | 200; uploads_enabled=true |
| `/api/portal/me`, `/api/portal/orders` bez sesji | 401, private/no-store |
| Anonimowy POST pliku i GET pliku | 401, private/no-store |
| POST wycofanego restart-pending | 404, private/no-store |
| `/administracja`, `/panel` | 200, private/no-store |
| Real browser anonimowy panel | ekran logowania, workspace ukryty, brak uploadu i przycisku restartu |

Direct D1 przed/po: users **1/1**, user_favorites **1/1**, import_orders/files/events/messages **0/0**. Zapytania read-only (`changed_db=false`, `rows_written=0`). Kontrolę countów wykonano scalar SELECT; początkowy compound SELECT został odrzucony przez limit D1, bez zmian danych.

### Testy lokalne

- Pełne **635/635 PASS**.
- 74 testy plików/operacji portalu/Worker/UI, w tym nowe roundtrip PDF/JPEG/PNG, ukrycie internal i brak R2 access przy anonimowym/obcym kliencie, AAL1/CSRF, dokładnie 8 MiB akceptowane i zero bytes odrzucone.
- Kalkulator **125 663 porównania PASS**, oba generatory `--check` PASS, 610 lokalizacji.
- Validator konfiguracji, syntax (118 modułów/11 inline oraz nowe skrypty), diff-check, staging dry-run i deploy PASS.

## Jeden następny krok właściciela

W [administracji stagingu](https://rexbid-auth-test.tedn828.workers.dev/administracja), po zwykłym loginie i istniejącym 2FA, utworzyć **jedną realizację testową** przez „＋ Dodaj realizację klienta”, przypisaną do swojego konta (np. tytuł `TEST załączników`, LOT `TEST-R2`, Copart). W tej realizacji sprawdzić dodanie i pobranie niesensytywnego PDF w sekcji „Zdjęcia i dokumenty”. Nie wysyłać QR, kodów ani danych logowania w czacie.

Pełny test przez zalogowaną sesję drugiego rzeczywistego klienta pozostaje NOT VERIFIED; izolacja jest potwierdzona behavioral tests oraz testem modułów na realnym R2 z syntetycznymi tożsamościami.
