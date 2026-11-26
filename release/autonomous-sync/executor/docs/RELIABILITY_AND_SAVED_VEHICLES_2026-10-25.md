# Katalog, wydajność i ulubione — 25.10.2026

## Zakres i punkt odniesienia

Kontynuacja `c7d573a5a1b2013ec4789f85153c9a615a5fb1de`. Prace na istniejącej produkcji `rexbid-production-preflight` / rexbid.pl i stagingu `rexbid-auth-test`. Apibara wygasła według właściciela: **zero nowych requestów**, OPERATOR_STOP pozostaje. Historyczny STOP56 i dziennik 7293 prób nie są zerowane ani wznawiane.

## Odzyskanie ostatniego zapisu

- Ostatnia odpowiedź kampanii20.10: nr2262, Copart LOT62395976, Ford Explorer2020, VIN1FMSK8DH8LGA92502. SHA odpowiedzi `3fcb6d16fe33ebf686c62b8ab1a613b7d4d9114ddf8103c5aed65f5a1a5dd78e`.
- Odczyt kontrolny wykazał, że końcowa obserwacja nie została zapisana: wcześniejsza oferta7100USD, brak wydarzenia i receiptu. Nie zakładano powodzenia na podstawie samej odpowiedzi providera.
- Zweryfikowana kopia obu D1: DPAPI CurrentUser, ACL właściciel/SYSTEM, SHA i odtworzenie RAM. Próba odtworzenia jednego zapisu zachowała dokładnie8301 wcześniejszych snapshotów i20989 wydarzeń oraz osiem tabel chronionych.
- Następnie zapis i readback PASS. Potwierdzona cena sprzedaży8700USD, jedno wydarzenie, receipt complete. Data źródłowej obserwacji nadal **20.10.2026,19:53:28.992UTC**; nie zmieniono jej na25.10.
- Nowy mechanizm `cached-detail-replay.cjs` dopuszcza tylko jedną zachowaną odpowiedź zgodną z hashem, specyfikacją i tożsamością. Nie otwiera starego journalu, nie uruchamia transportu providera. Kampania pozostaje nieukończona; rozliczono jej jedyny pending zapis.
- Niepewna historyczna rezerwacja D1 (300 zapisów/50000 odczytów) pozostaje zachowana, z osobnym opisem rozstrzygnięcia danych. Nie uznano jej rzeczywistego naliczenia za zero. Dzisiejszy replay ma własny journal i rzeczywiste metadane D1.

## Ulubione

- Widok gościa i konta pobiera najnowszy **zapisany** stan właściwego LOT/platformy z istniejącego API D1/cache. Zachowuje oryginalny snapshot ulubionego, członkostwo oraz funkcje porównania/usuwania.
- Kontrola VIN/LOT/platformy i daty: błędna tożsamość, starszy odczyt, błąd lub404 pozostawia wcześniejszy zapis z wyjaśnieniem.404 nie oznacza sprzedaży.
- Zero/null, oferta, Kup teraz, oferta warunkowa i cena sprzedaży mają odrębne znaczenia. Rzeczywista Tesla Copart57660876 przechodzi w widoku ze starej oferty5000USD na zapis sprzedaży9100USD, bez zmiany oryginalnych ulubionych.
- Limit12 widocznych aut na partię,3 równoległych odczytów,120 na otwarcie, timeout10s, deduplikacja i brak automatycznych ponowień. Żądania do publicznego API pomijają credentials. To nie są wywołania Apibara.
- Naprawiono oczekiwanie na inicjalizację Auth, zdublowane przyciski logowania, widoczność przycisku następnej partii oraz powrót z karty przez BFCache. Przy definitywnym opuszczeniu strony kolejka zatrzymuje się.

## Transfer publicznego katalogu i kontrola danych

Próba odtworzenia całego planu: PASS,320 partii,25076 poleceń. Plan ma utrwalone hashe i readback każdej partii; kopiowane są wyłącznie jawne kolumny katalogowe, historie i potwierdzenia pobrania. Dane klientów obu środowisk pozostają odrębne.

195 korekt wcześniejszych wydarzeń sprawdzono dodatkowo przeciwko195 zachowanym odpowiedziom z oryginalnego journalu: SHA odpowiedzi, normalizacja, LOT/platforma, kwota i status zgodne **195/195**. Pełne przed/po zapisano w audycie korekt. Nie tworzono wyniku aukcji z samego snapshotu.

Po279 ukończonych partiach guard zatrzymał pracę przed rezerwacją kolejnego zapisu: `D1_BUDGET_FRESH_ACCOUNT_USAGE_REQUIRED`. Kod porównywał czas odpowiedzi analityki do zegara sprzed await. Wolniejsza odpowiedź mogła wyglądać na późniejszą niż dopuszczone5s. Naprawiono pobranie zegara po await, zachowując kontrolę świeżości, rzeczywistej przyszłej daty i granicy dniaUTC.18/18 regresji. Readback partii279 zgodny ze stanem sprzed zapisu, brak otwartej rezerwacji. Oryginalny STOP zachowano w archiwum, kontrolowane wznowienie kontynuuje journal.

## Weryfikacja i wdrożenia

Etap ukończony. Produkcja https://rexbid.pl — **0857772d-98da-4f87-b804-c46395b799bc**. Staging https://rexbid-auth-test.tedn828.workers.dev — **ff88207a-ee41-447a-b915-d7bb5f8d38dc**. Profil `portal-no-files` zachowany. Nie wykonywano pusha.

### Dane przed i po

| Środowisko / zapis | Przed etapem | Po etapie |
| --- | ---: | ---: |
| Produkcja: oferty | 4535 | 4535 |
| Produkcja: snapshoty | 8301 | 8302 |
| Produkcja: wydarzenia aukcyjne | 20989 | 20990 |
| Staging: oferty | 1817 | 4535 |
| Staging: snapshoty | 3253 | 8302 |
| Staging: wydarzenia aukcyjne | 19044 | 20990 |

Transfer **320/320 partii**, 25076 poleceń, zakończony i sprawdzony przez readback. `audit-final.json`: duplikaty LOT/platforma, błędne powiązania wydarzeń i receiptów, nieprawidłowe kompletne receipty oraz FK — **0** w obu bazach. Osiem chronionych tabel każdego środowiska zachowało SHA i liczbę rekordów względem kopii sprzed kampanii 20.10.

Pełne porównanie względem kopii 20.10: wszystkie wcześniejsze snapshoty zachowane bez zmian (produkcja 4551, staging 3253); wszystkie wcześniejsze 19044 wydarzenia zachowane, bez zmiany tożsamości lub cofnięcia obserwacji. Zmiany treści 195 wydarzeń mają oddzielny, zgodny ze źródłem audyt opisany wyżej — nie deklarujemy ich bajtowej niezmienności. Dodatkowe indeksy nie zmieniły odcisków żadnej z 13 kontrolowanych tabel publicznych i prywatnych w żadnym środowisku.

### Pokrycie historii — oba środowiska

| Stan pobrania | Copart | IAAI |
| --- | ---: | ---: |
| Wszystkie zapisane oferty | 2106 | 2429 |
| Kompletna historia z wydarzeniami | 874 | 846 |
| Potwierdzony pusty wynik | 17 | 105 |
| Częściowa historia | 3 | 5 |
| Dotąd niepobrana historia | 1090 | 1428 |
| Nieudany odczyt | 122 | 45 |

Łącznie **1842** ukończone odczyty, **8** częściowych, **2518** niepobranych i **167** nieudanych. Zapisane URL-e mediów: Copart 2091/2106, IAAI 2427/2429; sama obecność URL nie gwarantuje dostępności każdego zdjęcia. Zakresy odkrywania ofert są właściwe dla środowiska (produkcja 8, staging 23); nie kopiowano ich jako danych klientów ani nie deklarujemy identyczności wszystkich tabel baz.

### Wydajność D1

Zastosowano **7/7 indeksów** z `docs/proposals/0009_public_catalog_read_indexes.sql`, najpierw staging, następnie produkcja. Próba na kopii, utrwalony plan, blokada zapisu kampanii, bieżący budżet, journal każdej operacji i EXPLAIN 7/7 PASS. Nowe narzędzia wymagają dowodu zatrzymanej, rozliczonej kampanii bez niepewnego zapisu; nie zastępują tego fałszywym statusem ukończenia całej kampanii.

Mediany produkcji z trzech powtórzeń każdego zapytania. Identyczne SQL, parametry, zamrożony czas i uporządkowane wyniki przed/po; po 27 odczytów na pomiar. To czas bazy, **nie czas ładowania całej strony ani wynik Core Web Vitals**.

| Zapytanie | Wiersze przed → po | Czas D1 przed → po, ms |
| --- | ---: | ---: |
| Pierwsza strona katalogu | 13605 → 42 | 32,58 → 4,07 |
| Katalog z platformą | 6319 → 42 | 20,07 → 3,71 |
| Katalog z marką | 5155 → 42 | 26,95 → 3,04 |
| Zakres pokrycia katalogu | 2033 → 9 | 1,04 → 0,46 |
| Timed | 1221 → 1220 | 5,19 → 6,25 |
| Timed z platformą | 1221 → 1220 | 2,93 → 3,75 |
| Kup teraz | 5845 → 5844 | 22,52 → 16,91 |

Wyniki 7/7 zapytań pozostały identyczne. Staging: główny katalog 13605 → 42 wiersze i 32,76 → 3,77 ms. Timed i Kup teraz zwracały pusty zestaw przy zastosowanej granicy świeżości; nie dowodzi to braku takich aukcji na rynku. Czas HTTP był zmienny, część zapytań nie przyspieszyła. Nie przypisujemy całej stronie jednolitego mnożnika poprawy.

### Rzeczywiście wykonane kontrole

- Pełny suite: **1223/1223 PASS**; regresje budżetu 18/18, ulubionych 15/15, osadzonego replay i dowodów indeksowania w tym samym suite. Składnia sześciu zmienionych skryptów i `git diff --check` PASS.
- Walidacja bieżącego profilu publikacji przez `validatePublicationConfig`: PASS `portal-no-files`. Wywołanie generatora `prepare-production-publication.cjs --check` bez wymaganego dowodu aktywacji nie było poprawnym poleceniem sprawdzającym; nie jest raportowane jako PASS.
- Stawki V4: 610 lokalizacji, 24 stawki morskie; hash `rex-partner-v4-f0a67460b203286f` bez zmian.
- Kontrole HTTP po wdrożeniu: **22/22 PASS**, obie domeny, asset zgodny z plikiem lokalnym, cztery API kart z D1 i właściwą tożsamością, `/ready` z zatrzymanym odświeżaniem oraz www 308 zachowujące ścieżkę i parametry.
- Staging, desktop i 390×844: istniejące dwa ulubione zachowane; Tesla 57660876 pokazuje sprzedaż 9100 USD, Honda 44593083 sprzedaż 2000 USD zgodnie z D1, zamiast starych snapshotów 5000/25 USD. Powrót z karty przez historię przeglądarki ponownie odświeża widok. Bez podwójnego logowania, zbędnego przycisku następnej partii i poziomego przewijania (375/375 px).
- Produkcja: wyszukanie LOT 62395976 → jedna właściwa karta → wpisanie 8700 USD → kontakt z VIN/LOT/platformą, datą i budżetem → karta → katalog z tym samym jednym wynikiem. Wiadomości nie wysyłano.
- Produkcja, Tesla Copart: 12/12 załadowanych miniatur, wybór drugiego zdjęcia, lightbox 2/12 → 3/12 i zamknięcie; historia pokazuje wydarzenie 08.10.2026, Sprzedano, 9100 USD. Własne 9100 USD + potwierdzony transport 1055 USD = częściowe 10155 USD. Braki nie są zerami ani ceną pod dom. Telefon bez poziomego przepełnienia.
- Produkcyjny pusty widok ulubionych konta sprawdzony bez dodawania/usuwania wpisów użytkownika. Rzeczywista próba dwóch kont klient–właściciel nadal **NIEWYKONANA**; jest odłożona przez właściciela. Obsługa cloud w nowych ulubionych ma regresje, ale nie jest zastępczym dowodem pełnego E2E kont.
- W bieżącym katalogu brak rzeczywistego current bid = 0; rozróżnienie 0/null potwierdzono regresjami, nie pozornym przykładem produkcyjnym.

### Zużycie i koszty

Odczyt 25.10.2026 20:08:37 UTC: `OPERATOR_STOP`, obie wartości lease null, 3254 próby automatu. Kampania ręczna 2262, łączny ledger **7293 bez zmian**. Ten etap **0 nowych requestów Apibara**. Odczyt 11249/30000 z 20.10 jest historyczny, nie aktualny stan wygasłego planu.

Cloudflare Analytics dla całego konta: w październiku 67796003 odczyty / 586042 zapisy D1; 25.10: 10861168 / 118002. Są to liczniki konta z chwili odczytu, z możliwym opóźnieniem analityki, a nie koszt samych naszych poleceń. Nie kupiono żadnego abonamentu ani dodatku; korzystano z wcześniej aktywowanego Workers Paid. Liczniki D1 i Apibara są niezależne.

## Kopie i rollback

Kopia przed naprawą: `private-backups/rexbid/recovery-before-20261025`. Końcowa kopia danych (przed indeksami): `private-backups/rexbid/reliability-after-20261025`, manifest 25.10.2026 19:32:24.115Z. DPAPI CurrentUser, ACL właściciel/SYSTEM, odtworzenie w RAM i zgodność SHA PASS:

- produkcja: 49221656 bajtów, SHA256 `543f75a6693e693311f7f370d3a856a31d87141decb8f1989bcb5b1f20f340b3`;
- staging: 47822720 bajtów, SHA256 `a0f7a55bd52b9398c261bbb0ca2fc3a6ebb4e013ae315428f09c5354b309f376`.

1. Przy regresji UI użyć przypiętego Wrangler 4.149.0, właściwego profilu i `rollback`: produkcja do **2eef63a9-32d3-4bb7-92de-8b43db92d933**, staging do **f0034777-cfca-48ed-aee5-b4afb0e7f26b**. Zachować aktualną D1 i OPERATOR_STOP. Sprawdzić katalog, kartę, ulubione, kontakt, konto, `/ready` i www 308.
2. Przy potwierdzonej regresji indeksów użyć odczytowego planu `index-rollback-plan.json`: po sprawdzeniu definicji usunąć tylko siedem indeksów utworzonych przez właściwy journal, przy zatrzymanych writerach, potem porównać odciski tabel i EXPLAIN. Plan nie wykonuje SQL automatycznie; wcześniejsze indeksy są wykluczone. Nie przywracać starej bazy dla cofnięcia indeksów.
3. Przy incydencie danych najpierw zachować kopię stanu po incydencie, odtworzyć zweryfikowaną kopię w izolacji i przygotować naprawę właściwych rekordów z CAS oraz audytem przed/po. Nie nadpisywać nowszych danych klienta pełnym starym backupem. Audyt 195 korekt zawiera dane do selektywnego wycofania; nie cofnięto ich w tym etapie.

## Następny punkt pracy

Możliwy bez Apibara: uporządkowanie etykiet filtrów z rzeczywistej bazy (pozostałe angielskie uszkodzenia/nadwozia, techniczne `danger/success` w filtrze dokumentu), przy zachowaniu surowych wartości i bez zgadywania znaczenia kodów. Osobno test dwóch kont, gdy właściciel wróci do odłożonego kroku. Odświeżanie aukcji dopiero po potwierdzonym odnowieniu Apibara i kontrolnym odczycie planu/zużycia; nie wykonywać dawnego `resume` automatycznie.

## Ograniczenia

Zapisany katalog nie jest odczytem aukcji na żywo. Aktualizacja całego pozostałego katalogu wymaga odnowionej Apibara; w tym etapie nie zakupiono usługi. Nie zmieniano stawek kalkulatora, MFA, uprawnień, DNS ani zakresu publicznych plików. Nie przedstawiono sum częściowych jako pełnej ceny importu. Rzeczywisty test dwóch kont klient–właściciel pozostaje odłożony przez właściciela; nie zastępujemy go wynikiem testów syntetycznych.

Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_RELIABILITY_20261025`, w szczególności `audit-final.json`, `preservation.json`, `event-correction-source-proof.json`, `transfer-complete.json`, oba journale indeksów, cztery pomiary `d1-benchmark-*`, `tests-release.log`, `public-check.json`, `final-state-usage.json` oraz zrzuty desktop/mobile. Checkpoint: commit dodający ten raport i zmiany, wskazany przez `git log -1 --format=%H -- docs/RELIABILITY_AND_SAVED_VEHICLES_2026-10-25.md`.
