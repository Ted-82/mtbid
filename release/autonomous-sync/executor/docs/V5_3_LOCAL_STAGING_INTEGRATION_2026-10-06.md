# V5.3 — integracja lokalnego checkoutu i staging, 2026-10-06

## Aktualny wynik

**CODE / AUTOMATED / PUBLIC STAGING VERIFIED. Portal uwierzytelniony: NOT VERIFIED, pozostaje OFF.**

- Checkout: `C:\Users\nowic\Desktop\stona_auta-www`, gałąź `rexbid-v4-live-staging-20261005`, HEAD `35adc6fa66739bd52a3f07428b9ad61ab926da55`.
- Nie cofnięto V4, nie użyto patcha V5.2 na V4. Zweryfikowano SHA-256 wszystkich 320 plików manifestu, porównano pełne pliki: 196 zgodnych, 35 zmienionych, 89 nowych. Scalono wyłącznie sprawdzone różnice. Materiały właściciela, ZIP-y i `.codex-wrangler-cache` zachowano.
- Stawki i algorytm kalkulatora zgodne z lokalnym V4; zmiany V5 dotyczą m.in. prezentacji, formularza budżetu oraz portalu.
- Cloudflare: konto `Tedn828`, ID `7ff5a57444667c4eda2a6a7f0fc4120d`.
- Jedyny deploy: `rexbid-auth-test`; D1 `rexbid-auth-test-db`, ID `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- **Version ID: `3753d454-0534-44e9-9dc1-904e758c7b8a`**. Poprzedni staging: `6ca848f1-21a2-47d8-a3b3-0a5496cc7c2b`.
- Produkcja `mtbid`, produkcyjna D1, DNS i konfiguracja domeny bez zmian. Nie użyto `wrangler.release.jsonc` do deployu. Bez push i bez nowego commitu w tym etapie.

## Backup i schemat

Przed zmianą wykonano zdalny eksport stagingu do ignorowanego katalogu roboczego:

`.codex-wrangler-cache/rexbid-auth-test-db-pre-v5-3-20261006.sql`

SHA-256: `8e1aadd3ca0e22c317e8aba464f787e810b0f671490c580ee5384db6a59c95d6`.

Odtworzono eksport do **SQLite w pamięci**, sprawdzono county i foreign keys. Dwukrotne zastosowanie proposal `0006` w tej jednorazowej bazie potwierdziło addytywność i zachowanie danych. To nie jest ponowny remote restore rehearsal.

Następnie zastosowano **wyłącznie na stagingu** `docs/proposals/0006_import_operations.sql`. Pięć nowych tabel istnieje i jest pustych: `import_orders`, `import_order_events`, `import_order_messages`, `import_order_files`, `portal_customer_profiles`. `PRAGMA foreign_key_check` zwrócił zero błędów. Proposal pozostaje poza aktywnym katalogiem produkcyjnych migracji.

| Dane | Przed | Po QA |
|---|---:|---:|
| Copart listings | 352 | 352 |
| IAAI listings | 227 | 227 |
| Sources / listings łącznie | 579 / 579 | 579 / 579 |
| Snapshots | 584 | 584 |
| Events / vehicle entities | 0 / 0 | 0 / 0 |
| Users / cloud favorites | 1 / 1 | 1 / 1 |
| Nowe tabele portalu | nie istniały | po 0 rekordów |

Stary katalog pozostaje partial. Nie wykonano discovery, backfillu ani usuwania danych.

## Testy

- Pełne `node --test`: **613/613 PASS**, zero skipped/fail.
- `check-v5-calculator-parity.cjs`: **125 663 porównania PASS** (610 lokalizacji).
- Oba generatory `--check`: PASS; V4 `rex-partner-v4-f0a67460b203286f` bez zmiany.
- Walidatory worker config i nieaktywnego production release: PASS.
- Profil handlowy: struktura poprawna, `review_required`; brak danych nie jest kompletną wyceną.
- Składnia 118 modułów JS i 11 skryptów inline: PASS.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS.
- Staging Wrangler dry-run i deploy: PASS.

Behavioral testy portalu obejmują izolację klient/właściciel, AAL2, szyfrowanie, pliki i odmowę IDOR, paginację i konflikty, eksport siedmiu sekcji, account-bound cursory, przerwanie po wylogowaniu oraz spóźnione odpowiedzi. Ich PASS nie zastępuje rzeczywistego testu kont i R2.

## Realny staging i przeglądarka

| Sprawdzenie | Wynik |
|---|---|
| `/health`, `/ready` | HTTP 200; Worker, D1 i assets OK |
| `/api/cars`, `/api/filters` | HTTP 200, D1, jawnie częściowy katalog/metadane |
| `/api/auth/config` | HTTP 200, istniejący staging Auth enabled |
| `/api/me` bez sesji | HTTP 401, private/no-store |
| `/api/portal/config` | HTTP 200, `enabled=false`, `uploads_enabled=false` |
| `/api/portal/me`, `/api/portal/security` | HTTP 503; niedostępne przy niepełnej konfiguracji |
| Home desktop/mobile | Hero, kategorie, prawdziwe miniatury/ceny; sekcje ładują się przy przewijaniu; Timed ma poprawny pusty stan |
| Katalog / LOT | Wyszukanie 62674546 zwraca właściwą Teslę; przejście normalnym kliknięciem do karty |
| Copart / IAAI | Obie karty renderują dane i kalkulator; galeria IAAI 17 zdjęć, lightbox i następne zdjęcie działają |
| Historia | Odpowiedź bez potwierdzonych aukcyjnych zdarzeń; obserwacje nie są przedstawiane jako sprzedaż |
| Panel / administracja | Desktop/mobile pokazują świadomą blokadę; brak ujawnienia danych |
| Mobile 390 × 844 | Brak poziomego overflow w sprawdzonym Home, karcie, kalkulatorze, panelu i administracji |

Przykłady transportu sprawdzone w rzeczywistym UI (USD):

| Auto | Standard 4 auta | Ostrożny 3 auta | Uwagi |
|---|---:|---:|---|
| Copart Tesla Model 3, LOT 62674546 | 1030 | 1205 | Land 205 + BEV 150 + sea 675/850, preferowany Houston; przy wpisanej cenie 10 000 subtotal ostrożny 11 205, jawnie nie cena pod dom |
| IAAI BMW 330I, LOT 45439613 | 1395 | 1735 | Oba warianty zgodne z taryfą; opłaty i podatki do potwierdzenia |

Nie logowano się ponownie, nie wykonywano MFA/recovery ani wysyłki wiadomości. Cloud favorites, eksport rzeczywistego klienta i zapis sprawy na zdalnym portalu pozostają **NOT VERIFIED**. Zrzuty: `docs/qa/v5-3-local-staging-2026-10-06/`.

## Request ledger

**2 nowe requesty Apibara**, oba automatyczne history fallback podczas otwarcia realnych kart (Copart, potem IAAI). D1 detail był dostępny, ale obowiązujący próg historii 6 godzin powoduje `d1_history_stale`. Budżet globalny `2026-10-06` i klasa history wynoszą po 2 consumed / 0 reserved; nie sumować obu klas jako czterech requestów. Liczba rezerwacji wzrosła 287 → 291, ponieważ każde wywołanie ma rezerwację globalną i klasową. Katalog/filtry/detail nie zużyły kolejnych requestów. Brak discovery i enrichmentu. Początkowe założenie 0 zostało skorygowane na podstawie bezpośredniego odczytu D1.

## Konkretne przeszkody portalu

1. **Tożsamość właściciela niepotwierdzona.** Jedno konto staging, provider `email`, potwierdzony adres, utworzone 2026-09-28 10:56:39 UTC (12:56 Warszawa). D1 nie przechowuje e-maila. Nie można z niej odczytać nawet zamaskowanego adresu; nie utożsamiać go z e-mailem Cloudflare. Właściciel poprosił o zamaskowany adres przed nadaniem roli. Nie ustawiono `REXBID_OWNER_USER_ID`.
2. Brak `REXBID_PORTAL_DATA_KEYS` i `REXBID_PORTAL_ACTIVE_KEY_ID`. Potrzebne bezpieczne wygenerowanie/przekazanie i kopia kluczy; nie wolno publikować ich w czacie/repo ani zgadywać istniejących wartości.
3. Cloudflare R2 nieaktywne na koncie: odczyt listy bucketów zwraca **10042: Please enable R2 through the Cloudflare Dashboard**. Nie aktywowano usługi/rozliczeń i nie utworzono publicznego bucketa. Prywatne pliki wymagają dedykowanego bindingu i weryfikacji.
4. Po konfiguracji wymagany realny test właściciela AAL2 oraz izolacji dwóch kont klientów, eksportu i prywatnych plików. Testy offline nie poświadczają zdalnych credentials/MFA/R2.

**Następny pojedynczy krok właściciela:** w stagingowym projekcie Supabase otworzyć Authentication → Users i sprawdzić adres konta utworzonego 28.09.2026 o 10:56 UTC. Można przekazać sam zamaskowany adres; bez hasła/kodu. Dopiero po potwierdzeniu tożsamości kontynuować przypisanie roli.

## Kontynuacja i rollback

Publiczna część V5.3 działa na istniejącym stagingu. Portal pozostaje fail-closed. Najpierw potwierdzenie konta, potem keyring/owner config, prywatny R2, realne QA i dopiero aktywacja portalu. Produkcja/DNS wymagają odrębnego zakresu.

Rollback stagingowego Workera do poprzedniego Version ID nie wymaga usuwania pustych addytywnych tabel. Nie kasować kopii ani historycznych kluczy. Nie deployować wyłączonego `wrangler.release.jsonc` na `mtbid` — zwraca 503.
