# Import Pro i zgodność rzeczywistych aktualizacji — 28.10.2026

## Końcowy wynik, 28.10.2026 21:27 UTC

Import początkowy #4548 zakończony na produkcji o20:53:43UTC: **203226/203226**,
96150insert /99595update /1755reject /5726skip. Produkcyjna baza ma247340ofert:
164838Copart i82502IAAI. RozmiarD1 1469243392B. Osiem tabel chronionych bez zmian,
FK0, duplikaty0, pending0, nierozliczone rezerwacje0, blokada zwolniona.
Źródło: `REXBID_PRO_ACTIVE_20261028/snapshot-final-production-audit.json`.

Publiczne API przeszło całą paginację roczników>=2025: Audi125(3strony),
Subaru455(10), Mercedes-Benz271(6), Volvo103(3), brak duplikatów lub błędnych
roczników/marek/platform. To liczby zapisanego katalogu, nie gwarancja aktualnej
dostępności wszystkich aukcji. Browser potwierdził doładowanie Subaru20→40,
bez błędów konsoli. Dowody `snapshot-completion-public-qa.json`,
`snapshot-public-qa-pages.ndjson`, `production-completed-catalog.png`.

### Plikowy importer zmian — lokalnie i staging

Nowe moduły `sync/feed-change-import.cjs` i `scripts/feed-change-pages.cjs`:
pełna weryfikacja SHA indeksu, grupowanie całych historii LOT, atomowe zmiany wraz
z kolejką uzupełnień, porównanie pierwotnych danych i źródła przed zapisem,
blokada Cron, checkpoint i audyt partii. Wznowienie i powtórzenie kontrolują hash
tej samej treści; nie podnoszą dat świeżości ani globalnego kursora.
44/44 testów integracji PASS (`REXBID_PRO_CHANGES_20261028/integrated-tests.log`).

Świeża kopia staging przed próbą:50075071B SQL,
SHA256d0f8455370c2a05dbf38cb778301bcc2304756a5958eaa343d71a1b4273498b1,
DPAPI/ACL, odtworzenie4935ofert i8chronionych tabel PASS.
Próbka rzeczywistych zdarzeń wybrana lokalnie:1888zdarzeń136LOT. Zapis95zmian
w pierwszych100grupach; wznowienie od100 kończy136, łącznie131zmian i131zadań
uzupełnienia. Wszystkie136ofert sprawdzone pole po polu po zapisie; daty świeżości
bez zmian, globalny stream bez zmian, chronione tabele bez zmian. Próbka ma lokalną
etykietę generationId1, nie jest pełną paczką dostawcy. Powtórny odczyt pierwszej
partii: `alreadyApplied=true`, 100/100 ofert bez ponownych zmian, checkpoint136;
`trial-replay.json` PASS o21:20UTC.

Pierwsza próba D1 nie zapisała danych: `Expression tree is too large (maximum
depth 100)`, kod7500. Niezależny SELECT warunku i EXPLAIN potwierdziły przyczynę.
Checkpoint/audyt nie powstały, wszystkie100wierszy zgodne z baseline. Zapisano
`staging-change-noncommit.json`, rozliczono pełną rezerwację3090writes/51500reads
bez zwrotu limitu, zachowano odrzucone żądanie. Warunek zmieniono na NULL-safe
row-valueIS; zachowuje wszystkie porównania, działa w rzeczywistej D1.

Dodane pliki: 4996 (65 435 zdarzeń, 1 kwarantanna), 5006 (88 725, 0),
5017 (71 522, 2), 5029 (90 905, 1). Łącznie z wcześniejszymi: 3 656 876 zdarzeń,
sekwencje 40563105–44267593, do 21:09:24 UTC. Ostatnie cztery nie są jeszcze
w czteroplikowym indeksie.
Wszystkie pełne paczki zmian pozostają NIEZASTOSOWANE do produkcji. Automatyzacja
30min wymaga wdrożenia operatora, pełnego readback, uzupełnień brakujących LOT,
pomiaru przepustowości i wyjaśnienia dat bez strefy czasowej.

Bez nowej płatnej usługi. Import plików i próba staging:0zapytań Apibara.
Poniższe wcześniejsze notatki o trwającym imporcie są historią, nie bieżącym stanem.

---

## Stan w trakcie wykonania, 19:06 UTC

Import produkcyjny #4548 nadal trwa. Sprawdzono 70 500 z 203 226 rekordów:
67 244 nowe, 3105 aktualizacji, 101 odrzuceń tożsamości i 50 starszych wersji pominiętych.
To nie jest wynik końcowy. Każdy przyjęty zapis ma odczyt kontrolny.

Źródłem aktualnego postępu i wyniku jest folder
`C:/Users/nowic/Documents/Codex/REXBID_PRO_ACTIVE_20261028`:

- `full4548-publication-progress.json` — postęp co 25 partii;
- `full4548-publication-batches.ndjson` — każda zakończona partia;
- `full4548-publication-result.json` — wynik zakończonego przebiegu;
- `full4548-publication-error.json` — ewentualne zatrzymanie;
- `full-import-day-usage.json` — okresowy odczyt zużycia całego konta D1.

Operator `C:/Users/nowic/Documents/Codex/rexbid-snapshot4548-import.cjs publication 3400`
działa od 18:16 UTC. Nie uruchamiać drugiej kopii. Limit przebiegu wynosi dwie godziny;
ewentualny dalszy przebieg zaczyna od trwałego checkpointu. Najpierw sprawdzić, czy
proces zakończony, czy nie ma nieuzgodnionego pliku pending ani rezerwacji w dzienniku
budżetu. Brak odpowiedzi na zapis nie oznacza rollbacku. Nie usuwać blokad lub pending
bez dowodu z D1 i rozliczenia rezerwacji.

## Kopia i próby

Backup produkcji: 850 266 107 bajtów SQL, SHA256
`3aacac81ef94b89b2d358a40197e3fec4c563e960585829d3f52b3ff165c8855`.
DPAPI CurrentUser, ACL właściciel/SYSTEM, porównanie po odszyfrowaniu PASS.
Odtworzenie strumieniowe UTF-8 do SQLite w pamięci PASS: 151 190 ofert przed importem,
osiem chronionych tabel, integralność poprawna, brak duplikatów i błędów FK.
Pliki prywatne w `Documents/Codex/private-backups/rexbid/snapshot4548-production-before-20261028`.
Nie odtwarzać całej kopii produkcji tylko w celu cofnięcia kodu: nadpisałoby to późniejsze dane.

Rzeczywista próbka snapshotu (100 Copart + 100 IAAI) na kopii lokalnej i staging:
101 insert / 99 update, wszystkie odczytane kontrolnie, osiem chronionych tabel bez zmian.
Wznowienie 20 → 200 i powtórzenie bez duplikatów PASS. Dodatkowa partia 60 rekordów
z pełnego pliku na staging PASS. Pełny plik staging nie został zaimportowany.
Pierwsza nowa produkcyjna karta Copart58031866 sprawdzona w przeglądarce, bez błędów konsoli.

## Zmiany implementacji

- Partie snapshotu: opcjonalnie 60 rekordów zamiast 20; trzy niezależne odczyty
  przygotowujące, jeden atomowy zapis danych, audytu i checkpointu. Domyślnie nadal 20.
  Wznowienie nie może zmienić rozmiaru partii. Starsze checkpointy pozostają zgodne.
- Zachowanie `updated_at` każdego auta, bez nadawania świeżości datą pobrania pliku.
- Puste mapy zdarzeń zapisane przez dostawcę jako `[]` stają się pustymi obiektami.
  Tablice niepuste, niepoprawne tożsamości i terminalność nadal są odrzucane.
- Odbiór pliku może jawnie zinwentaryzować uszkodzony VIN w kwarantannie. Oryginalne
  bajty pliku pozostają zachowane; zwykły parser nadal odrzuca taki wpis. Manifest
  zawiera sekwencję, LOT, powód i hash linii. Brak zgody na pominięcie wpisu przy
  zatwierdzaniu kursora bazy. Maksymalnie 100 takich wpisów na plik.
- Flagi 0/1 rzeczywiście występujące w pliku są obsługiwane ściśle, bez konwersji
  dowolnych tekstów. Data bez strefy czasowej nie jest zgadywana: kierowana do
  uzupełnienia; pozostała poprawna cena może zostać zastosowana.
- Surowe etykiety `details.source_sale_type` i pomocnicze `auction.upcoming` nie
  powodują pobrania pełnej karty dla każdej zmiany ceny. Nie są używane w modelu
  REXBID i nie stanowią dowodu aktywności, ponownego otwarcia lub świeżości aukcji.
- Zmiany jednego LOT w partii nadal oceniane są kolejno, ale do D1 trafia jeden
  końcowy UPDATE. Początkowe warunki CAS, atomowość checkpointu, trwała kolejka
  uzupełnień i kontrola równoległego zapisu pozostają zachowane. Nawet wynik
  wracający do starej ceny sprawdza pierwotny stan przed zatwierdzeniem kursora.

263/263 testy synchronizacji, dostawcy, budżetów, Timed, rollbacku i wznowienia PASS
(`sync-final-tests.log`). W teście 40 zmian ceny tego samego LOT wymaga jednego
UPDATE zamiast 40. Przypadek 500 zmian dwóch LOT pozostawia teraz budżet SQL na
dwie strony Timed i szczegóły; nie podniesiono limitów wywołań ani SQL.

## Zachowane paczki zmian i pomiar

| Generacja | Zdarzenia | Sekwencje | Kwarantanna |
| --- | ---: | --- | ---: |
| 4948 | 3 052 000 | 40563105–43658631 | 6 |
| 4959 | 113 806 | 43658632–43772525 | 0 |
| 4972 | 96 000 | 43772526–43870243 | 2 |
| 4985 | 78 483 | 43870244–43948965 | 1 |

Pliki zapisane poza repozytorium, hash/CRC/UTF-8/JSON/kolejność/duplikaty sprawdzone.
Pierwsze dwie paczki obejmują okres od 27.10 15:58:15 do 28.10 18:09:26 UTC, trzecia
do 18:45:49 UTC. Granice między tymi plikami są kolejne. Powiązanie numeru generacji
oparte jest na widocznym linku, liczniku UI, czasie modyfikacji i hashu pobrania;
serwer `/latest` nie dostarczył jawnego identyfikatora generacji w zapisanym dowodzie.
Nie oznaczać tego jako dowodu zastosowania zdarzeń ani zatwierdzonego globalnego kursora.

Lokalna próba na samym snapshotcie (nie aktualnej produkcyjnej D1) oraz 3 165 806
zdarzeniach z #4948/#4959:

- błędy planowania formatu: 58 378 → 0, sześć uszkodzonych wpisów nadal w kwarantannie;
- LOT wymagające dodatkowego odczytu: 158 046 → 117 621;
- 108 690 znanych LOT ma końcową zmianę w symulacji;
- 52 869 różnych LOT nie występuje w początkowym snapshotcie.

Ostatnie liczby są pomiarem lokalnego modelu, a nie liczbą braków produkcji. Potrzebne
są jeszcze wydajny importer plików zmian, sprawdzenie kolejki uzupełnień, przepustowość
przewyższająca napływ zmian i pomiar opóźnienia. Dotychczasowy globalny stream pozostaje
wyłączony. Nie seedować go najnowszą sekwencją ani nie nazywać pełnego rynku „live”.

## Koszty, publikacja i kolejny krok

Bez nowej płatnej usługi. Pliki są objęte Pro; dwa odczyty operatora sprawdziły
faktyczny `X-Per-Page-Limit: 20`. Pierwszy odczyt nie zapisał raportu przez lokalny
błąd raportowania, drugi potwierdził limit. Import sam nie odpytuje Apibary.
Limity ochronne operatora D1: 8 mln zapisów / 450 mln odczytów całego konta na dzień,
kontrola miesięcznego pakietu i rezerwy. To ograniczenia aplikacji, nie twardy limit rachunku.

Commit6a12840 wdrożono: Worker produkcyjny `a31b016e-3bcb-4ebf-9c1d-aef131f276ef`,
staging `48580263-4f92-4688-b2f6-56f97552f278`. Kontrola karty Copart58031866
w obu przeglądarkach PASS, brak błędów konsoli, zachowana data źródłowa.
Poprzedni Worker produkcyjny
`cfafd57a-8fd6-4fbe-8ad9-15d0b1b6f6dc`, staging
`33a2d9f1-6dcc-4a3b-9691-9c1389e69142` — stan do rollbacku kodu.
Kontrola konfiguracji `portal-no-files` PASS, bez zmiany DNS, kont, MFA, kalkulatora
lub udostępniania plików klientom.

## Wznowienie i przygotowanie aktualizacji, 19:40 UTC

Pierwszy przebieg zatrzymał się po106380rekordach przez ograniczenie statystyk
GraphQL Cloudflare. Odczyt potwierdził brak niepewnego zapisu/rezerwacji i zwolnioną
blokadę. Wznowiono od dokładnego checkpointu; limit odczytu statystyk co10min,
jednorazowy5minbackoff dla samego odczytu, bez automatycznego powtarzania zapisów.
Pakiet miesięczny weryfikowany konserwatywnie na tym samym dziennym pomiarze,
całym lokalnym rejestrze i pełnym dozwolonym limicie importu. Nowy wydatek0.

Nowy lokalny indeks zmian (`scripts/feed-change-index.cjs`) zachowuje wszystkie
oryginalne zdarzenia i kwarantannę, grupuje platforma/LOT/sekwencja; sprawdza hash
każdego pliku, granice paczek, duplikaty i integralność SQLite. Publikacja indeksu
atomowa; przerwana próba nie pozostawia częściowego indeksu do użycia. 6/6testów
PASS. Próba rzeczywistych czterech paczek:3340289zdarzeń,174590LOT,9kwarantann,
94,6s. Dane poza repo, bez API i D1. Indeks nie jest migracją ani zatwierdzeniem
kursora. Potrzebny jeszcze operator zastosowania zmian z bezpiecznym wznowieniem,
trwałą obsługą brakujących szczegółów i testem przepustowości.

`sync/inventory-change-group.cjs` przygotowuje jeden końcowy zapis na LOT z jego
oryginalnym warunkiem porównania. Wszystkie zdarzenia nadal oceniane kolejno,
wartości null zachowane, brak podbijania świeżości całej karty. Nawet wynik bez
końcowej zmiany zachowuje kontrolę wcześniejszego stanu; konflikt VIN w dowolnym
zdarzeniu blokuje wszystkie zapisy danej grupy. Potrzeba uzupełnienia szczegółów
pozostaje jawna. Kod sam nie zapisuje D1 ani nie przesuwa kursora.

Łącznie14/14testów indeksu i grupowania PASS. Próba rzeczywista: odczyt200ofert ze
staging,136grup/1888zdarzeń z zachowanych plików;131końcowych zmian i4wyniki
wracające do poprzedniej wartości. Wszystkie końcowe wartości i stare daty
obserwacji zweryfikowane na jednorazowej SQLite w pamięci. **Zero zapisów na
serwerze**, zero zapytań dostawcy.131grup nadal wymaga uzupełnienia szczegółów,
więc ta próba nie stanowi potwierdzenia kompletności danych ani automatu.
Dowód `change-group-staging-rehearsal.json`.
