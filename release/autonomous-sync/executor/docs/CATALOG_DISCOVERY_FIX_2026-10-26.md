# Brakujące Audi 2025+ — naprawa zasilania katalogu, 26.10.2026

## Wynik

Produkcja **16f53cbb-525f-46a4-8693-756bf1347f3e**, staging **4d9333c1-f7bc-401a-bfc4-48958750d17a**. Worker produkcyjny `rexbid-production-preflight`, profil `portal-no-files`. Checkpoint: commit dodający ten raport (`git log -1 --format=%H -- docs/CATALOG_DISCOVERY_FIX_2026-10-26.md`). Bez pusha.

[Sprawdź Audi od 2025](https://rexbid.pl/?catalog=1&make=AUDI&year_from=2025&sort=year_desc&view=list#results).

| Zakres | Przed | Po |
| --- | ---: | ---: |
| Audi >=2025, Copart | 0 | 38 |
| Audi >=2025, IAAI | 0 | 32 |
| Cały katalog produkcyjny | 4575 | 4673 |
| Snapshoty produkcyjne (od backupu) | 8480 | 8593 |
| Wydarzenia aukcyjne | 20990 | 20990 |
| Staging: oferty / snapshoty / wydarzenia | 4535 / 8302 / 20990 | bez zmian |

Stan końcowy 10:32 UTC. Katalog rośnie w tle. Wyszukiwanie Audi obejmuje 70/70 unikalnych wyników czterech stron źródłowych: dokładny total 38+32 i końcowe kursory null. Zapytania źródłowe zawierały platformę, make=AUDI, year_from=2025, lot_sub_status=Open, include_total=true; brak nieznanych filtrów. Dane pobrano 10:03 i 10:12 UTC, zapisano bez zmiany tych dat. Nie oznacza to kompletności rynku ani pobrania historii tych nowych ofert.

## Przyczyna i naprawa

Filtr działał poprawnie: w D1 Audi kończyło się na roczniku 2024. Proces admitował tylko 40 nowych ofert dziennie i osiągnął ten próg. Pozostałe wywołania odświeżały już znane pojazdy. Dodatkowo pierwsze zasilenie było ograniczone do ofert zaktualizowanych w ostatnich 24 godzinach.

- Limit nowych wpisów zwiększony do **2000/dzień**. Limit requestów pozostał **500/dzień, 12000/miesiąc, do 8/partię**, quota reserve 500. Wykonana jawna zmiana istniejącego dziennego progu 40→2000 z kontrolą odczytu; żaden consumed nie został wyzerowany.
- Początkowe pobieranie przechodzi strony całego Open osobno dla Copart/IAAI, niezależnie od marki. Trwałe `inventory:*` nie tracą kursora po upływie doby. Po końcu platformy działa osobne `list:*` dla zmian z ostatnich 24h. Nie miesza się kursorów różnych zapytań.
- Pozostały limit nowych wpisów ogranicza `per_page`; nie pobieramy strony, której końcowe pozycje musiałyby zostać odrzucone tylko przez osiągnięcie limitu.
- Zapis operatorowy i Cron korzystają ze wspólnej walidacji/atomowego zapisu VIN/platforma/LOT, zachowania starszych obserwacji i readbacku. Przechwycone 70 rekordów zapisano bez ponownego pobrania i bez fikcyjnego odświeżania ich dat.
- Pusty wynik wyjaśnia, że chodzi o zapisany, uzupełniany katalog. Nie deklaruje braku takich aut na rynku.

Dokumentacja kontraktu: https://apibara.tech/en/products/vehicle-auction-data-api/docs oraz OpenAPI v1.1.0 https://apibara.tech/openapi/v1.json (odczyt 26.10).

## Rzeczywiste przebiegi

Zwykła partia poprawionego procesu: 5 prób/5 odpowiedzi, 2 strony discovery, **28 nowych +14 aktualizacji, 1 odrzucony rekord**, zero retry i błędów szczegółów. Nowe wpisy obejmują m.in. Ford, Honda, Toyota, BMW, Hyundai, Mercedes-Benz, Nissan, Volvo oraz jedno Audi starszego rocznika. To osobne dane od pełnych 70 Audi >=2025.

Obie platformy mają zachowane następne kursory. Jeden rekord IAAI został odrzucony przez kontrolę rekordu; bieżący dziennik tej partii zachowuje tylko kod zbiorczy `AUTOMATIC_REFRESH_RECORD_REJECTED`, nie dokładny LOT/przyczynę składową. Nie uznano go za poprawnie pobrany. To pozostaje ograniczeniem diagnostyki tej partii. Nie dotyczy kompletu 70 Audi. Dalszy rozwój powinien dopisać bezpieczną identyfikację odrzuconego rekordu do raportu operatora.

Autonomiczny Cron **10:30:25–10:30:35 UTC**: 5/5 aktualizacji, zero błędów i blokad. Następne strony discovery są należne po 10:40, więc ten tick odświeżał znane auta. Cron co15min pozostaje włączony; publiczny HTTP nie uruchamia Apibara. Nie uruchomiono rzeczywistej licytacji.

## Testy i zabezpieczenia

- **1307/1307** końcowych testów repo PASS; regresje schedulera/profilu 66/66 i interfejsu22/22. Pierwszy pełny przebieg w sandboxie wykazał EPERM przy atomowym rename pliku testowego; pełny przebieg poza sandboxem PASS. Bez usuwania cache lub zmiany ochrony.
- Generator aktywnego profilu z istniejącymi dowodami, stawki V4 i `git diff --check` PASS.
- HTTP: po10 kontroli na stagingu i produkcji (7 sortowań z paginacją, niepoprawny sort/kursor, puste wyniki, zgodność zasobów).
- Produkcyjny test Audi:4 strony,70 unikalnych platforma/LOT, VIN i rocznik wszystkich zgodne z zapisanymi odpowiedziami. Szczegóły i ceny przykładowych aut obu platform zgodne. Licznik automatu przed/po publicznych odczytach **3452→3452**.
- Przeglądarka: ręczne wpisanie `audi` + rok2025;20→40→60→70; ostatni przycisk znika. Mobilny filtr IAAI20→32; brak przewijania w bok. Brak błędów konsoli w sprawdzonym widoku. Nie jest to test fizycznego wielodotyku iPhone.
- Obie D1: backup DPAPI/NTFS owner+SYSTEM, hash-roundtrip, odtworzenie SQLite w pamięci, integrity ok, FK0. Osiem chronionych tabel każdej bazy bez zmian. Wszystkie wcześniejsze wydarzenia i snapshoty porównane w całości z backupem: zero zmienionych/usuniętych. Duplikaty platforma/LOT0, FK0.
- Konta, role, MFA, portal, pliki, stawki kalkulatora, sekrety i DNS zachowane. Brak migracji i nowej usługi płatnej.

## Przykłady

- https://rexbid.pl/car?lot=66895976&platform=copart — Audi Q7 2026, zapis aktualnej oferty2500USD, Kup teraz21900USD.
- https://rexbid.pl/car?lot=45924622&platform=iaai — Audi A3 2026, zapis aktualnej oferty25USD.

To kwoty za pojazd, nie cena importu pod dom. Są obserwacjami w podanych momentach, nie obietnicą niezmienności.

## Zużycie i pozostały zakres

Dostawca przy początku/końcu tej diagnozy: **192→211/30000**, zostało **29789** (10:33UTC). Własne nowe próby w tej interwencji: **21** =15 automatu +4 strony Audi +2 usage; zero ponowień. Zużycie całego konta dostawcy jest odrębnym licznikiem. Od poprzedniego checkpointu7483 łączny licznik wynosi **7509** (+26; dodatkowe5 wykonał Cron przed rozpoczęciem tej diagnozy). Automat **3462**, historyczna kampania ręczna2262 bez wznowienia; STOP56 zachowany.

Katalog nadal jest częściowy. Przejście 70 wyników dla jednej marki/roczników nie dowodzi pokrycia innych filtrów. Pełny zbiór źródłowy jest stopniowo pobierany w obecnej puli. Nie obiecywać aktualizacji wszystkich aut co15min — to odstęp partii, nie SLA każdego pojazdu. Historia nowych ofert wymaga osobnego pobrania. Bez dodatkowego abonamentu.

## Dowody i wznowienie

Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_DISCOVERY_GAPS_20261026` (próby, cztery strony, importy, dokładne porównanie70, audyty, testy, screenshoty, deploye, stan i zużycie). Backupy: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/discovery-before-20261026`.

Nie pobierać ponownie czterech ukończonych stron Audi. Kontynuacja ogólnego katalogu przez zapisane `inventory:*`; nie zerować budżetów. Nie wznawiać starej kampanii ręcznej. Nowe materiały kalkulatora nadal oczekiwane. E2E dwóch kont odłożone przez właściciela.

Rollback kodu: produkcyjna wersja58e64963-056a-46c7-8620-95cc86d77d53 lub checkpoint94e97885. Zachować aktualne D1 i liczniki; starszy kod przywróci limit40 nowych, więc zatrzyma dalszą rozbudowę katalogu po obecnym zużyciu. Nie odtwarzać całej bazy nad nowszymi danymi klientów. Schemat bez zmian.
