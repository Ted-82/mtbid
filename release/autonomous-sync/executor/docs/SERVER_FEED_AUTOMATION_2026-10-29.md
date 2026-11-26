# Automatyczna synchronizacja Apibara — 29 października 2026

Stan o 15:07 UTC: automat produkcyjny działa, trzy pełne paczki 5331/5342/5354 zostały ukończone (kursor 45709453), kolejna jest zapisywana. **Właściciel wybrał zachowanie obecnego limitu i optymalizację zamiast podnoszenia kosztów. Obsługa wszystkich 48 paczek dziennie w tym budżecie nie jest jeszcze potwierdzona.**

## Wdrożenie

- Publiczna strona pozostaje na `rexbid-production-preflight`, wersja `a31b016e-3bcb-4ebf-9c1d-aef131f276ef`. Konta, MFA, panel, kalkulator i DNS nie były zmieniane.
- Prywatny harmonogram i kolejka: `rexbid-feed-sync-production`, wersja `abc3af4e-7b65-437d-864a-2a0a40ac8b2a`, sprawdzanie co 5 minut.
- Prywatne wykonywanie pracy: `rexbid-feed-executor-production`, wersja `9452bdfe-18df-4ab5-9cce-80df4f45c38c`, wywoływane przez Service Binding. Brak publicznych adresów, workers.dev i preview.
- D1: `rexbid-production-preflight-db`, `c8a30088-70af-43a6-9a7f-c4018279d37d`. Prywatne R2 i Queue mają nazwę `rexbid-feed-sync-production`. Nie używają magazynu dokumentów klientów.
- Apibara Pro, źródło 20, Copart i IAAI bez filtrów. Stały prywatny adres pobierania działa bez sesji przeglądarki. Otrzymywane paczki przyrostowe powstają u dostawcy co około 30 minut; to nie jest transmisja licytacji w czasie rzeczywistym.
- Sekrety zapisano w Cloudflare z istniejących dostępów. Nie są umieszczone w repozytorium ani raporcie.

## Sprawdzone zabezpieczenia

- Przed migracją wykonano szyfrowane kopie obu baz z próbnym odtworzeniem, integralnością, kontrolą FK i duplikatów. Manifest: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/server-feed-before-20261029/manifest.json`. Format `REXBID-DPAPI-CHUNKS-V1`; używać dołączonego narzędzia odtwarzania.
- Produkcyjny punkt Time Travel z 14:19:19 UTC zapisano w `production-bootstrap-before-bookmark.json` w folderze dowodów. Migracje 0011 i 0012 były wyłącznie addytywne. Nie zmieniały istniejących ofert ani klientów.
- Kursor 45570246 pochodzi z dwóch wcześniej ukończonych, zweryfikowanych importów. Nie przesunięto globalnego kursora API.
- Paczki są sprawdzane po SHA-256, poprawności gzip, identyfikatorach pojazdów i kolejności zdarzeń. Niepełne dane nie usuwają poprawnej karty. Konflikty VIN trafiają do kwarantanny.
- Każda część ma trwałe potwierdzenie zapisu. Kursor całej paczki przesuwa się dopiero po ukończeniu wszystkich 128 części. Ponowne dostarczenie nie powiela zapisów katalogu.
- Wspólna blokada zapobiega równoczesnym zapisom ze starszym automatem. Długie przygotowanie odnawia ją co 30 sekund. Nieznany wynik zapisu zachowuje rezerwację kosztu.
- Luki są naprawiane przez ograniczone API; nie wolno przeskoczyć brakujących zdarzeń. Wspólny limit API: 500 dziennie, 12000 miesięcznie; dodatkowa rezerwa 10000 zapytań dostawcy. Dodatkowe uzupełnianie szczegółów aktywnych ofert pozostaje wyłączone na czas pomiaru.

## Testy i pomiary

- Pełna seria lokalna: 1861 testów PASS. Po ostatniej poprawce obsługi zajętej blokady: dodatkowo 3 testy dyspozytora PASS. Bootstrap produkcji: 5 testów PASS.
- Staging: całe paczki 5331 i 5342 ukończone, kursor co najmniej 45663889. Powtórzenie zadania przez prawdziwą Queue nie zmieniło potwierdzeń. Osiem tabel klientów i panelu zachowało liczbę oraz skróty danych; FK i duplikaty bez błędów.
- Sprawdzone automatyczne wywołanie Cron na staging o 14:15 UTC. Nowa paczka 5409 została pobrana bez zalogowanej przeglądarki.
- Oddzielny wykonawca skrócił przygotowanie paczki z około 337 sekund do około 106–114 sekund w pierwszych próbach produkcyjnych. Pojedyncze części na staging skróciły się z około 12 sekund do około 1,5–2 sekund. Są to pomiary synchronizacji, nie szybkości strony.
- Produkcja: osiem zachowanych paczek 5331–5409 zarejestrowanych bez uruchamiania starych importerów. Automat pobrał sam kolejną paczkę 5420. Trwa przygotowanie i zastosowanie zaległych danych.
- Staging zatrzymano po kontroli: dostarczanie Queue wstrzymane, Cron usunięty; zasoby i dowody zachowane. Nie wznawiać równoległego importu testowego bez potrzeby.

## Koszty i porządkowanie

Nie zakupiono nowego abonamentu. Usługi korzystają z istniejącego Workers Paid. To nie jest obietnica rachunku ograniczonego do 5 USD.

- Wewnętrzny limit automatu: 1 mln zapisanych i 50 mln odczytanych wierszy D1 dziennie; rezerwacja jednego zadania 5000/50000. Te limity obejmują tylko nowy automat, nie całe konto. Limit może zatrzymać aktualizacje przed końcem dnia — wymaga oceny po pełnym pomiarze produkcyjnym.
- Cloudflare Paid obejmuje 50 mln zapisów D1 miesięcznie; nadwyżka 1 USD/mln. Jedna dzienna próbka nie jest średnią miesiąca. Wyższego budżetu z przewidywanym nowym kosztem nie zatwierdzono.
- Jednorazowy operator migracji miał potwierdzony zapas w miesięcznym pakiecie. Jego account-wide limit odczytów zwiększono z 450 do 500 mln po pomiarze 470,7 mln odczytów danego dnia; nie zmienia to limitu automatu ani abonamentu.
- Właściciel zatwierdził usuwanie przetworzonych plików roboczych po 48 godzinach i oryginalnych paczek po 7 dniach od ukończenia importu. Mechanizm jest włączony. Importy nieukończone i dane klientów są chronione. Samochody nie są usuwane przez tę retencję.
- Odbiór zatrzymuje się przed 5 GiB rozliczonego archiwum R2. Limit nie obejmuje nieustalonych osieroconych obiektów. Retencja starej metadokumentacji D1 oraz alarmy wymagają osobnego dalszego etapu.

Źródła cenników sprawdzone 29.10.2026: [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Queues](https://developers.cloudflare.com/queues/platform/pricing/).

## Dowody i punkt wznowienia

Folder dowodów: `C:/Users/nowic/Documents/Codex/REXBID_SERVER_SYNC_20261029/`.

- `staging-acceptance.json`: pełna próba, izolacja i powtórzenie.
- `production-bootstrap.json`: migracje, punkt odtworzenia i seed.
- `production-raw-uploads.json`, `production-raw-registered.json`: oryginalne pliki, SHA i rejestracja.
- `production-protected-baseline.json`: skróty ośmiu tabel przed pierwszym zapisem nowego automatu.
- `production-verification.cjs verify`: odczyt stanu, próby pierwszej paczki i izolacji.
- `production-cost-proof.cjs`: rzeczywiste zużycie pierwszej paczki z logów.
- `production-live-status.json` i logi `production-tail.jsonl`, `production-executor-tail.jsonl`: aktualizować przed wnioskami. Logi tail nie są trwałym monitorem.

Następnie: najpierw odczytać aktualny stan automatu i limity. Zmierzyć koszt pełnej paczki po optymalizacji, a potem ograniczać powtarzane zapisy między paczkami bez utraty zdarzeń. Nie podnosić limitów: właściciel odrzucił propozycję dodatkowych 30 USD miesięcznie. Nie uruchamiać ponownie ukończonych importerów ani bootstrapu. Nie deklarować pełnego, aktualnego rynku na podstawie samego Cron.

## Wycofanie

Wstrzymać dostarczanie kolejki produkcyjnej, wyłączyć nowy Cron i ustawienia `REXBID_FEED_ENABLED` w obu prywatnych usługach. Zachować tabele, potwierdzenia i archiwum. Publiczny Worker może dalej działać na zachowanych danych. Nie odtwarzać całej starej bazy nad nowszymi danymi klientów i aukcji. Odtworzenie danych wymaga osobnej oceny zakresu.

## Zakończona próba i optymalizacja bez zwiększenia limitu

- Produkcyjna paczka 5331: pełny zapis od 14:42 do 14:48 UTC, 128 części, 47 193 rzeczywiste zapisy D1, 344 267 odczytów, brak błędów. Osiem tabel klientów bez zmian. Kolejne 5342 i 5354 również ukończone.
- Bazowe przeliczenie pierwszej paczki na 48 dziennie daje około 67,96 mln zapisów miesięcznie i około 17,96 USD nadwyżki ponad 50 mln wliczonych. To próbka PRZED optymalizacją; pomija inne użycie konta, różnice między paczkami i dodatkowe usługi. Nie jest prognozą nowego kodu ani zatwierdzonym budżetem.
- Właściciel odpowiedział: „Zachowaj obecny limit; najpierw optymalizuj”. Nadal 1 mln zapisów i 50 mln odczytów dziennie dla automatu; bez nowego zakupu. Po wyczerpaniu limitu aktualizacje mogą się opóźniać. Nie deklarować ukończenia pełnej synchronizacji 24/7.
- Nowa optymalizacja dotyczy tylko przestrzeni server: nie przepisuje identycznego, już oczekującego zadania uzupełnienia karty. Zachowuje wcześniejszy termin i odstęp po błędzie. Zmiana tożsamości, ponowne otwarcie ukończonego zadania, wcześniejszy pilny termin i kwarantanna pozostają obsługiwane. Ceny i statusy są nadal zapisywane. Stary importer file pozostaje bez zmiany tej logiki.
- Nowe testy: w przypadku 100 oczekujących zadań 100 niepotrzebnych aktualizacji wierszy wyeliminowanych, wszystkie 100 zmian cen zachowane. 76 powiązanych testów PASS, w tym 7 nowych przypadków. Oszczędności indeksów D1 i średni koszt dobowy wymagają pomiaru; nie przenosić procentów z testu na całą produkcję.
- Produkcyjny wykonawca po optymalizacji: 9452bdfe-18df-4ab5-9cce-80df4f45c38c. Przed wdrożeniem wstrzymano dostarczanie Queue i potwierdzono zakończenie aktywnego zapisu; po wdrożeniu wznowiono. Dowód: optimization-runtime-proof.json — pierwsze 29 wznowionych zadań bez błędów. Testowy wykonawca c5baa0cc-631e-4026-b2f7-f745b9fe10d1; testowa kolejka nadal wstrzymana.
- Sprawdzenie w przeglądarce: produkcyjna karta Subaru Ascent LOT 46461953 z wejściowej paczki działa, pokazuje galerię, dane, czas źródła i kalkulator. Dowody production-browser-subaru.txt/png. Pobranie nowej paczki nie zmienia automatycznie daty wszystkich kart. Częściowe zmiany cen/statusu nie oznaczają pełnego odświeżenia szczegółów pojazdu.
- Kod automatu zachowano w commicie 2e98a22; osobny następny commit obejmuje optymalizację i ten raport. Żadnego push/zmiany publicznego Workera, kont ani DNS w tym etapie.
