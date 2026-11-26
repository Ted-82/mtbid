# Bieżący katalog i sortowanie — 26.10.2026

## Wdrożenie

- Produkcja: https://rexbid.pl, Worker `rexbid-production-preflight`, Version ID **58e64963-056a-46c7-8620-95cc86d77d53**.
- Staging: https://rexbid-auth-test.tedn828.workers.dev, Version ID **f9a257da-f412-4786-acd9-1fbc3591d0af**.
- Checkpoint: commit dodający ten raport; `git log -1 --format=%H -- docs/LIVE_CATALOG_AND_ORDERING_2026-10-26.md`. Bez pusha.
- Profil `portal-no-files`, dotychczasowe konta/MFA/portal zachowane. Załączniki i automatyczne e-maile OFF. Bez zmian DNS, sekretów, ról, migracji ani starego Workera mtbid.

## Zakończone zmiany

1. Siedem sposobów sortowania całej zapisanej bazy przed paginacją: ostatni zapis, rocznik w obie strony, przebieg, aktualna zapisana oferta w obie strony i Kup teraz. Brak kwoty/rocznika/przebiegu pozostaje na końcu. Przebieg w km jest przeliczany dla porównania z milami. Potwierdzone zero jest prawidłową wartością; cena historyczna, sprzedaż i oferta warunkowa nie zastępują aktualnej oferty.
2. Widoki listy i kafelków, dostępne na desktopie i telefonie. Zmiana widoku nie pobiera kolejnej strony danych. Sortowanie i widok pozostają w adresie i podczas powrotu katalog → karta → kontakt → karta → katalog. Zmiana sortowania usuwa stary kursor. Paginacja wykorzystuje stabilny identyfikator przy równych wartościach, waliduje rodzaj kursora i parametry SQL. Odrzucony parametr nie uruchamia providera.
3. Naprawione nakładanie zdjęcia na treść w widoku listy. Wersje zasobów CSS/JS zmienione w odpowiednich dokumentach HTML.
4. Wznowione odświeżanie Apibara po potwierdzeniu opłacenia przez właściciela, rzeczywistym odczycie planu Basic i zabezpieczeniu obu baz. Przed wznowieniem quota wynosiła 0/30 000, per_page 20. Zachowano wszystkie wcześniejsze liczniki, historyczny STOP56 i zatrzymaną kampanię ręczną.
5. Harmonogram co 15 minut zachowuje limity 500 prób/dzień UTC, 12 000/miesiąc, maksymalnie 8/partię, 40 nowych ofert/dzień, rezerwę 500 u dostawcy. Dodatkowo rozkłada pozostałą pulę na pozostałe kwadranse dnia. Są to limity aplikacji, nie limit faktury usług.
6. Poprawiona kolejka otwartych ofert bez przypisanej daty. Nowsza obserwacja zastępuje nieaktualny termin starszego poprawnego zadania, ale nie omija opóźnienia po błędnej tożsamości, 404 ani starszej odpowiedzi źródła. Rzeczywista kontrola wykryła pięć takich zaległych zadań IAAI z 19.10; poprawka pozwoliła zapisać poprawne odpowiedzi dla wszystkich pięciu.

## Rzeczywiste działanie

Publiczny odczyt korzysta z D1/cache. Powtórzone odczyty kart obu platform nie zwiększyły licznika providera. Cena, VIN, platforma, LOT i termin zgadzały się z D1. Data obserwacji jest widoczna w katalogu i na karcie. Aukcja, której termin upłynął, nie staje się automatycznie potwierdzoną sprzedażą.

Kontrola 09:35 UTC: sekcja aktualnych zawierała **194 oferty: 123 Copart i 71 IAAI**, wszystkie ze źródłowym odczytem z tego dnia. To wynik dla obecnego katalogu, a nie deklaracja kompletności rynku. Sekcja może zmieniać się wraz z odczytami i upływem terminów. Cała baza obejmuje także archiwalne, zakończone i nierozstrzygnięte aukcje. Proces nie aktualizuje wszystkich ofert co 15 minut; aktualizuje wybraną partię według priorytetu i budżetu.

Przykłady sprawdzone w przeglądarce i API:

- [Audi Q7 Copart 46434796](https://rexbid.pl/car?lot=46434796&platform=copart): zapis 26.10 08:56 UTC, oferta 225 USD, Kup teraz 16 400 USD, aukcja 27.10 14:00 UTC; 35 wcześniej zapisanych wydarzeń historii pozostało odrębnych od aktualnej ceny.
- [Lucid Air IAAI 46131863](https://rexbid.pl/car?lot=46131863&platform=iaai): zapis 26.10 08:55 UTC, oferta 8400 USD, aukcja 26.10 13:30 UTC; poprawna tożsamość i galeria.
- [Katalog dla testerów](https://rexbid.pl/?catalog=1&category=current&view=list&sort=year_desc#results).

Przeglądanie ofert i wysyłanie zapytania nie oznaczają rzeczywistej licytacji przez REXBID. Ta funkcja nie jest uruchomiona. Nowych wydarzeń aukcyjnych ani potwierdzeń pełnej/pustej historii ten harmonogram nie generuje.

## Testy i bezpieczeństwo danych

- **1303/1303 testów repo PASS**. Celowana regresja schedulera: 32/32. Generatory nawigacji, stawek V4 i aktywnego profilu oraz `git diff --check` PASS.
- Staging: 10 kontroli sortowania API + 24 kontrole publiczne. Produkcja: 10 + 27, wszystkie PASS. Rzeczywisty D1 readback siedmiu sortowań, niezależny comparator i pełne przejście 75 ofert z dokumentem BILL OF SALE przez kursory na obu bazach PASS.
- Przeglądarka: sortowanie, 20→40 wyników, listy/kafelki, zachowanie powrotu przez kontakt, rzeczywiste karty Copart/IAAI, zdjęcia/lightbox, przyciski zoom 125%, widok 390×844 bez poziomego przepełnienia, zero błędów JS. Fizyczny wielodotyk na iPhonie nadal wymaga osobnego potwierdzenia; test viewportu nie jest tym potwierdzeniem.
- Przed zapisami wykonano zaszyfrowane kopie obu D1, manifest SHA-256, roundtrip DPAPI i odtworzenie do SQLite w pamięci. Integralność `ok`, FK 0. Kopia zależy od obecnego użytkownika Windows; nie deklarujemy testu odtworzenia na innym komputerze. D1 remote nie obsługuje PRAGMA integrity_check; integralność dotyczy odtworzonej kopii, a końcowe FK/duplikaty zbadano zdalnie.
- Wszystkie wcześniejsze **20 990 wydarzeń i 8302 snapshoty każdej bazy** porównano po pełnych wierszach z kopią: brak usunięć i zmian. Osiem chronionych tabel każdej bazy ma niezmienioną liczbę rekordów i SHA. Dane uwierzytelniania Supabase nie były modyfikowane; porównanie D1 nie jest audytem całego Supabase.
- Narzędzie audytu wymagało dwóch korekt technicznych: UTF-8 stdin przy odtwarzaniu polskich tekstów oraz kursora liczbowego dla snapshot_id. Poprawione porównania przeszły; nie zmieniano z tego powodu danych.

## Zatrzymanie operatorowe podczas pracy

Jedna partia została bezpiecznie zatrzymana przed pierwszą próbą Apibara: Cloudflare GraphQL zwrócił `Rate limiter budget depleted. Please try again after 5 minutes.` podczas operatorowej kontroli kosztów D1. Nie był to limit Apibara ani odrzucenie zapisu danych. Po wskazanym odstępie sprawdzono brak nierozliczonych rezerwacji/zapisów, FK i odciski chronionych tabel; wykonano jedno kontrolowane wznowienie. Produkcyjny Cron nie wywołuje tego operatorowego endpointu analityki. Nie usuwano cache ani nie rozszerzano uprawnień.

## Koszty, ograniczenia i następny krok

Użyto już opłaconego Apibara Basic i Workers Paid. Bez nowej płatnej usługi, pakietu lub dodatku. Limity aplikacji nie są twardym limitem całej faktury Cloudflare. Odczyt analityki konta w trakcie etapu: około 70,3 mln wierszy odczytanych i 587 tys. zapisanych w bieżącym miesiącu; dotyczy całego konta i chwili odczytu.

Kalkulator zachowuje potwierdzone V4: 610 lokalizacji, 24 stawki morskie, `rex-partner-v4-f0a67460b203286f`. Nowe materiały zapowiedziane przez właściciela nie zostały jeszcze dostarczone. Nie przedstawiamy niepełnej kalkulacji jako ceny pod dom. E2E klient–właściciel w oddzielnym oknie pozostaje odłożone zgodnie z decyzją właściciela.

Następny krok: włączyć nową wersję kalkulatora po otrzymaniu materiałów i zebrać zgłoszenia testerów. Automat ma działać dalej; nie zatrzymywać go po zakończeniu tego raportu. Dzienny budżet, terminy i quota są trwałe. Nie wznawiać starej ręcznej kampanii.

## Dowody i wycofanie

- Dowody: `C:/Users/nowic/Documents/Codex/REXBID_CATALOG_ORDER_20261026` i `REXBID_LIVE_RENEWAL_20261026`.
- Kopie: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/live-before-20261026`; sekrety i kopie nie są w Git. Dzienniki eksportu mogą zawierać czasowe podpisane linki i nie powinny być publikowane.
- Rollback kodu sprzed tego etapu: produkcja `ed11f566-ff4b-4786-8491-745fe1da2ceb`, staging `83b69ba5-e88e-4aa3-9f7f-477876a1ac1b`, przypięty Wrangler 4.149.0 i właściwe konfiguracje. Zachować aktualną D1. Starszy kod nie obsługuje nowego sortowania.
- Przy incydencie odświeżania najpierw wykonać STOP według [runbooka](AUTOMATIC_REFRESH_RUNBOOK.md), a następnie ustalić zakres naprawy. Cofnięcie kodu samo nie jest zatrzymaniem Cron. Nie nadpisywać całej aktualnej bazy starszą kopią dla cofnięcia interfejsu.

## Końcowy odczyt liczników

Stan 26.10.2026, **09:47 UTC**:

| Wielkość | Przed | Po |
| --- | ---: | ---: |
| Oferty produkcyjne | 4535 | 4575 |
| Snapshoty produkcyjne | 8302 | 8475 |
| Wydarzenia historyczne | 20990 | 20990 |
| Licznik automatu | 3254 | 3442 |
| Nasz łączny licznik prób | 7293 | 7483 |
| Zużycie wg dostawcy | 0/30000 | 187/30000 |

| Platforma | Katalog | Odczyt w tym etapie, unikalne oferty | Aktualne po odczycie | Zakończone po odczycie | Pozostałe bez odświeżenia w tym etapie |
| --- | ---: | ---: | ---: | ---: | ---: |
| Copart | 2126 | 150 | 127 | 23 | 1976 |
| IAAI | 2449 | 74 | 71 | 3 | 2375 |
| Razem | 4575 | 224 | 198 | 26 | 4351 |

40 nowych ofert (20 każdej platformy) jest zawarte w 224 odczytanych. **198/198 ofert zakwalifikowanych do sekcji aktualnych ma dzisiejszy odczyt**; nie oznacza to, że wszystkie 4575 wpisów są aktualnymi ofertami lub że katalog obejmuje cały rynek. Pozostałe 4351 zachowują wcześniejsze dane i daty. Ponowne odczytanie tej samej oferty nie zwiększa liczby unikalnych odświeżonych aut.

**190 nowych naszych prób**: 188 trwale policzonych w schedulerze (185 szczegółów, 2 strony list, 1 usage) oraz 2 samodzielne kontrolne usage. Wszystkie zakończyły się odpowiedzią; ponowień providera 0, błędów tożsamości/404 w tym wznowieniu 0. Zużycie konta dostawcy wyniosło **187**, pozostało **29 813**; nie utożsamiamy tego licznika z naszymi próbami (inne zasady naliczania/odczyty konta). Dawna ręczna kampania ma nadal 2262, historyczny STOP56 pozostaje bez zmian. Kwoty quota w stanie schedulera są ostatnim zapamiętanym odczytem z 08:47; niezależny końcowy odczyt dostawcy jest w `usage-after.json` i nie zeruje budżetów.

Autonomiczny Cron końcowej wersji: **09:45:22–09:45:29 UTC**, pięć prób, pięć poprawnych zapisów, zero błędów i ponowień. `blocked_reason`, `pause_until`, `lease_owner` są null. Potwierdzony harmonogram `*/15 * * * *`, aktywne wdrożenie i `/ready: scheduled`. Budżet dnia188/500, miesiąca3442/12000, nowe40/40. Kolejne wykonania mają zwiększać te liczniki; powyższe liczby są checkpointem, nie zamrożonym stanem.

Końcowy audyt obu D1: FK 0, duplikaty platforma/LOT 0, 8/8 chronionych tabel każdego środowiska bez zmian. Staging pozostaje4535/8302/20990. Ostatni readback czterech publicznych odczytów: automatic3442 przed i po, **zero nowych wywołań Apibara**.
