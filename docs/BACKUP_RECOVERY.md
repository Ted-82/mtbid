# Backup i odtwarzanie Rex.Bid

Status: procedura projektowa; nie wykonano eksportu ani odtwarzania w ramach przeglądu gotowości.

## Rozdzielenie środowisk

| Środowisko | Worker | D1 | ID D1 | Zasada |
|---|---|---|---|---|
| Produkcja | `mtbid` | `rexbid-db` | `971879fe-04ed-4e8c-9dc6-5306980bb872` | Nie używać w testach restore |
| Staging | `rexbid-auth-test` | `rexbid-auth-test-db` | `acb3cb8e-69a2-459f-8a46-0f2f5b9004be` | Pierwsze miejsce prób odtworzeniowych |

Przed każdą komendą z `--remote` porównaj nazwę i UUID z tabelą oraz `wrangler.jsonc` / `wrangler.staging.jsonc`. Eksport zapisuj poza repozytorium w katalogu z ograniczonym dostępem; nie dołączaj go do Git ani logów CI.

## Kopia i walidacja

1. Zapisz datę UTC, środowisko, D1 name/UUID, ostatnią udaną migrację oraz punkt Time Travel/bookmark dostępny w panelu.
2. Wykonaj kontrolowany eksport D1 przed zmianą schematu, np. `npx wrangler d1 export rexbid-db --remote --output <bezpieczna-sciezka-poza-repo>`. Dla stagingu jawnie użyj konfiguracji stagingowej i sprawdź target przed zatwierdzeniem polecenia.
3. Ogranicz dostęp do eksportu; może zawierać dane użytkowników. Zaszyfruj go w magazynie zatwierdzonym przez właściciela i określ retencję przed uruchomieniem automatycznych kopii.
4. Importuj najpierw do lokalnej/disposable bazy, sprawdź integralność SQL i kluczowe county. Następnie wykonaj próbę odtworzenia wyłącznie w stagingu.
5. Zapisz checksum, czas eksportu, wersję narzędzia oraz wyniki porównania tabel/indeksów. Nie kopiuj stagingowych użytkowników do produkcji.

Cloudflare D1 oferuje Time Travel; okno zależy od planu i w dokumentacji wynosi 7 dni dla Free oraz 30 dni dla Paid. Odtworzenie Time Travel działa na bazie i jest operacją destrukcyjną/odwracającą późniejsze zmiany. Przed restore zachowaj aktualny eksport i bookmark, a restore produkcyjny wymaga osobnego zatwierdzenia właściciela. Time Travel nie zastępuje niezależnego eksportu.

## Migracje i rollback

- Migracje produkcyjne wykonuj wyłącznie z aktywnego katalogu migracji i po porównaniu `wrangler d1 migrations list --remote` z repo.
- Proposal `0003_accounts_foundation.sql` i `0004_d1_sync_2.sql` nie są zgodą na zastosowanie do produkcji. `0003` i `0004` pozostają niezaaplikowane na `rexbid-db`.
- Zastosowanie migracji ma być addytywne. Zrób kopię przed migracją, zastosuj w stagingu, sprawdź foreign keys, indeksy, legacy rows i zachowanie aplikacji.
- Nie usuwaj tabel ani kolumn w tej samej migracji co cutover. Preferuj wyłączenie flagi/route i rollback wersji Workera. Przy niezgodnym schemacie zatrzymaj rollout; przywrócenie bazy jest osobną, zatwierdzaną operacją.
- D1 migration runner może wykonać automatyczny backup przed udaną migracją; nadal wykonuj i rejestruj własny backup.

## Próba odtworzenia

Przed publicznym uruchomieniem: wykonaj co najmniej jedną próbę importu eksportu do disposable SQLite oraz staging D1, porównaj schemat, liczbę rekordów i kontrolne relacje. Nie wykonuj destructive restore stagingu, dopóki nie potwierdzisz zachowania stagingowego konta i jego ulubionych.

**Źródła Cloudflare (sprawdzone 2026-09-29):** [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Wrangler D1 commands and migration backup](https://developers.cloudflare.com/d1/wrangler-commands/).
