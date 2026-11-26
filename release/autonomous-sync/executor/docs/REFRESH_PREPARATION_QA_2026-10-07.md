# Przygotowanie świeżego katalogu i domknięcie nowych kontroli

**2026-10-07. Kontynuacja e00604f408efd3e7de7eecb1b3ebe2ddc4fb7986.** Bez resetu, wywołań danych Apibara, zapisów zdalnych, migracji, deployu, zmian DNS lub pusha. Zachowano wdrożony staging **4a6bfcf9-4ecb-43fb-8943-0b246d7bc484** i prywatny preflight **0a876baa-7b80-44ce-9d85-602ff8c82314**.

## Nowe rzeczywiste odczyty

- **D1 publikacyjna, 21:19:09 CEST:** potwierdzono nazwę i UUID `rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d`. Copart **352**, IAAI **227**, razem **579 listingów**; media odpowiednio **134/147**, razem **281**. Duplikaty `(platform, LOT)` **0**. Users/favorites/orders/messages/files **0**. Oba scope partial, bez cursorów importowanych ze stagingu.
- Oryginalne obserwacje pozostają **2026-09-29T20:01:13.556Z → 2026-10-05T21:34:05.046Z**. Nie nadano im świeżości przez odczyt lub import. API key obecny tylko w metadanych; dostęp providera **NOT VERIFIED**.
- Aktualne zapytania dotyczyły wyłącznie tej odseparowanej D1. Poprzedni stagingowy readback i właścicielskie E2E pozostają wcześniejszymi dowodami, nie nowymi pomiarami.
- **Przeglądarka stagingu:** `/panel` zakończył bootstrap i wyświetlił prośbę o zalogowanie. Nie ma dwóch dostępnych zalogowanych sesji testowych. Nie odczytywano haseł, QR ani kodów; nie resetowano MFA. Nowy rzeczywisty unread E2E **NOT VERIFIED**. Jeden skonsolidowany test dwóch istniejących kont: [instrukcja](PUBLICATION_REFRESH_APPROVAL.md#5-jeden-ręczny-test-nieprzeczytanych--tylko-staging).
- **DNS:** pełne OVH **12/12 na każdym serwerze**, aktualny Cloudflare zone API200/pending/Free z dokładnymi NS blair/titan, records API403. b-dns.pl DS0; a-dns.pl timeout, więc nowy direct odczyt obu **NOT VERIFIED**. Szczegóły i czasy w [raporcie DNS](DNS_READINESS_REFRESH_2026-10-07.md). Niczego nie zmieniono.

Dowody poza Git w `C:/Users/nowic/Documents/Codex/`: `REXBID_REFRESH_PREPARATION_READONLY_20261007.json`, `REXBID_REFRESH_DNS_CF_METADATA_20261007.json` i receipts z raportu DNS. Brak wartości sekretów i danych prywatnych w raporcie.

## Nowe poprawki kodu i ich dowód

1. Faza publikacji `catalog` usuwa linki do nieuruchomionych kont i portalu w rzeczywistych szablonach Home/Car/Favorites/Contact/Guide/About. Direct URLs dostają czytelny stan 404 z dostępnymi odnośnikami. Testy wykonują handler natywnego HTMLRewriter przez lokalny adapter DOM. Późniejsze fazy Auth oraz działający staging zachowują swoje funkcje.
2. Home i D1 category query wymagają pozytywnego potwierdzenia dostępności; unknown/conflict lub sam timestamp/cena nie wystarczają. Karta i kafelek zachowują kwoty jako zapis danych, bez deklaracji aktualnej oferty i countdownu. Pełny zapisany katalog nadal jest dostępny. Zmieniony asset rynku ma nowy parametr wersji cache.
3. Mechanizm publikacyjnego refresh jest niezależny od publicznych tras i domyślnego transportu. Lokalna SQLite oraz rzeczywisty adapter z syntetycznymi odpowiedziami sprawdzają platformę/LOT, zachowanie historycznych dat, partial merge, źródłowe active/ended/unknown, replay/zmiany/powrót ceny, atomowy commit/cursor, lease, crash, wspólny i platformowy budget oraz ograniczone retry.
4. Dodatkowy niezależny review wykrył i zamknięto dwa przypadki: stare ceny dziedziczące nową datę po częściowej odpowiedzi oraz błędna struktura listy traktowana jak poprawnie pusta. Nieotrzymane lub nieprawidłowe ceny bieżące pozostają nieustalone; kontrola Number.isFinite obejmuje także pustą wtórną cenę, NaN, Infinity i niepoprawne typy, zachowując liczbowe zero; wcześniejsze snapshots zachowują poprzednie kwoty. Nie generowano potwierdzonych auction events.
5. Pełny suite wykrył izolowane fixtures starszego kontraktu bez jawnego canonical `auction.state`. Zachowano pozytywne testy Open/Live, ceny, primary render i awarie secondary modules; dodano kontrole Unknown. Nie usunięto assertions, plików testowych ani pokrycia.

Kontrole kontaktu, lokalnych ulubionych, normalizacji galerii i braku mediów pozostają w uruchomionym suite. Nie powtarzano całego wcześniejszego ręcznego desktop/mobile QA bez nowej potrzeby. Lokalny DOM lub dry-run nie dowodzą dostępności obrazu na zewnętrznym serwerze ani runtime publicznej domeny. Nowe lokalne poprawki **nie zostały jeszcze wdrożone**; dotychczasowy staging pozostaje zachowany.

## Kontrole końcowe

Dokładny wynik pełnego suite i składni znajduje się w aktualnym [handoffie](../PROJECT_HANDOFF.md). Oba generatory stawek `--check` zachowują **610 lokalizacji, 24 sea rates, wersję rex-partner-v4-f0a67460b203286f**. Walidatory Workera/preflightu/publikacji i lokalny Wrangler dry-run nie aktywują żadnej funkcji. Log suite: `REXBID_REFRESH_PREPARATION_TESTS_20261007.log`, poza Git.

## Co jest przygotowane, a co czeka

- [Plan odświeżenia](PUBLICATION_REFRESH_APPROVAL.md): **maks.64 / 32 na platformę, retry0**, do zatwierdzenia. 200 jest wyłącznie wcześniejszą propozycją, nie zgodą.
- Future driver wymaga połączenia ze stałym UUID potwierdzonym rzeczywistymi metadanymi, zaakceptowanego manifestu/campaign ID, ledgeru transportu i świeżego backupu. W tym etapie przygotowano bibliotekę/testy; nie podłączono aktywnego transportu.
- [Publikacja i rollback](PRODUCTION_CUTOVER_RUNBOOK.md): katalog/V4/kontakt/local favorites, partial metadata, bez Auth/portal/files/provider fallback/Cron. Świeże dane, DNS i deploy to odrębne zgody. Obecne mtbid/rexbid-db pozostają nietknięte.
- Dostępność wszystkich znanych LOT-ów nie została odświeżona, nowych maili nie wysłano, rzeczywisty unread test czeka na właściciela, produkcyjny TLS/Auth/MFA/R2 nadal nie są dowodami tego etapu. Kalkulator pozostaje uczciwie niepełny przy brakach partnera.
