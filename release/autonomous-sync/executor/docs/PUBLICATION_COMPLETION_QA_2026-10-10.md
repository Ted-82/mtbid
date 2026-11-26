# Ukończenie kandydata publikacji — 10.10.2026

Kontynuacja ec448d60431020d34dfe0e5fc6fc53dbf9686a8f, bez resetu. Cel wyłącznie rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d. Nowa zgoda dotyczy potrzebnych, wcześniej przedstawionych kosztów; produkcja, DNS i delegacja nadal wymagają osobnej akceptacji. W tym etapie koszt nowego abonamentu: 0, żadnego planu nie aktywowano.

## Dane i trwałe wznowienie

Kontrolny odczyt 15:28 UTC potwierdził stan206/276 oraz brak zmian stagingu/celu od poprzedniego audytu. Aktualne konto D1 raportowało0/0 dla10.10. Nowy backup resume-before ma identyczną sumę SQL jak wcześniejszy paused. Ukończono pozostałe70partii z tego samego planu, bez zerowania budżetu i bez niepewnych zapisów.

| Stan publikacyjnej D1 | Poprzednio | Teraz |
| --- | ---: | ---: |
| Oferty Copart / IAAI | 945 / 872 | 945 / 872 |
| Wszystkie oferty | 1817 | 1817 |
| Obserwacje | 3253 | 3253 |
| Wydarzenia | 13127 | 19044 |
| Stany pobrania historii | 618 | 1638 |
| Pozostałe partie | 70 | 0 |

Readback15:33UTC: Copart16350wydarzeń/840stanów, IAAI2694/798. Wszystkie ceny/media/daty oraz zapisane wydarzenia identyczne z zachowanym źródłem stagingowym. FK0, duplikaty0; konta, realizacje, wiadomości, odczyty wiadomości i pliki w publikacyjnej D1 mają0wierszy. Chronione stagingowe dane zgodne: users/favorites/orders/messages/files2/2/2/4/3. Sekrety, R2 i MFA nietknięte.

Transfer10.10: **27748zapisanych wierszy /14964odczytanych według metadanych własnych operacji**. Cały dwudniowy transfer104277zapisów/1480900odczytów. Nie porównywać dwudniowej sumy z dziennym limitem. Odczyt Analytics15:32:126488reads/7600writes konta był opóźniony; nie stanowi końcowego kosztu kampanii. Własne rezerwacje/metadane zapewniły kontynuację, brak nierozliczonych rezerwacji.

Pokrycie historii **nie wynosi1817kompletnych źródłowo**:1638 stanów obejmuje wcześniejszy cały zbiór, w tym167nierozstrzygniętych źródłowo;179nowych ofert nadal bez nowego odczytu historii. Zachowano błędy/niepobrane/puste rozróżnione. Baza zawiera wszystkie zapisane dane, nie cały rynek ani bieżący odczyt aukcji. Dat obserwacji nie odświeżono sztucznie.

**Apibara0 nowych requestów**, operator1774, ostatnie wcześniejsze usage5833/30000, historycznySTOP56 zachowane. Nie było odczytu usage ani nowej kampanii.

## Wydajność i testy

Usunięto powtórne skanowanie informacji o pokryciu podczas jednego publicznego żądania. Cache jest opt-in tylko dla requestowego repozytorium; następne żądanie widzi nowy stan. Domyślne repozytoria długowieczne zachowują poprzednie zachowanie. Brak zmiany cen, kontraktu API lub zasad świeżości.

Pomiar na **tej samej ukończonej prywatnej D1**: Polestarlist5147→3493wiersze, filtry5125→3471, Hondadetail5124→3473, Teslahistory5144→3490. Około32% mniej odczytanych wierszy przy tych nietrafieniach cache. Odpowiedzi identyczne;0writes/0provider. To pomiar handlera z realną D1, nie benchmark ruchu publicznego/SLA. 7tras handler+cache200, powtórzenie każdej0nowychquery;20query/22665reads/0writes.

**902/902repo i14/14partnerPASS**. Regresja wymaga jednego skanu coverage na list/detail/filters/history i nowego stanu w kolejnym żądaniu. Pierwsza wersja fixture celowo zmieniała SQLite i kolidowała z niezależną asercją braku zapisów; poprawiono fixture na zmienną odpowiedź odczytu, zachowując asercję. Walidatory profili i generatorV4/partnerPASS; składnia dwóch zmienionych plików runtime oraz diffPASS. Testy Windows wykonano poza sandboxem z powodu znanego atomowego rename, bez modyfikowania ACL/cache.

Staging wdrożony: **e74e4106-929d-4f5d-92ed-9e69eeaa1133**. Rzeczywisty browser IAAI: poprawnyrender,3wydarzenia warunkowe,25USD/2000USD jako zapisane ceny, galeria/lightbox działa;390px i1280px bez poziomego overflow. Copart57660876: potwierdzona cena końcowa9100USD, historia działa, V4 po potwierdzeniuSedan pokazuje1055USD dla4aut i brakujące koszty. Dowody w katalogu pakietu: honda-mobile-20261010.png i honda-desktop-20261010.png. Nie powtarzano mailowego E2E/MFA/panelu — poprzednie ręczne dowody zachowane, kont nie zmieniano.

## Backup i pakiet

Nowe prywatne kopie pozaGit: publication-ready-resume-before-20261010 oraz publication-ready-complete-20261010. Końcowy SQL30194905B, SHA256098e4d0b00d8bd9d8182cd7825c42e897a155b8f2d3c0afebc53f7008972bee1. DPAPIroundtripPASS oraz rzeczywiste odtworzenie wSQLite **w pamięci**: integrityok/FK0/counts1817/3253/19044/1638, wszystkie prywatne tabele0. Test na obecnym Windows, nie drugim komputerze. Jawnego SQL nie zachowano. Backup ma prywatnyACL; DPAPI nadal nie jest odtwarzaniem na drugim urządzeniu.

Plan/postęp/ledger zachowane w dotychczasowych katalogach; transfer-progress276/276,inflightnull,stopnull. Nie uruchamiać apply ponownie bez nowej potrzeby. Aktualny kod/bundle i manifest muszą odpowiadać temu stagingowemu checkpointowi przed publikacją.

## Kolejne duże etapy

1. Zamknięcie kanału korespondencji oraz akceptacja gotowych dokumentów/retencji; pierwsza publikacja storedkatalogu na osobnym Workerze/D1. Wymagany końcowy odczytDS tuż przed zatwierdzoną delegacją. [Karta publikacji](FINAL_PUBLICATION_APPROVAL.md).
2. Aktualizacja pełnej wyceny po otrzymaniu danych wspólnika12–14października. [Budżet usług](OPERATING_BUDGET_2026-10-10.md).
3. Produkcyjne konta/ownerMFA/recovery i portal, następnie prywatne pliki z kontrolą miejsca. Nie przenosić stagingowych danych. Wymagane własne testy na właściwej domenie, bez skracania istniejących bramek.

Rollback obecnego stagingowego kodu: poprzednia6c7d016d-a822-4a4f-9868-b46d111f20be; baza nie wymaga rollbacku, zmiana jest tylko odczytowa. Dane publikacyjne przywracać do nowej osobnej D1, po readbacku zmieniać binding zgodnie zrunbookiem; nie nadpisywać nowej bazy starym dumpem. DNS/TLS/DS: [runbook](PRODUCTION_CUTOVER_RUNBOOK.md). Zgoda na koszty nie jest zgodą na przełączenie domeny.
## Zamknięcie pakietu

Kontrola Cloudflare15:43UTC potwierdziła staging e74e4106 na100% oraz **0 domen** przypiętych do preflightu. Odczyt metadanych subskrypcji zwrócił403: nie potwierdzono technicznie planu rozliczeń i niczego nie zakupiono. Kwoty w budżecie są propozycją wykonania, nie dowodem aktywnego planu.

Nowy lokalny pakiet `REXBID_PUBLICATION_READY_20261009/candidate-20261010`:52pliki/2507669B przed manifestem;SHA256 każdego pliku, aktualny Worker i profil,publiczneassets. StatusDATA_COMPLETE_CODE_PREPARED_NOT_PUBLISHED. Poprzedni pakiet zachowano. Publication dry-run PASS, bez uploadu/tras. Scenariusz prezentacji zaktualizowany do faktycznych cen/statusów/lokalizacji; dawnych wartości nie przedstawiać jako aktualnych.

Copart ponownie potwierdzony na390px bez overflow; załadunek3auta daje1130USD. KatalogPolestar na390px zachowuje filtr i link właściwegoVIN/LOT, bez overflow. Override viewport usunięto. Dowody screenshotów dotyczą Hondy; brak nowego mailowego testu i logowania do portalu.
