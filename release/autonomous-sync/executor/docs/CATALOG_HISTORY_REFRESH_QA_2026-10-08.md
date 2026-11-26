# Cały zapisany katalog — odświeżenie i historia, 8.10.2026

**STAGING VERIFIED — etap zakończony z 167 jawnie nierozstrzygniętymi pozycjami źródła.** Kontynuacja checkpointu 39bbdd26ddb6d6e98e42543aa9d84d836d6a5ec9. Rozpatrzono 1638/1638 istniejących pozycji; nie odkrywano nowego katalogu. Nie jest to potwierdzenie pełnego pokrycia Copart/IAAI.

## Wdrożenie i zakres

- [Staging](https://rexbid-auth-test.tedn828.workers.dev), Worker rexbid-auth-test, Version **5055ed90-8461-4914-85d8-7dbebbf9a428**, potwierdzone 100% ruchu. Poprzednia wersja sprzed etapu/rollback: 21522ccb-b342-408f-a649-65d4b7720dc4.
- D1 rexbid-auth-test-db / acb3cb8e-69a2-459f-8a46-0f2f5b9004be. Bez migracji. Auth/portal stagingu zachowane; Cron, automatyczny sync i fallback providera OFF.
- Produkcja mtbid, publikacyjna D1/preflight, DNS, delegacja, SMTP, MFA, uprawnienia i płatne plany bez zmian. Bez pusha.

## Wynik D1

| Miara | Copart | IAAI | Razem |
|---|---:|---:|---:|
| Listingi przed / po | 840 / 840 | 798 / 798 | 1638 / 1638 |
| Detail odświeżony z poprawną tożsamością | 718 | 753 | 1471 |
| Potwierdzony koniec odczytu dostępnej historii | 718 | 753 | 1471 |
| Z wydarzeniami | 715 | 687 | 1402 |
| Prawidłowo pusta historia | 3 | 66 | 69 |
| Błąd / nierozstrzygnięte | 122 | 45 | 167 |
| Partial / niepodjęte | 0 / 0 | 0 / 0 | 0 / 0 |
| Wydarzenia po | 16350 | 2694 | 19044 |
| Aktywne potwierdzone w udanym odczycie | 404 | 276 | 680 |
| Zakończone potwierdzone w źródle | 314 | 477 | 791 |
| Z URL-ami mediów przed / po | 624 / 820 | 739 / 794 | 1363 / 1614 |

Sources/listings 1638/1638 bez zmian. Snapshots **1682 → 3074**; wydarzenia **61 → 19044**; potwierdzenia historii **40 → 1471 complete + 167 failed**. Entities nadal 0. Zakończona aukcja nie oznacza potwierdzonej sprzedaży.

167 braków: Copart 80 identity mismatch + 42 NOT_FOUND; IAAI 26 mismatch + 19 NOT_FOUND. W 95 odpowiedziach inny LOT, w 11 inna platforma i LOT; nie stwierdzono innego VIN w tej grupie. Nie przypisano bieżącego detail innej aukcji do żądanego LOT-u. Zachowano stare ceny i czasy sukcesu, oznaczono błąd odświeżenia, wyłączono te pozycje z aktualnych kategorii. 404 nie jest dowodem zakończenia/sprzedaży ani pustej historii. Lista konkretnych pozycji i ograniczone odpowiedzi pozostają w prywatnym lokalnym ledgerze.

Kwoty w całej D1: Copart null333 / dodatnia507 / zero0; IAAI null221 / dodatnia577 / zero0. To wartości zapisane, obejmujące także starsze błędnie nieodświeżone rekordy i zakończone aukcje — nie liczba aktualnych ofert. Zero vs null potwierdzone regresjami; w tej rzeczywistej serii nie było potwierdzonego zero do pokazania. Buy Now w D1: Copart362, IAAI210; dostępność sekcji dodatkowo filtruje status, świeżość i czas.

## Kontrakt, kompletność i licznik

Zachowany oficjalny kontrakt Apibara 1.1.0: detail po rzeczywistym slug/VIN/LOT, include=history,vin_lots; retained history jako tablica. Cursor w metadanych ma pierwszeństwo. Osobny endpoint historii cursor/per_page=20, limit20 stron na cel. Wydarzenia są dzielone po rzeczywistym VIN/platforma/LOT; nie tworzymy encji ani wydarzeń ze snapshotów. Nieznany powiązany LOT lub niepełna identyfikacja daje partial, nie fałszywe complete/empty.

Rzeczywista kontrola zakresu: Copart41621666 **42 osadzone = 42 z 3 stron**; IAAI45249975 **17 osadzonych = 17 z 1 strony**, klucze wydarzeń zgodne, koniec kursora potwierdzony. Nie dowodzi to dostępności wszystkich dawnych aukcji świata. 39 wcześniejszych świeżych receipts wykorzystano ponownie; dla Tesli43806658 późniejszy wynik w detail wymagał jednego dodatkowego odczytu historii.

- Wcześniejszy licznik101; ten etap **1653 próby → 1754 łącznie**. Historyczny STOP56 i jego pliki/checksumy niezmienione, nowa kampania osobna i zakończona.
- Operacje: detail1639, osobna historia4, usage10. Copart843, IAAI800, usagebezplatformy10. Retry0. Odpowiedzi HTTP2001592 / HTTP40461; niedokończone próby0. Kontrolowane retry w kodzie ma maksimum2 prób, nie dotyczy złej tożsamości.
- Basic: usage20:08:47UTC **4234/30000** → usage21:28:16UTC **5816/30000**, pozostało24184, extra-limit0. Przyrost1582 jest zmianą całego konta, odrębną od1653 naszych prób; nie zakładamy identycznej semantyki rozliczania usage/404. Bez zakupów i dopłat.
- Trwały fsync ledger rezerwuje próbę przed siecią. Wznowienie wykorzystuje odpowiedź i jej rzeczywisty observedAt. Początkowy limit bezpieczeństwa25266 = pozostała pula25766−rezerwa500; nie był celem wykorzystania.

## Wykryte i naprawione błędy

1. Nieudany refresh nie może wyglądać świeżo: source failure ma pierwszeństwo przed wiekiem rekordu; błędne pozycje odpadają z aktualnych kategorii przed paginacją. Sukces usuwa błąd.
2. Jawne partial/read_failed historii, także gdy istnieją wcześniejsze wydarzenia; błąd nie kasuje danych ani nie daje empty.
3. Sam upływ końca Timed nie potwierdza zakończenia aukcji.
4. **Realny QA znalazł utratę Sold on Approval w detail→canonical→D1→DTO.** Kwota2975USD mogła trafić do ulubionych jako cena sprzedaży. Outcome teraz zachowany; oferta warunkowa/Not Sold mają final_price=null, kwotę źródłową oddzielnie. Zapis734 terminalnych opisów odtworzono z już pobranych odpowiedzi, bez requestów i bez zmiany dat odczytu. Lista/karta/ulubione mówią „Oferta warunkowa · wynik niepotwierdzony”.
5. Readback importerów grupowany po maks.200 kluczy, zachowane sprawdzenie tożsamości i fingerprintów.

## Przykłady i rzeczywisty QA

- [Honda IAAI44593083](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=44593083&platform=iaai): bieżąca25USD, Kup teraz2000USD, następny termin09.10.2026 15:30CEST, obserwacja22:16CEST. Trzy historyczne oferty warunkowe. Zielony ubezpieczyciel. Galeria17 pozycji, lightbox/next działa; ostatnia niedostępna miniatura ma stan zastępczy.
- [Tesla Copart57660876](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=57660876&platform=copart): źródłowo Sold, potwierdzona cena9100USD; nie udaje aktualnej oferty. Galeria12 zdjęć. Transport BEV standard4: land330 + sea575 + BEV150 = **1055USD**; ostrożny3:330+650+150=**1130USD**. Preferowany Elizabeth, bez zmiany stawek.
- [Tesla IAAI43806658](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=43806658&platform=iaai): pięć ofert warunkowych20.08/27.08/24.09/01.10/08.10, najnowsza2975USD; nie jest potwierdzoną sprzedażą. Aktualny source podaje Gardena(CA), bez wystarczającego dopasowania stawki — kalkulator uczciwie wymaga lokalizacji, nie zgaduje starego Los Angeles. Czas detail22:16CEST, historia23:26CEST rozdzielone.
- Desktop1365×950 i mobile390×844: Home4sekcje po4pojazdy, lazy loading zakończony; kategorie, mobilne menu, filtry, dokładny VIN/LOT, paginacja20→40 bez duplikatów, karta→kontakt→karta→katalog PASS. Kontakt przygotowano lokalnie na testowej treści, nic nie wysłano.
- Galeria/lightbox, historia i V4 PASS. Kolejność ceny→szczegóły/akcje→kalkulator, zielony typ ubezpieczyciela i granat/czerwień zachowane. Brak poziomego scrolla oraz przechwyconych błędów JS na sprawdzonych kartach.
- Guest favorites: dodanie/odczyt/usunięcie wyłącznie wpisu QA PASS; wcześniejsze2 zachowane. Stare ulubione pokazują datę i ostatnią zapisaną obserwację, nie udają odświeżonych. Końcowy test warunkowej Tesli nie pokazał jej jako sprzedanej.
- HTTP16/16 PASS: cars, filters, VIN/LOT,3details,3histories,repeat/cache i4kategorie. Wszystko read_source=d1, fallback_reason=null; licznik1653 przed/po, public reservations291 niezmienione. Pierwszy catalog1228ms; filters193ms; detail89–135ms; history135–184ms; ponowne detail136ms/cacheHIT, history68ms/cacheHIT. To kilka odczytów, nie benchmark.
- Dowody lokalne poza Git: C:/Users/nowic/Documents/Codex/REXBID_CATALOG_COMPLETE_20261008/screenshots/{home-desktop.png,home-mobile.png,copart-desktop.png,copart-calculator-mobile.png,tesla-history-desktop.png,tesla-history-mobile.png}.

## Bezpieczeństwo i backup

Audyt 2026-10-08T21:38:21.382Z: wszystkie18 chronionych tabel hash/count identyczne; users/favorites/orders/messages/files **2/2/2/4/3**. Wszystkie wcześniejsze61events i1682snapshots identyczne kolumna po kolumnie. Pozostałe scopes, tożsamości listingów, entity0 zachowane. Duplikaty listings/events/snapshots0; FK0; błędne powiązania wydarzeń0; warunkowe/niesprzedane wydarzenia z fałszywą final_price0. Stan błędnych listingów zachował wcześniejsze ceny i clock. Nie testowano ponownie pełnego E2E panelu/MFA; nie zmieniano tych mechanizmów.

Backup przed zapisami20:07:24UTC: pełny eksport8331728B, DPAPI CurrentUser+ACL właściciel/SYSTEM pozaGit: C:/Users/nowic/Documents/Codex/private-backups/rexbid/catalog-complete-before-20261008. PlaintextSHA25678a613b08e99aa6874fa0e95be6c449751b2498d1ce054fdfdaf857eba55190a; ciphertext57e5c752c6f23e0df1fe39acf0c83925e293a83142e65c17b3edb84e67e827e2. Roundtrip i restore SQLite w pamięci PASS/integrityok/FK0. Drugi komputer nieweryfikowany. Zdalne PRAGMA integrity_check odrzuconeHTTP400 — nie przedstawiamy go jako PASS; zdalneFK i kontrole tabel wykonano.

Nie archiwizowano binarnych mediów. D1 zawiera URL-e/metadata; ograniczone odpowiedzi publiczne i ledger pozaGit w C:/Users/nowic/Documents/Codex/REXBID_CATALOG_COMPLETE_20261008. Nie wgrywano prywatnych danych do publikacyjnej bazy.

## Wrangler, testy i odtworzenie

Wrangler4.149.0, wspólny WindowsXDG AppData/Roaming/xdg.config/.wrangler/config/default.toml. EPERM sandboxa odróżniony od auth; polecenia wykonano w normalnym kontekście istniejącego konta, bez zmiany ACL, uprawnień lub cache. O20:34:55UTC token przechowywany w procesie wygasł dokładnie przy D1HTTP403; transport zatrzymano. Istniejąca sesja odświeżyła token, readbackPASS, wznowiono z zapisanej odpowiedzi bez ponownego requestu. Nie deklarujemy naprawy sesji na zawsze.

**876/876 repo +14/14 partner PASS**. Generatory610land/24sea i legacy610/4, rateversionrex-partner-v4-f0a67460b203286f bez zmian. Trzy config validatorsPASS; składnia158JS+5inlinePASS; gitdiffcheck/dry-runPASS. Nowe regresje obejmują ledger/retry/crash/replay/identity,zerovsnull,conditionaldetail/event,partial/failure,retencję poprzedniej obserwacji i timedclock.

Stan kampanii complete; nie uruchamiać ponownie transportu. Operator lokalny rexbid-catalog-operator.cjs + moduł repo scripts/catalog-refresh-campaign.cjs, manifest/ledger oraz ograniczone odpowiedzi pozwalają wznowić tylko świadomie. Replays korekty outcome nie dodają prób. Historyczny STOP56 pozostaje archiwalny.

Rollback aplikacji: wyłącznie stagingowy Wrangler rollback21522ccb-b342-408f-a649-65d4b7720dc4 po ocenie regresji; schema bez zmian. Nie cofać destrukcyjnie D1. Przy potrzebie odtworzenia danych najpierw nowy backup, restore zaszyfrowanej kopii do odseparowanej lokalnej/testowej bazy, porównanie chronionych tabel; nie nadpisywać nowych wiadomości/plików/kont. W tym etapie nie wykonywano rollbacku.

## Pozostałe ograniczenia

167 konkretnych źródłowych braków wymaga wyjaśnienia identyfikatorów lub dostępności u providera; nie oznaczono ich pustymi. MediaURLs1614 nie gwarantują dostępności każdego zewnętrznego zdjęcia. Katalog i historia opisują zakres zapisanych odczytów, nie cały rynek ani przyszły stan aukcji. Potwierdzone zero przetestowano syntetycznie, nie znaleziono go w tej serii. Koszty port/broker/podatki/Polska i niejednoznaczne lokalizacje pozostają brakami, a nie zerem. Publikacja i etap prawny nadal odłożone. Brak niezbędnego działania właściciela do zachowania wdrożonego stagingu.
