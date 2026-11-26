# REXBID V5.1 — fundament produkcji i dane wyceny

Data: 2026-10-06. Baza V5: `c1e16dd03a0c3241bbd1e7156d2e699d8e3151c1`. Gałąź: `rexbid-professional-v5`. **Kod i testy zweryfikowane; publikacja i pełna wycena nie są gotowe.**

## Wykonane zmiany

1. Naprawiony główny routing prywatnego `GET /api/me/export`. Integracja Worker → Accounts sprawdza własne ulubione użytkownika, ignoruje cudzy `user_id`, zachowuje limiter/origin/Auth i nie zapisuje ani nie wywołuje providera.
2. Oddzielny `worker.production.js` i `wrangler.release.jsonc`: tylko exact HTTPS `rexbid.pl`, istniejąca produkcyjna `rexbid-db`, domyślnie nieaktywne wydanie oraz indeksowanie. Pięć rzeczywistych tabel i używane kolumny są sprawdzane przed odczytem. Brak schematu daje 503 bez fallbacku. Konta, sync, provider i wszystkie budżety providera pozostają wyłączone.
3. Uczciwa aktualność: zbyt stare, nieprawidłowe i ponad minutę przyszłe obserwacje są stale/unknown, nie LIVE. Ceny i zdjęcia pozostają zapisanymi obserwacjami z datą. Historyczny `stored_catalog_complete` jest odrębny od `catalog_complete`, które wymaga aktualnego zakończenia każdego scope, także gdy platforma ma kilka scope.
4. Home, katalog i karta obsługują `vehicle.read`. Stare dane nie promują aktywnych aukcji, nie mają countdownu, a aktualizacja fresh → stale → fresh zmienia komunikaty. Home i wyniki pokazują częściowy/nieaktualny zakres z rzeczywistym `stored_row_count`, bez wymyślonego licznika. Legacy i preview zachowują swoje zachowanie.
5. Kalkulator, budżet, inquiry, kopiowanie i TXT używają zgodnych etykiet zapisanych cen. Kontekst aktualności przechodzi wraz z ceną; wybrana własna kwota i obliczenia się nie zmieniają. Daty UI: Europe/Warsaw; eksport: zweryfikowany ISO UTC. Zaktualizowane hashe zasobów i kopie HTML w root.
6. `config/rexbid-commercial-profile.json` oraz validator: istniejący transport V4 jest referencją, nowe dane pozostają null. Cztery grupy wejść wymagają źródła, potwierdzenia, okresu, jednostki, waluty i netto/brutto. Zakresy zapobiegają dublowaniu usług; pakiet EU lub osobne koszty, procent prowizji i taryfa kilometrowa są obsługiwane jako dane do implementacji. Validator sam sprawdza obecną datę UTC. `ready_for_cost_model` nigdy nie oznacza gotowej oferty ani produkcji.

Istniejący `wrangler.jsonc`, konfiguracja stagingu/preview, schematy i taryfy pozostają bez zmian. Nowy release nie importuje stagingowego runnera ani nie rozszerza staging-bypass.

## Weryfikacja zbiorcza

| Kontrola | Wynik |
| --- | --- |
| `npm test -- --test-reporter=tap` | **466/466 PASS**, 0 fail, 0 skipped; obejmuje również pakiet partnera |
| Porównanie V4/V5 obliczeń | **125 663 PASS**; obiekt stawek i kod obliczeń poza bindingiem niezmienione |
| Generator V4 `--check` | PASS; 610 lokalizacji, 24 stawki morskie, `rex-partner-v4-f0a67460b203286f` |
| Generator źródłowy partnera `--check` | PASS; USD, źródła zachowane |
| Istniejące konfiguracje | PASS |
| Kandydat produkcyjny | PASS jako **inactive_release_candidate**, `launch_ready: false` |
| Profil handlowy | Poprawny szkic **review_required**, pierwsza grupa stage1; brak gotowości kosztowej |
| Składnia zmienionych Worker/JS/CJS | PASS |
| Pięć kopii HTML i SHA zasobów | PASS |
| Diff whitespace | PASS |
| Wrangler staging dry-run | PASS, 39 assets; 433,84 KiB / gzip 88,49 KiB; jedyna D1 stagingowa |
| Wrangler release dry-run | PASS, 39 assets; 333,26 KiB / gzip 69,29 KiB; jedyna D1 produkcyjna |

Jedna wcześniejsza asercja źródłowa wymagała dokładnego zapisu wywołania `updateMarketPrices` bez metadanych. Zastąpiono ją rzeczywistym testem przekazywania ceny, ceny Kup teraz i aktualności z karty do kalkulatora. Końcowy pełny pakiet przeszedł; nie poluzowano testów kwot ani izolacji.

Peer review sprawdził izolację, schema readiness, przyszłe obserwacje, historyczną/aktualną kompletność oraz domyślne daty profilu. Poprawki są objęte regresjami.

## Ograniczenia i stan zdalny

- Nie wykonano real-browser QA V5.1. Testy DOM/VM nie potwierdzają wyglądu w przeglądarce ani dostarczalności maili.
- Kontakt nadal przygotowuje draft/TXT i ewentualny mailto; nie ma trwałego backendowego przyjęcia i powiadomienia. To część następnego etapu.
- Automatyczna cena pod dom wymaga brakujących danych i kwalifikacji podatkowej/kursowej; ręczne wypełnienie budżetu tego nie zastępuje.
- Produkcyjny schemat i dane trzeba ponownie odczytać w uwierzytelnionym koncie. Deklaracja UUID w env nie dowodzi rzeczywistego bindingu; lokalne testy używają SQLite i builda, nie zdalnej D1.
- Wyłączony `wrangler.release.jsonc` **nie służy do deployu na istniejący mtbid**: zwróci 503. Aktywację przygotowuje się osobno po kryteriach wydania.
- Nie wykonano pushowania, deployu, DNS, migracji, zdalnych zapisów D1, backfillu, Cron ani nowych żądań Apibara.
- Ponowne `wrangler whoami` w tej sesji: **You are not authenticated**. Nie uruchamiano logowania ani tymczasowego konta preview.
- Jednorazowy GET Home stagingu: 200, obecny V4 bez CSS nowego portalu. Jednorazowy odczyt rexbid.pl: 502 w tym środowisku; to nie rozstrzyga globalnej dostępności ani DNS.

Następny zakres, pierwsza grupa danych i warunkowy szacunek czasu: [REXBID_PRODUCTION_NEXT_STAGE_2026-10-06.md](REXBID_PRODUCTION_NEXT_STAGE_2026-10-06.md).
