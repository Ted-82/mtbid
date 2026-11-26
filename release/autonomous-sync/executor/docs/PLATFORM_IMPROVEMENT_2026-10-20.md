# REXBID — etap rozwoju 20.10.2026

## Aktualny checkpoint — 19:01 UTC

Po zgłoszeniu przez właściciela około 10% pozostałego pakietu zakończono dodatkowe analizy agentów i wdrożono gotowy pakiet UI. Kampania danych działa osobnym procesem i zapisuje trwały postęp; **nie jest jeszcze zakończona**.

- Produkcja: **1a42548b-efec-4e0f-912a-b76a8a114df9**, [rexbid.pl](https://rexbid.pl/).
- Staging: **c61c0bec-ef0a-44f0-b282-2abb0229aa6b**, [podgląd](https://rexbid-auth-test.tedn828.workers.dev/).
- **1164/1164 testów repo PASS**, diff-check PASS, publiczne HTTP **12/12 PASS**.
- Filtry napędu i pracy otrzymały czytelne polskie opisy. Wyłącznie udowodnione identyczne predykaty D1 są scalane; 17 → 10 opcji napędu. Kod źródłowy zachowuje się w URL, różne znaczenia i nieznane kody pozostają oddzielne. Nie jest to gwarancja sprawności pojazdu.
- Rzeczywisty staging i produkcja: poprawne opcje, mobilny filtr Timed + AWD daje 20 kart; viewport 390 px bez poziomego przepełnienia. Wcześniejsze kontrole galerii, modelu i powrotu katalogu opisano niżej.
- Kontrolny audyt **18:58:45 UTC**: obie bazy PASS, osiem prywatnych tabel na bazę zgodnych z baseline, FK/duplikaty/błędne powiązania/receipty 0. Produkcja wtedy: **4535 ofert, 7801 snapshotów, 19908 wydarzeń**. Staging: 1817/3253/19044. Transfer danych na staging jeszcze nie wykonany.
- Postęp **18:58:45 UTC**: 1325/4535 głównych pozycji, 1515 nowych prób, 6546 łącznie, jedno ponowienie. Konto dostawcy **10534/30000**, pozostało 19466. Liczniki kampanii i całego konta mają odrębne znaczenie; wartości nadal się zmieniają.
- Offline audyt zapisanych odpowiedzi z 18:46 UTC: Copart 408 i IAAI 601 zgodnych kwot w normalizacji, 0 rozbieżności. W próbce źródłowej brak jawnych zer; regresje sprawdzają zero osobno. To wynik pośredni, nie końcowy readback D1.
- HTTP po deployu: 12 odpowiedzi 200. Czasy są mieszane, więc **nie deklarujemy przyspieszenia**. Indeksy i porównanie rzeczywistych pomiarów D1 pozostają do wykonania.

Do zamknięcia: koniec głównej kolejki i kontrolowane recovery LOT, transfer publicznych danych z audytem korekt, końcowa kopia i exact preservation, pomiary/indeksy, końcowe QA oraz wznowienie Cron. Cron jest celowo w OPERATOR_STOP podczas wyłącznego zapisu. Test dwóch kont produkcyjnego panelu pozostaje odłożony na życzenie właściciela. Żadnych nowych zakupów, DNS, zmian uprawnień/MFA ani pusha.

### Korekty wydarzeń przy transferze — przygotowane, niewykonane

Wstępna próba wykryła 167 konfliktów treści wydarzeń między zachowanym stagingiem a nowszą odpowiedzią źródła; nie były to konflikty tożsamości. Transfer pozwala skorygować wyłącznie status źródłowy, status znormalizowany, kwotę źródłową i potwierdzoną kwotę transakcji przy identycznej tożsamości i nowszej obserwacji. Pełne before/source/after, hashe, kopia i CAS wszystkich 25 pól zapobiegają cichej utracie danych; inne zmiany zatrzymują transfer. Faktyczna liczba zostanie ustalona po końcowym capture.

Generator wycofania poza Git tworzy tylko odwrócony plan CAS after→before i kontrolne hashe. Nie wykonuje zapisu; rollback nie uruchomiony. Testy auth + helper transferu + rollback **28/28 PASS**, dodatkowo mechanizm repo objęty pełnym suite. Wykonanie transferu wymaga rzeczywistej próby odtworzenia na zweryfikowanej kopii.

## Zakres i stan pracy

Etap w toku. Punktem wyjścia jest checkpoint `37874d7135642cdb0b36089db2e159a6b97b101d`.
Właściciel zlecił większą aktualizację danych, testy oraz poprawki interfejsu z wykorzystaniem posiadanego pakietu Apibara. Nie zatwierdzono nowego abonamentu ani zakupu dodatkowej puli.

**Odłożony test:** właściciel nie wykonał logowania istniejącego konta testowego w oddzielnym oknie prywatnym. Produkcyjny test dwóch kont: realizacja → wiadomość → licznik odbiorcy → odczyt → odświeżenie → izolacja, pozostaje **NIEWYKONANY**. Nie zakładano kolejnych kont, nie zmieniano MFA. Wcześniejsze potwierdzenia recovery i konfiguracji właściciela pozostają zachowane.

## Stan wyjściowy potwierdzony odczytem

Odczyt 20.10, 16:09:53 UTC:

| Obszar | Produkcja | Staging |
|---|---:|---:|
| Oferty | 2097 | 1817 |
| Copart / IAAI | 1086 / 1011 | 945 / 872 |
| Obserwacje | 4551 | 3253 |
| Wydarzenia aukcyjne | 19044 | 19044 |
| Konta aplikacji | 2 | 2 |
| Realizacje / wiadomości / pliki | 0 / 0 / 0 | 2 / 4 / 3 |
| Naruszenia FK | 0 | 0 |

Produkcja: `rexbid-production-preflight`, D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`, faza `portal-no-files`. Działają konta, portal i kontrolowane automatyczne odświeżanie. Pliki oraz automatyczne e-maile pozostają wyłączone. Zwykłe otwieranie strony korzysta z D1/cache.

Staging: `rexbid-auth-test`, D1 `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Dotychczasowe konta, realizacje i pliki pozostają odseparowane.

## Kopie i bezpieczeństwo danych

Przed aktualizacją wykonano eksport obu D1, SHA-256, szyfrowanie DPAPI i kontrolę odtworzenia SQLite w RAM. Integralność, FK, publiczne liczby i hashe wszystkich ośmiu kontrolowanych tabel prywatnych: **PASS dla obu baz**.

Weryfikator wykrył błąd kodowania podczas przesyłania SQL PowerShell → Node. Poprawiono przesyłanie na surowe bajty. Ponowiono sprawdzenie tych samych zaszyfrowanych kopii; danych ani baseline nie zmieniano. To sprawdzenie na obecnym komputerze, nie odtworzenie na drugim urządzeniu.

Prywatne kopie: `Documents/Codex/private-backups/rexbid/improvement-before-20261020`. Publiczne dowody i licznik: `Documents/Codex/REXBID_IMPROVEMENT_20261020`. Żadnych sekretów lub kopii prywatnych tabel w Git.

## Aktualizacja źródła

- Oficjalny OpenAPI 1.1.0 odczytany 20.10; Basic pozwala na 20 pozycji na stronę.
- Pierwszy `/usage`: **9071/30000**, pozostało **20929**; brak dodatkowej puli. Deklaracja właściciela o końcu abonamentu jutro nie jest techniczną weryfikacją terminu odnowienia.
- Historyczny STOP 56 i wszystkie wcześniejsze liczniki pozostają zachowane.
- Automatyczny harmonogram zatrzymano operacyjnie na czas wyłącznego zapisu; jego licznik wynosił **3254**. Baza licznika nowej kampanii: **5031** = 1776 wcześniejszych prób operatora + 3254 automatu + 1 odczyt quota w tym etapie.
- Pierwsze strony Copart i IAAI: kontrola tożsamości, zapis i readback **PASS**.
- Nowa kampania oddziela odkrywanie ofert od odświeżenia szczegółów. Uwzględnia Open, Timed, Buy Now oraz Polestar, Rivian, Lucid i Fisker.
- Odpowiedzi są zachowane przed zapisem. Wznowienie wykorzystuje zapisany wynik. Kontrola VIN/platformy/LOT obejmuje także widoczne znaki maskowanego VIN-u.
- Limit operacyjny: maksymalnie 20000 prób kampanii i co najmniej 500 zapytań rezerwy; osiągnięcie limitu nie jest celem. 429/auth lub utrata zapisu zatrzymują kampanię. Błędy pojedynczych ofert pozostają odróżnione od pustej historii.

## Poprawki i dotychczasowe testy

- Czytelniejsza dwukolumnowa sekcja wyszukiwania i większe karty katalogu.
- Oddzielne VIN i LOT; bardziej uporządkowana cena i szczegóły.
- Sprawdzanie odwróconych zakresów roku/ceny/przebiegu przed wyczyszczeniem wyników.
- Zachowanie fokusu klawiatury po zmianie ulubionych.
- Komunikat nieudanego pobrania starszej historii nie jest natychmiast nadpisywany etykietą przycisku.
- Pełny zestaw lokalny po dodatkowych poprawkach: **1035/1035 PASS**, bez pominiętych testów. Generator zatwierdzonych stawek V4 i `git diff --check`: PASS.
- Wstępny odczyt 12 publicznych adresów produkcji/stagingu: HTTP i tożsamość **PASS**, D1/cache, bez wywołań Apibara.
- Pomiar HTTP jest małą próbką; nie stanowi wyniku Core Web Vitals lub Lighthouse.
- Stary test porównania z zamrożonym kalkulatorem z 06.10 nie przechodzi ścisłej zgodności tekstu ze współczesną implementacją. Kalkulator i jego stawki nie były zmieniane w tym etapie; aktualne regresje kalkulatora w pełnym suite przechodzą. Historycznego wzorca nie nadpisano.

## Wdrożenie interfejsu podczas kampanii

- Aktualny staging: `469d2183-c64a-4228-b77e-bcd06ca5eaa3`.
- Aktualna produkcja: `c7727c26-3f40-4887-96af-da461769ade9`.
- Wcześniejsze wydania tego etapu `f680bd3b-1832-4261-a4fb-a8325cf98380` / `dc7ff070-46e3-4c92-b22d-a611b4ab86ff` zostały zastąpione poprawkami ograniczenia czasu ładowania oraz normalizacji VIN.
- Lokalny checkpoint interfejsu i mechanizmu: `63a4e7a2f97c9ff361749563b3361af82508e032`, bez pusha.
- Profil produkcji nadal `portal-no-files`, generator konfiguracji z aktualnym plikiem evidence: PASS. Nie używano historycznych profili targetujących mtbid.
- Rzeczywisty staging: niepoprawny zakres 2025→2020 wyświetla komunikat, dokładny LOT 44593083 zwraca właściwą Hondę IAAI/VIN; galeria przechodzi 1→2/17; wydarzenia mają daty DD.MM.RRRR i opis oferty warunkowej.
- Telefon 390 px: karta i kontakt bez poziomego wyjścia poza ekran. Kontakt otrzymał właściwy LOT/VIN; powrót zachował wyszukanie 44593083. Formularza nie wysyłano.
- Zwykłe wejścia korzystają z zapisanych danych; licznik kampanii obejmuje wyłącznie jawny transport operatora.
- Każda kategoria Home ma 15 sekund na odczyt i osobny komunikat ponowienia. Błąd nie usuwa wcześniej pokazanych kart, nie uruchamia automatycznych ponowień.
- Rzeczywisty kalkulator na telefonie: wpisanie 10000 USD daje 11055 USD przy 4 autach i 11130 USD przy 3 autach. Brakujące opłaty pozostają „Do potwierdzenia”, wynik częściowy.

## Kontrolowane wznowienie po odpowiedzi 83

IAAI LOT 44317677 przekazał `NO VIN`. Niespójna normalizacja tekstu powodowała `KNOWN_OBSERVATION_IDENTITY_INVALID` przed zapisem tego rekordu. Strażnik tożsamości zatrzymał transport; nie wyłączono go.

Poprawiono wspólną normalizację używaną przez operatora i automat: jawny brak VIN zapisuje się jako null, zachowując wcześniej znany pełny VIN oraz poprawne identyfikatory maskowane i krótsze identyfikatory źródłowe. 1440 rekordów z 76 zapisanych stron przeszło odtworzenie offline; wszystkie klucze i daty zachowane. Dwukrotny zapis odpowiedzi 83 do SQLite daje te same 20 ofert i 20 obserwacji.

Audyt przerwy: produkcja 3414 ofert, 5879 obserwacji, 19044 wydarzenia; staging bez zmian. FK, duplikaty i błędne powiązania 0; osiem tabel prywatnych w każdej bazie zgodnych z baseline. To wynik pośredni.

Wznowienie zachowało 83 próby, raporty STOP i odpowiedzi. Przerwana strona została odtworzona z cache, bez ponowienia zapytania. Dowód: `campaign-recovery-83.json` oraz `observation-vin-offline-replay.json` poza Git.

## Dalsze kontrole i poprawki — 20.10, około 18:08 UTC

Aktualne UI: staging `94385c82-0bf6-4a11-a25a-437d17e73b0b`, produkcja `102daaf9-c980-4443-afa0-aa10d85bb4ec`. Wersje powyżej są historyczne.

- Pełny zintegrowany suite: **1117/1117 PASS**, bez pominięć. Zatwierdzone stawki V4: 610 lokalizacji i 24 stawki morskie, generator PASS. Profil `portal-no-files`, `git diff --check`: PASS.
- Rzeczywisty powrót katalog→karta→katalog: telefon przywraca 40 kart i pozycję 28250 px; komputer 21 kart Polestar i pozycję przy ostatniej karcie. To test istniejącego katalogu, bez wywołań providera z przeglądarki.
- Test przeglądarki ujawnił pozostawanie modeli poprzedniej marki. Dodano czyszczenie i odświeżanie na `input` z 250 ms opóźnieniem oraz zatwierdzanie na `change`. Honda↔Tesla na stagingu potwierdzone w przeglądarce; brak poziomego przepełnienia przy 390 px.
- Potwierdzone metadane całego zapisanego katalogu D1 są używane ponownie przez najwyżej 30 sekund w pamięci strony. Nie dotyczy odpowiedzi zależnych od marki od providera.
- Publiczny read-only test: Auth i portal włączone na obu środowiskach; produkcyjne uploads=false, staging uploads=true. Anonimowe orders/security zwracają 401 i `private, no-store`. Nie jest to odłożony test dwóch zalogowanych kont.
- `sessionStorage` przechowuje tylko filtry, liczbę stron i pozycję katalogu. Limit 30 minut sprawdzany przy odczycie; nie ma niezależnego timera kasującego dane. Dokumenty prywatności opisują rzeczywiste zachowanie.

### Odporność kampanii i rozróżnienie błędów

- Próba 124: odpowiedź D1 403, później ta sama konfiguracja Wrangler i świeży odczyt zadziałały. Przyczyna nie jest dowiedziona jako wygaśnięcie sesji. Dodano najwyżej jedno ponowienie tylko odczytu po odnowieniu tej samej sesji; zapisy nie otrzymały automatycznych ponowień.
- Próba 126: API analityczne GraphQL zgłosiło limit budżetu zapytań i oczekiwanie. Po oczekiwaniu kontrola przeszła. Uproszczono agregację zużycia do sumy konta bez niepotrzebnych grupowań. To nie był dowód wyczerpania dziennego limitu D1.
- Kontrolowane przeładowania 137 i 717 zachowały wszystkie odpowiedzi oraz liczniki; przy 717 brak otwartych rezerwacji zapisu. Pierwsze strony Copart/IAAI nadal mają oryginalne potwierdzenia PASS.
- Odkrywanie zakończyło się kolejką 4535 pozycji. Trwa pełny odczyt szczegółów i historii; tej liczby nie przedstawiać jako już odświeżonej.
- Próbki odrzuceń dowodzą: endpoint identyfikatora zwrócił ten sam VIN i inną aukcję. Nowa osobna operacja odczytu po kanonicznym LOT wykorzystuje udokumentowany kontrakt i nie nadpisuje pierwotnego odrzucenia. Nie promuje podsumowań `vin_lots` do pełnego detail i nie przestawia dat starszych cen.
- Historia z krótkim lub niepełnym identyfikatorem nie staje się fałszywie pusta/kompletna. Błędy i częściowe wyniki pozostają jawne.
- Readback historii przeniesiono do batcha zapisu, zachowując wszystkie kontrole. Odczyty mają najwyżej 100 parametrów; dla 246–249 wydarzeń zachowano ścieżkę osobnych odczytów. [Dowody lokalne](qa/TARGETED_HISTORY_IO_2026-10-20.md), [limit D1](https://developers.cloudflare.com/d1/platform/limits/).

### Przygotowana optymalizacja odczytów — jeszcze bez zdalnego zastosowania

Siedem dodatkowych indeksów i ograniczenie powtórnych metadanych: [wyniki i koszty](qa/CATALOG_READ_PERFORMANCE_2026-10-20.md). Testy porównują pełne, uporządkowane wyniki 23 kształtów zapytań przy 5000/10000 ofert. Lokalne pomiary CPU nie są pomiarami D1 ani Core Web Vitals; indeksy zwiększają koszt zapisu i rozmiar bazy, a nieudane wyszukanie fragmentu tekstu nadal może skanować zbiór.

Końcowe liczby, audyt danych, zastosowanie indeksów i dowody produkcji zostaną uzupełnione po zakończeniu operacji.

## Kolejne poprawki UI — 18:40 UTC

- Produkcja `4c0842fa-4e2a-4c95-9739-91fba781dfe4`, staging `c36d2af8-6082-46eb-bcab-41a3d903d0b5`.
- Czyszczenie filtrów nie blokuje już pola Model. Rzeczywista kontrola na stagingu: wyczyść → Tesla → Model 3, pole aktywne.
- Równoczesne identyczne odczyty bieżącej listy współdzielą żądanie; sekwencja A→B→A, zmiana kursora i spóźniony wynik nie przywracają poprzednich danych.
- Wykryta w przeglądarce utrata fokusu po Enter na miniaturze została naprawiona. Staging i produkcja: druga miniatura pozostaje aktywna, Tab przechodzi do trzeciej. Ekran 390 px bez poziomego przepełnienia.
- Pełny suite **1135/1135 PASS**, stawki V4 i generator profilu produkcji PASS. Pierwszy przebieg testów trafił na ograniczenie systemowe EPERM przy lokalnym pliku tymczasowym; ponowny przebieg poza sandboxem ujawnił jedną nieaktualną asercję wymagającą blokady pola Model. Asercję zaktualizowano do poprawionego zachowania, a cały zestaw wykonano ponownie.
- Kontrolowane przeładowanie operatora przy próbie 1062: brak niepewnych zapisów i odpowiedzi oczekujących na odtworzenie. Dowody `campaign-recovery-1062-expiry-readbatch.json` oraz archiwum STOP pozostają poza Git. Uruchomiono helper sprawdzający rzeczywiste `expiration_time` tej samej sesji Wrangler; nie wyświetla ani nie zapisuje tokenów.

## Kontrola przerwanego zapisu 780 — 18:17–18:19 UTC

Cloudflare zwrócił HTTP 403 przy batchu zapisu. Kontrola konkretnej oferty wykazała wcześniejszą datę i zero obserwacji, wydarzeń oraz receiptów z datą odrzuconej operacji. Zbiorczy audyt obu D1: PASS, prywatne tabele zgodne, FK/duplikaty/błędne powiązania/receipty 0. Produkcja miała wtedy 4535 ofert, 7389 snapshotów i 19469 wydarzeń; to **wynik pośredni**.

Rezerwację kosztu zamknięto konserwatywnie pełnym oszacowaniem 300 zapisów/50000 odczytów, nie jako rzeczywisty pomiar zużycia. STOP, odpowiedź 780 i dowody zachowano. Wznowienie korzystało z odpowiedzi w cache; kolejna próba 781 była odczytem quota, nie ponownym odczytem pojazdu.

Analiza kodu Wrangler 4.149.0 wykazała, że auth token --json odświeża OAuth po faktycznym wygaśnięciu. Dotychczasowy operator sprawdzał wiek połączenia, co mogło pozwolić użyć tokenu blisko końca ważności. Nie zachowano poprzedniej daty expiry, więc nie przypisujemy tego konkretnego 403 jednoznacznie wygaśnięciu. Przygotowano helper sprawdzający rzeczywistą datę ważności, z ograniczonym oczekiwaniem i normalnym odnowieniem tej samej sesji. 12/12 testów offline PASS; bez zmiany uprawnień, cache lub MFA.
