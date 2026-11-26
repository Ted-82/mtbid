# Zakończenie importu i czytelna paginacja — 26.10.2026

## Wynik i zakres

Zakończono import wszystkich 7451 zachowanych stron Copart/IAAI Open/Live o 17:51:39 UTC. Końcowy audyt 17:52:21 UTC: **149 633 zapisane oferty** w produkcyjnej D1, w tym 78 123 Copart i 71 510 IAAI; 155 746 snapshotów i 20 990 wydarzeń. Są to oferty różnych statusów, nie liczba aktualnie otwartych aukcji.

Rozliczenie wejścia: 148 961 rekordów = 144 750 insertów + 2384 aktualizacje + 1769 odrzuceń `AUTOMATIC_REFRESH_IDENTITY_INVALID` + 58 pominięć starszych danych. Każde 147 134 zapisów/aktualizacji ma readback. Liczba ta nie jest liczbą unikalnych ofert. 17 pominięć dotyczy starszej wersji źródła, 41 starszej obserwacji. Odrzucone rekordy zachowano w diagnostyce; nie należy traktować ich jako nieistniejących u dostawcy.

Wszystkie 7451 stron rozliczono bez powtarzania ukończonych stron. Kursory końcowe: Copart Open 3930, IAAI Open 3519, Live 1/1. Timed było osobnym uzupełnieniem 148 ofert opisanym w poprzednim raporcie. Audyt wykazał 249 flag Timed wszystkich statusów — nie deklarować 249 aktualnych ofert.

**To zakończony import pobranych plików, nie dowód pełnego rynku aktualizowanego na żywo.** Obserwacje źródła pochodzą z 11:14:59–13:22:08 UTC; czas zakończenia zapisu nie zastąpił tych dat. Listy u dostawcy zmieniały się podczas pobierania. Nie ukryto informacji o częściowym katalogu.

## Zmiany kodu i wydania

- Licznik mówi „Wyświetlono 20 ofert. Dostępne są kolejne wyniki”, gdy API ma następny kursor. Nie przedstawia pierwszej strony jako całego wyniku. Nie dodano kosztownego COUNT ani domyślonej liczby ofert.
- Doładowanie, zmiana listy/kafelków, ulubione, zmiana sesji i powrót z karty zachowują informację o kolejnych wynikach.
- Kolejne zdarzenie tego samego LOT nie kasuje przyszłego terminu ponowienia po błędzie odczytu szczegółów. Zachowano specjalne blokady błędnej tożsamości. Stream nadal nie jest zasiany.
- Lokalny operator importu obsługuje 1–3 strony w partii. Końcówkę wykonano po 1 stronie (20 rekordów), co ogranicza zakres niepewnej operacji przy zerwaniu połączenia. Nie zastępuje to weryfikacji wyniku transakcji.

Wersje wdrożone i zweryfikowane:

| Środowisko | Worker/version |
| --- | --- |
| Produkcja rexbid.pl | `rexbid-production-preflight`, `f23d42b2-a761-4835-95db-175ffdca6eaf` |
| Staging | `rexbid-auth-test`, `ea122f2f-6c11-40ec-93f5-a19eefedeb7d` |
| Poprzednia produkcja | `d8d254d5-6be9-4a95-ba11-e1b4ec7d36e6` |
| Poprzedni staging | `151b6846-fa39-4254-80ea-320e8b4ef2df` |

Punkt kodu przed etapem: `d49bb49`. Lokalny checkpoint tego etapu to commit dodający ten raport. Brak nowej migracji, zmian DNS, ról, MFA lub kalkulatora. Profil `portal-no-files` pozostaje aktywny.

## Weryfikacja

- Pełna regresja: **1613/1613 PASS**, 0 błędów. Osobno 4/4 testy offline operatora wielkości partii PASS.
- Produkcja: przejście przez wszystkie kursory dla czterech marek, rocznik od 2025; HTTP 200, właściwy rok/marka/platforma, daty obserwacji, brak powtórzeń identyfikatorów i kursorów.

| Marka, rok >=2025 | Wyniki zapisane w katalogu | Copart | IAAI | Strony API po 50 |
| --- | ---: | ---: | ---: | ---: |
| Audi | 72 | 38 | 34 | 2 |
| Subaru | 253 | 162 | 91 | 6 |
| Mercedes-Benz | 185 | 112 | 73 | 4 |
| Volvo | 64 | 37 | 27 | 2 |

Pomiar 17:55–17:56 UTC, bez filtra „Aktualne aukcje”; nie porównywać tych liczb bezpośrednio z liczbą otwartych aukcji innej strony. Same roczniki pochodzą z danych źródłowych; nie jest to niezależna weryfikacja producenta.

- Przeglądarka staging: Timed 20→40, karta i powrót przywraca 40 ofert.
- Przeglądarka produkcyjna: Subaru 2025+ 20→40; karta i powrót zachowują 40, markę, rok, sortowanie i widok listy. Brak błędów konsoli.
- Mobilny viewport 390×844: licznik czytelny, dokument 375 px, bez poziomego przepełnienia. Nie jest to test fizycznego iPhone'a.
- Audyt obu D1: FK/duplikaty/błędne relacje VIN–platforma–LOT/brakujące źródła/osierocone snapshoty = 0; osiem chronionych tabel każdego środowiska zgodne SHA/count z wcześniejszym stanem.
- Publiczne ceny D1: `current_bid` 78 840 NULL, 70 793 dodatnich, 0 zerowych. Raport nie utożsamia NULL z zerem. Zdalny `integrity_check` nie jest obsługiwany; integralność kopii sprawdzono podczas odtworzenia backupu, pozostałe kontrole relacji wykonano w D1.

## Odzyskanie po przerwaniach

Początkowe zatrzymanie dotyczyło odczytu HTTP 200 z niepoprawnym JSON. Późniejsze przerwania zapisu rozliczono przed wznowieniem: wszystkie 60, a następnie 20 pozycji miały dowód braku commitów, niezmienione kursory i brak nowych snapshotów. Nie odtwarzano transakcji o nieznanym wyniku. Zachowano konserwatywne pełne rezerwacje kosztu. Starszy przypadek 60/60 COMMIT opisany w poprzednim etapie pozostał bez replay.

Końcowy stan: proces importera zakończony exit 0; pending 0, brak pliku niepewnego requestu i lokalnego locka; lease owner/until i blocked_reason NULL. Nie uruchamiać importera ponownie na ukończonych stronach.

## Aktualność i następny etap

Zwykły Cron pozostaje co 15 minut, z limitami 500 requestów/dzień, 12 000/miesiąc, 8/przebieg i 2000 nowych ofert/dzień. Nie oznacza odświeżenia każdej z 149 tys. ofert co 15 minut. Timed ma osobne kursory; bootstrap ustępował mu dopiero po zwolnieniu wspólnej lease. **Autonomiczny przebieg po imporcie 18:00:22–18:02:11 UTC PASS:** 8 prób i 8 odpowiedzi, 45 aktualizacji, 1 strona, 507 operacji D1; 0 błędów, odrzuceń i ponowień. Zakończenie `run_limit`, poprawny `last_success_at`, lease zwolniona, `blocked_reason` i `pause_until` NULL. Odczyt dowodu 18:02:57 UTC był wyłącznie SELECT; nie wyzwalano przebiegu ręcznie.

**Nie seedować jeszcze globalnego streamu od checkpointu 36461474.** Z zachowanego pomiaru: różnica sekwencji +135 719 w 33 min 19 s (możliwe luki), pierwsze 500 zdarzeń obejmuje 17 s i 500 różnych pojazdów. 473 z 500 wymagają aktualnie odczytu szczegółów z powodu nieobsługiwanych pól. Obecna przepustowość 500 zdarzeń/15 min, czyli 48 tys./dobę, oraz 2 uzgodnienia szczegółów/przebieg nie zapewniają nadążania. Jedna strona wykorzystuje około 655 operacji SQL, co może wypierać Timed z budżetu. Samo zwiększenie liczby stron bez zmiany przetwarzania nie rozwiązuje problemu.

Następny etap: aktywny dostęp do Sync Center po zmianie planu na Pro lub opracowanie i zmierzenie skalowalnej obsługi zdarzeń, uczciwy podział pracy z Timed, kontrolowany catch-up oraz dowód, że zaległość maleje. Dopiero wtedy włączyć i opisać zakres aktualizacji całego katalogu. Nie deklarować rzeczywistej licytacji przez REXBID.

## Koszty i dowody

Nowy abonament: **brak**. Jedna kontrola usage 17:43:44 UTC: Apibara **Basic**, 7777/30 000 użytych, 22 223 pozostałych. To odczyt sprzed późniejszych 8 prób automatycznego Cron, nie końcowe naliczenie konta. Pro nie jest jeszcze potwierdzone; właściciel uzgadnia rozliczenie 25 USD i metodę płatności. Nie kupować ponownie Basic ani Pro bez uzgodnionego procesu.

Zapis zachowanych odpowiedzi i publiczne QA nie wykonują requestów Apibara. Zwykły Cron może oddzielnie zużywać pulę. Pomiar całego konta D1 17:51:14 UTC: 2 776 395 zapisanych i 51 440 087 odczytanych wierszy tego dnia; nie jest to wyłącznie koszt niniejszego etapu. Lokalne rozliczenie operatora obejmuje rzeczywiste metadata odpowiedzi i pełne rezerwacje dla niepewnych odpowiedzi.

Dowody lokalne, poza repozytorium: `C:/Users/nowic/Documents/Codex/REXBID_INVENTORY_20261026/`:

- `full-import-final-audit.json`, `import-checkpoint-20261026.json`, `bulk-imports.ndjson`;
- `completion-public-qa.json`, `public-qa-pages.ndjson`, `completion-provider-usage.json`;
- `tests-completion-stage.log`, `deploy-completion-stage-production.log`, `deploy-completion-stage-staging.log`;
- `katalog-subaru-produkcja.png`, `katalog-subaru-mobilny.png`, `completion-browser.json`;
- `post-import-cron-readonly.json` — osobny odczyt rzeczywistego schedulera.

Surowe dane pozostają w `private-data/rexbid-full-inventory-20261026`; kopie przed importem w `private-backups/rexbid/inventory-before-20261026`, nowsza kopia przed Timed w `private-backups/rexbid/timed-before-20261026`. Kopie DPAPI i odtworzenie zweryfikowano wcześniej. Nie umieszczać kluczy ani plików prywatnych w Git.

## Wycofanie

Dla regresji UI/cofania ponowień można przywrócić poprzednie wskazane wersje Workerów. Nie przywracać starej D1 tylko po to, by cofnąć UI: utraciłoby to ukończony import i mogłoby cofnąć późniejsze dane. Zmiany importu są addytywne i chronione wersją/obserwacją; korekty danych wymagają konkretnego zestawu i porównania z zachowanymi odpowiedziami. Zachować dziennik i dowody odzyskania.
