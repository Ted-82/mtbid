# REX.BID — DUŻY SPRINT: KALKULATOR V4 + KOŃCOWY UX + WIARYGODNE DATY AUKCJI

## Cel i sposób pracy

Cała komunikacja, widoczny interfejs i raport po polsku. Zrealizuj jedno spójne wydanie: uporządkowany Home i karta auta, poprawna data aukcji, czytelne ceny, jeden kalkulator oparty na pełnych materiałach partnera oraz dopłacie EV. Zachowaj sprawdzony kod i funkcje. Nie buduj serwisu od zera.

To jest specyfikacja nadrzędna dla tego sprintu. Zastępuje wcześniejsze polecenia wybierania minimum `land + sea`, domyślnego Indianapolis=Chicago i sumowania nieudokumentowanych kosztów w celu zbliżenia wyniku do BidCars.

Nie kończ na samym planie, dokumentacji lub nowych testach jednostkowych. Zaimplementuj, napraw wykryte regresje, wdróż staging i wróć z gotowymi linkami i zdjęciami przed/po. Nie wymagaj serii ręcznych mikrotestów. Przeszkodę kontową zgłoś raz, z jednym konkretnym działaniem, a pozostałą pracę wykonaj niezależnie.

## 0. Stan, źródła, bezpieczeństwo

Repo kanoniczne: `C:\Users\nowic\Desktop\stona_auta-www`, GitHub `Ted-82/mtbid`.
Ostatni odczyt gałęzi main: `5c781c7a6db9a8ac3f70aedb638f4543dfce16e0` — Prepare production feature parity release. Ostatnia produkcja zgłoszona w raporcie właściciela: `351ac4e7-2175-4d51-813b-5f85d9527f64`. Baseline: 313/313 testów; ponownie sprawdź bieżący HEAD, diff i konfigurację, nie zakładaj czystego checkoutu.

Najpierw przeczytaj `PROJECT_HANDOFF.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `docs/CALCULATOR_MODEL.md`, `docs/TRANSPORT_RATE_MODEL.md`, `docs/DOOR_TO_DOOR_COST_MODEL.md`, obecne adaptery/kontrakty i źródła kalkulatora. W handoffie historyczne sekcje nie zastępują aktualnego stanu — oddziel je od jednego bieżącego podsumowania.

Pakiet wejściowy znajduje się w `data/partner/RexBid_Calculator_V4_2026-10-04/`. Przeczytaj jego:
- `ANALIZA_I_AKTUALIZACJA_PL.md`, `DLA_CODEXA_PRZECZYTAJ_NAJPIERW.md`;
- `data/metadata.json`, CSV stawek, terminali, mnożników i dopłat;
- `audit/rate_conflicts.csv`, dowody preferencji, oryginały w `sources/`;
- `sources/OWNER_EV_PACKING_2026-10-04.md`;
- `references/ux/` i `references/RESEARCH_AND_BENCHMARK.md`.

Nie twórz pustych danych zastępczych, jeśli nie odnajdziesz folderu. Sprawdź także załączony ZIP/inną podaną ścieżkę. Jedynie brak wszystkich kopii źródła uzasadnia prośbę o plik. Brak dwóch spornych stawek nie blokuje reszty sprintu.

Dozwolony deploy: wyłącznie staging `rexbid-auth-test` z D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Produkcyjny `mtbid` i `rexbid-db` (`971879fe-04ed-4e8c-9dc6-5306980bb872`) bez deployu, migracji lub konfiguracji. Produkcja nadal provider-backed; Auth/D1-first/Cron/discovery/media enrichment OFF, limity providera bez zmian. Nie resetuj ani nie cofaj zmian użytkownika. Nie commituj i nie pushuj. Zachowaj `.codex-wrangler-cache/`; nie dodawaj go ani sekretów/eksportów bazy do repo.

Nazwa Rex.Bid pozostaje. Nie kupuj domeny, nie wykonuj rebrandingu RexAuto i nie zmieniaj DNS. Produkcyjny charakter oznacza jakość kandydata, NIE automatyczną zgodę na publikację.

## 1. Cennik i routing — fakty z nowych materiałów

Zachowaj 610 lokalizacji i ich stabilne identyfikatory. Dokładne mapowanie kolumn obu tabel:

| Alias zgodności | Stabilny ID | Terminal |
|---|---|---|
| route_1 | savannah_ga | Savannah, GA |
| route_2 | elizabeth_nj | Elizabeth, NJ |
| route_3 | houston_tx | Houston, TX |
| route_4 | los_angeles_ca | Los Angeles, CA |
| route_5 | indianapolis_in | Indianapolis, IN |
| route_6 | montreal_qc | Montreal, QC |

Kolorowe obramowania oznaczają preferred routing. Domyślnie wybieraj `preferred_terminal_id` partnera dla dokładnie rozpoznanej lokalizacji. Nie wybieraj minimum cen i nie wyprowadzaj preferencji z samego stanu USA. Gdy rekomendacja jest nieobecna, nieczytelna, sprzeczna albo brak jej stawki: status wymagający potwierdzenia, nie cicha podmiana terminalu. Jawnie zatwierdzony override ma źródło, datę i powód.

Wariant 3 i 4 aut używa TEGO SAMEGO rekomendowanego terminalu. Alternatywę można pokazać w szczegółach jako porównanie niezatwierdzonej logistyki, nie jako gotową ofertę.

Nie nazywaj Indianapolis portem oceanicznym. Nie dopisuj portu docelowego do stawek morskich: zdjęcia go nie pokazują. Zachowaj oryginalne nazwy i aliasy, brakujące wartości jako null, ZIP jako tekst (zera początkowe), prowincje Kanady oddzielnie od stanów USA.

Matcher: platforma + jednoznaczna nazwa placu/alias, następnie platforma + ZIP oraz miasto/stan, z kontrolą konfliktów. ZIP i miasto wspólne dla kilku placów NIE uzasadniają arbitralnego wyboru. Różnice ZIP w nazwie i osobnej kolumnie pozostają widoczne w audycie. Nie wybieraj stawki innej platformy bez potwierdzonego aliasu albo jawnej decyzji użytkownika.

Wiersze Copart ALBANY 12205 i IAAI Albany 12303 mają konflikt Elizabeth 310/325 USD. Pozostaw konflikt i blokuj oznaczenie tej stawki jako potwierdzonej; nie nadpisuj źródeł. 01.10.2026 to data reguł widoczna na fotografii, nie automatyczna data każdej wcześniejszej kwoty. Pięć dolnych, nieopisanych wierszy fotografii morskiej pozostaje nieaktywne.

Waluta robocza partnera: USD zgodnie z ustaleniem projektu; sam znak $ nie jest dowodem ISO. Źródło/proweniencja ma zostać w metadata.

## 2. Gabaryt i fracht

Mnożnik dotyczy WYŁĄCZNIE ceny lądowej:
- ×1,0: Sedan, SUV Standard, Van Standard, MUV Side-by-side, Golf cart, Snowmobile, Jet Ski;
- ×0,8: Motorcycle, ATV, Lawn Mower;
- ×1,5: SUV Large, Pickup Truck Standard, Pickup Truck Large;
- ×2,0: Van Large, Pickup Truck Oversized;
- inne: indywidualna wycena.

Nie wymyślaj progów Large/Oversized. Używaj wiarygodnych danych typu/gabarytu; jeśli są niewystarczające, pokaż jedno pole klasy transportowej z jawnym założeniem. Nie wnioskuj gabarytu z paliwa ani samego modelu.

Fracht 40'HC jest PER VEHICLE: używaj 24 zaimportowanych stawek (1–4 auta × 6 terminali). Nie dziel ich ponownie przez 3/4. Scenariusz 4 auta = standardowy, 3 auta = ostrożniejszy kosztowo. To NIE dowód, że każdy pojazd zmieści się w takim załadunku ani gwarantowane min/max końcowej ceny. Dla dużych/ponadgabarytowych pojazdów wymagaj zgodnego wariantu załadunku zamiast wymuszać 4 auta.

## 3. NOWA REGUŁA — 150 USD za pakowanie EV

Właściciel potwierdził: każde auto elektryczne ma dodatkowo 150 USD za pakowanie do kontenera. Kwota jest w `data/surcharges.csv`, źródło w `sources/OWNER_EV_PACKING_2026-10-04.md`.

Zaimplementuj osobną pozycję `ev_container_packing`:
- 150 USD na jeden potwierdzony BEV;
- raz na auto, w każdym alternatywnym scenariuszu, nie suma obu scenariuszy;
- nie mnożyć ×1,5/×2 gabarytu; nie dzielić przez liczbę aut w kontenerze;
- cztery BEV = cztery jednostki dopłaty = 600 USD łącznie;
- dla spalinowego status `not_applicable`; dla HEV/PHEV/FCEV i nieznanego napędu reguła nie została rozstrzygnięta — nie utożsamiaj ich automatycznie z BEV ani nie deklaruj potwierdzonego braku dopłaty;
- jedno źródło klasyfikacji napędu dla kalkulatora i sekcji EV Home, ale oddzielne decyzje o dopłacie i przynależności do sekcji;
- źródło kwoty: właściciel/partner, potwierdzenie 04.10.2026; effective_from niepodane.

Wzór transportu przed ewentualnymi podatkami i usługami końcowymi:
`land_base(preferred_terminal) × land_multiplier + sea_per_vehicle(same_terminal, loading_scenario) + applicable_packing_surcharge`.

Przykład referencyjny, baza Houston 205 USD, klasa bazowa, BEV i założony zgodny załadunek:
- standard: 205 + 675 + 150 = 1 030 USD;
- 3 auta: 205 + 850 + 150 = 1 205 USD.

To nie jest wycena konkretnego pojazdu ani cena pod dom. Opłata musi przechodzić przez właściwy model wartości celnej/podatków. Nie dopisuj jej dopiero po naliczeniu cła/VAT; zarazem nie doliczaj ponownie, gdy dana podstawa jawnie już ją zawiera. Klasyfikację fiskalną zweryfikuj na urzędowych źródłach dla wybranego profilu importu.

## 4. Jeden kalkulator zamiast trzech paneli

Zachowaj sprawdzony silnik V3, usuń POWTÓRZENIA UI. Zastąp „Szacowany koszt transportu”, długą tabelę importu i osobny widoczny „Kalkulator ścisły” jednym modułem „Kalkulator ceny pod dom”. Obliczenia ścisłe zostają wewnętrznie i w opcjonalnych szczegółach, a nie jako trzeci konkurencyjny kalkulator.

Desktop: kalkulator blisko panelu aukcji, najlepiej poniżej niego w prawej kolumnie. W dużych ekranach można uporządkować sekcję zdjęcia / dane / ceny, ale zachowaj rozmiar i użyteczność galerii. Sticky tylko jeśli wszystkie kontrolki są osiągalne; nie przyklejaj całego panelu wyższego niż ekran. Mobile: galeria, cena i termin, kalkulator, dalsze szczegóły, bez poziomego scrolla.

Jedno pole ceny z podstawą: „Aktualna oferta”, „Kup teraz” (tylko gdy dostępna), „Własna cena”. Żadna z nich nie jest prognozowaną ceną wygrania licytacji. Aktualna oferta nie jest ceną sprzedaży. Wpisana własna cena nie może być nadpisywana pollingiem; przy zmianie auta stan kalkulatora resetuje się do właściwego rekordu.

Na górze duża, czytelna suma PLN albo dwa opisane warianty. Poniżej krótka rozpiska grup: zakup i aukcja; transport i pakowanie; podatki; obsługa/port; dostawa w Polsce. Pełne składniki i założenia rozwijane w „Szczegóły kalkulacji”. Pokazuj EV +150 USD jako osobny koszt, nie ukryty narzut. Wyświetlaj wybrany terminal w szczegółach jako nazwę, nie route_3.

Nie pokazuj kilkunastu wierszy „Wymaga danych”. Przy niepełnym modelu pokaż znaną sumę z poprawną etykietą oraz jeden krótki komunikat, np. „Zakup i transport: …; do ustalenia: odprawa i dostawa”. Nigdy nie podpisuj subtotalu „cena pod dom”. Brak danych ≠ 0. Jawne zero jest dopuszczalne dla rzeczywiście nieobowiązującego składnika.

## 5. Model kosztu, profile i pieniądze

Kalkulator ma automatycznie wykorzystać istniejące dane auta: platformę, plac, ZIP, cenę, napęd, pojemność, rodzaj nadwozia. Minimalizuj ręczne pola. Prowizja partnera/Rex.Bid, opłaty aukcyjne, port, rozładunek, dokumentacja, ubezpieczenie i dostawa PL pozostają osobnymi, wersjonowanymi danymi; nie podstawiaj stawek BidCars jako stawek partnera.

Oddziel:
1. stawki partnera i potwierdzenie właściciela;
2. oficjalne stawki/opłaty właściwego profilu i daty;
3. jawne założenia orientacyjne, mające źródło lub zatwierdzony przedział;
4. rzeczywiście brakujące dane.

Dla szacunku można stworzyć osobny, nazwany profil założeń i wskazać kraj odprawy/port oraz zakres usług. Nie aktywuj nieudokumentowanych liczb tylko po to, by uzyskać finalną sumę. Jeśli źródeł do pełnego scenariusza brakuje, implementuj działający transport i zwięzły subtotal; lista braków nie blokuje reszty UX. W raporcie pokaż maksymalnie trzy grupy brakujących decyzji partnera.

Zweryfikuj bieżące zasady celne i podatkowe w oficjalnych źródłach. Nie utrwalaj podatkowego błędu tylko dlatego, że stary test go oczekiwał. Oddziel import bezpośrednio do Polski od odprawy w innym kraju UE i późniejszego przewozu/nabycia w Polsce. Nie stosuj automatycznie polskiego VAT do Rotterdamu ani stawek ze screenu do każdego auta. Kraj zakupu USA ≠ kraj pochodzenia; BEV ≠ automatyczna zerowa stawka wszystkich podatków.

Wartość celna, podstawa VAT i podstawa akcyzy są odrębnymi wielkościami. Wyliczaj je z oznaczonych składników albo jawnie przyjmuj zweryfikowaną podstawę; nie manipuluj wartością w celu obniżenia wyniku do benchmarku. Status uszkodzenia nie uzasadnia arbitralnej wartości 0. Rozdziel kurs wyświetlania/wyceny od kursu celnego i akcyzowego z datą i źródłem. Niezgodne waluty nie mogą być dodane bez konwersji.

Składniki księgowane dokładnie raz: nie dodawaj jednocześnie lądu i morza oraz ich subtotalu jako trzeciego wydatku; podobnie VAT zawarty w prowizji lub port handling zawarty w pakiecie. Zastosuj centy/decimal, dokumentuj zaokrąglenia, zaokrąglaj UI bez zniekształcania rachunku. Reaguj na zmianę ceny, napędu, klasy, cennika i scenariusza bez dodatkowego requestu Apibara.

## 6. BidCars — porównanie, nie wymuszona zgodność

Przejrzyj źródłowe screeny użytkownika w references/ux i publiczną stronę BidCars jako benchmark organizacji oraz kosztów. Nie kopiuj ich znaków, kodu, zdjęć do serwisu ani oznaczeń zweryfikowanego sprzedawcy. Każdy zrzut to obserwacja z konkretnego czasu, nie zawsze aktualna oferta.

Przykład Honda CR-V: VIN `5J6RW2H94HL026304`, IAAI LOT `45369972`, Portland–Gorham ME.
Na screenie tryb AKTUALNEJ OFERTY: zakup 1 550 USD; aukcja 550 USD; ląd 525 USD; fracht 995 USD; suma pozycji 1–4 = 3 620 USD. Prowizja 450 USD pokazana osobno; sprawdź opis jej VAT, nie wliczaj jej błędnie do 3 620. Screen pokazuje też Rotterdam, cło 10%, VAT 21%, agencję/rozładunek 500 EUR, dostawę 2 500 PLN, tłumaczenia 260 PLN i wynik 25 835 PLN. Nie są to potwierdzone koszty Rex.Bid. Widoczna akcyza z podstawą 0 na screenie nie upoważnia do ustawienia akcyzy 0 w naszym modelu.

Drugi screen ma PROGNOZĘ 54 582–56 833 PLN. Nie porównuj tego wyniku z kalkulacją opartą na bieżącej ofercie 1 550 USD. Tryb „prognozowany” wymaga własnych wiarygodnych danych/prognozy; nie dodawaj fikcyjnej prognozy do Rex.Bid.

Nasz cennik dla tej lokalizacji i mnożnika 1,0: preferowana Elizabeth, ląd 450 USD + morze 575/650 USD = 1 025/1 100 USD. To o 495/420 USD mniej niż transport 525+995=1 520 USD na screenie, przed podatkami. Honda nie jest przykładem do doliczania dopłaty EV bez potwierdzonego napędu.

Zbuduj raport `docs/CALCULATOR_BENCHMARK_BIDCARS.md`: wspólne wejścia (VIN/plac/cena/tryb/kraj odprawy/klasa/zakres usług/data i kurs), źródło każdego składnika, BidCars, Rex.Bid, różnica i przyczyna. Zrób dwie kontrole: a) przy identycznych wejściach zgodność arytmetyki/podstaw; b) z naszym cennikiem wyjaśnione różnice ekonomiczne. Bez oczekiwania identycznej sumy przy innych taryfach. Nie zwiększaj transportu ani marży, aby „wyjść podobnie”.

## 7. Home i ceny na karcie

Hero:
**Cena z aukcji to dopiero początek.**
Podtytuł: **Porównaj auta z Copart i IAAI, poznaj ich historię i policz transport przed licytacją.**
Podtytuł ma nie obiecywać kompletnej ceny pod dom przed uzupełnieniem modelu. Zachowaj wyszukiwarkę VIN/LOT/marka/model i dotychczasową kolorystykę/navy/złoto; bez rebrandingu i bez gigantycznego hero.

Cztery sekcje: Aktualne aukcje; Timed Auction; Kup teraz; Samochody elektryczne. Nadchodzące usuń tylko z Home, pozostaw jako filtr katalogu. EV musi działać end-to-end: filtr backendu/providera lub D1, canonical napęd, URL stanu, paginacja, „Zobacz wszystkie”. Nie filtruj tylko pierwszej losowej strony i nie pobieraj w pętli stron, żeby sztucznie wypełnić sekcję. Tylko potwierdzone BEV; HEV/PHEV/FCEV nie są BEV. Brak wiarygodnego paliwa nie kwalifikuje auta po samej marce/modelu. Puste/stare dane stagingu oznacz uczciwie, nie prezentuj zakończonych ofert jako aktualnych.

Panel aukcji: duże, spójne „Aktualna oferta” i „Kup teraz”, obok siebie na desktopie jeśli jest miejsce, pionowo na mobile. Nie oznaczaj ceny licytacji badge'em Kup teraz. Nie ukrywaj Buy Now w malutkiej karcie. Przy niedostępnym Buy Now usuń drugi blok; historycznej kwoty nie pokazuj jako aktualnej. Przycisk „Policz dla tej ceny” tylko ustawia kalkulator, nie udaje zawarcia zakupu/zlecenia licytacji.

## 8. Termin aukcji — naprawa semantyki, nie jednego LOT

Przykład regresyjny ze screenów: Copart LOT `58307896`, VIN `1NXBU4EE5AZ356314`. Rex.Bid pokazał 04.10.2026 19:00 i odliczanie; Copart pokazał Upcoming bez przydzielonego terminu. Nie hardkoduj wyjątku dla tego auta.

Prześledź adapter → canonical → merge/cache/D1/API → Home/katalog/karta. Odróżnij rzeczywistą przyszłą datę od historycznej/pomocniczej/przewidywanej. Oficjalna informacja ogólna w stopce Copart o upcoming jest dokumentacją, NIE polem stanu dowolnego lotu; diagnoza musi odwoływać się do danych konkretnego rekordu.

Oddziel stan harmonogramu (unassigned/date_only/scheduled/unknown/conflict), fazę aukcji oraz opcje Buy Now/Timed. Copart „Upcoming lot”/„Future” bez przypisania aukcji nie jest równoznaczne z ogólnym IAAI „upcoming” przy potwierdzonej przyszłej dacie.

Jednoznaczny świeży sygnał unassigned ma pierwszeństwo nad pomocniczym/starym timestampem: pokaż „Termin aukcji nieustalony”, bez daty/countdownu. Data dzienna bez godziny: pokaż tylko dzień i „godzina niepotwierdzona”, bez wymyślonej północy. Potwierdzona data+czas+strefa może zasilać odliczanie. Konflikt danych: nie udawaj potwierdzenia. Samo upłynięcie licznika nie dowodzi live ani sold. Nie bierz nowej daty z historii poprzedniego relistingu.

Sprawdź zasadę partial merge: potwierdzone unassignment musi jawnie unieważnić stary termin, mimo że zwykły brak/null z discovery nie kasuje wcześniej dobrych danych. Zabezpiecz timestampy stanów, aby stary summary nie nadpisał nowszego detail. Wersjonuj/unieważnij zaległy cache po zmianie semantyki; nie zwiększaj pollingu. Jawne UTC/source timezone, prezentacja z określoną strefą i testami DST. Ta sama reguła w Home, katalogu, karcie i timerach. Nie zastępuj nieznanej aktualnej ceny historyczną tylko dlatego, że jest liczbą.

## 9. Sprzedający i dokument

Jeden kompaktowy blok: „Sprzedający i dokument”. Nazwa sprzedawcy jeśli rzeczywiście jest w źródle; przy braku nazwy i typie insurance pokaż „Ubezpieczyciel”, bez „Nazwa niedostępna · Insurance”. Nie dodawaj nieudokumentowanych odznak zaufania.

Dokument: oryginalna nazwa TITLE, stan dokumentu, brand/uwagi i ewentualny status Title Pending jako odrębne informacje. Stan placu ≠ stan dokumentu ≠ auction state. Nie wyświetlaj open/finished jako stanu geograficznego. Zachowaj oryginalny tekst z czytelnym polskim objaśnieniem; nie sklejaj dwa razy collision damage.

Nie pokazuj zielonej pewności rejestracji/eksportu na podstawie samego „Salvage”. Oddziel informację ze źródła od kwalifikowanej interpretacji. Oryginalny dokument można otworzyć tylko gdy istnieje rzeczywisty URL; bez martwych przycisków. Zlikwiduj duplikowanie tych samych informacji w wielu dużych kartach.

## 10. Aktualizacje stawek bez zmiany algorytmu

Zintegruj pakiet z istniejącym importerem; nie utrzymuj dwóch aktywnych, rozbieżnych cenników. CSV/JSON z pakietu to deterministyczne dane, XLSX to edytowalny widok. Dodaj jawny import XLSX→model ALBO niezawodny eksport/manifest i instrukcję; samo zapisanie Excela nie może być opisywane jako publikacja ceny.

Wersjonuj cały zestaw (kwoty, terminale/preferencje, mnożniki, dopłaty EV, profile założeń). Zachowaj source/received_at/effective_from/status. Hash ma obejmować również surcharges i routing. Edycja EV 150→nowa kwota, zmiana jednej stawki albo preferencji mają zmieniać dane i wersję, nie funkcje obliczeniowe. Stary snapshot wyceny zachowuje version i założenia; łatwy rollback cennika.

Przed publikacją: validate → diff stare/nowe z liczbą zmian → testy → staging → zatwierdzenie wersji. Źródła, konflikty, prywatne obrazy ekranów i dane logowania nie mogą trafiać bez potrzeby do publicznych assets; UI potrzebuje wyłącznie zatwierdzonego minimalnego zbioru. Pełny panel admina nie jest celem tego sprintu.

## 11. Testy, wydajność, budżet

Co najmniej pokryj zachowaniem (nie tylko grep HTML): preferowany routing kontra minimum; mnożniki tylko lądu; null vs zero; konflikty Albany i multi-match ZIP; 1–4 auta per vehicle; BEV +150 raz; HEV/PHEV nieudowodniony zakres; 4 BEV +600; pickup nie mnoży 150; zmiana ceny/scenariusza nie duplikuje opłat; data i podstawa wyceny; brak podwójnego sumowania podatków/subtotali; rate-version/aktualizacja cennika.

Aukcja: Copart unassigned ze sprzecznym przyszłym timestampem; scheduled future; date-only; IAAI assigned upcoming; closed/sold/cancelled; re-listing; błędna data/strefa/DST; clear starego terminu; spójność Home/katalog/karta. EV: obie platformy, D1/provider, paginacja, unknown fuel, hybrydy poza sekcją.

Browser QA na faktycznie NOWEJ wersji: Home; wyszukiwanie VIN/LOT; Copart i IAAI; Buy Now i własna cena; EV/dopłata; galeria/lightbox/miniatury/360/wideo; historia źródła vs snapshot; guest favorites; kalkulator; mobile 390×844 i 360px oraz desktop ok.1440×900. Przy 100% zoom brak overflow, nagłówków zasłanianych sticky menu i mikroskopijnego tekstu. Wykonaj screenshoty przed/po. Brak narzędzia mobile nie oznacza PASS: użyj lokalnego Playwright/browser fixture, a ograniczenia nazwij.

Nie uruchamiaj dodatkowych discovery/backfill/Cron. Domyślnie fixtures i już dostępne dane. Twardy cap całego sprintu i QA: maks. 20 nowych requestów Apibara, w ramach pozostałych istniejących limitów; żadnego podnoszenia produkcyjnych limitów. Wlicz detail/history, błędy, automatyczne fallbacki i browser nawigacje; bez auto-retry i pętli. Możesz wykonać mały kontrolowany odczyt dla diagnozy konkretnych przykładów, reszta testów na odtwarzalnych fixture'ach. Zarejestruj liczniki przed/po i korelację; agregatu zawierającego inny ruch nie nazwij dokładnym wynikiem własnych testów.

Produkcyjny provider-backed kontrakt sprawdź lokalnie/integracyjnie, nie tylko stagingowy D1. Testowe transporty fetch nie mogą tworzyć publicznej furtki Auth lub limitów. Nie psuj zabezpieczeń CSP/nonce, allowlist, cache prywatnych endpointów, API routing extensionless /car i .html. Obliczanie kalkulatora nie zużywa API. Zachowaj obecne funkcje bez przebudowy kont i D1 sync.

Uruchom pełne `node --test`, istniejący generator `--check`, walidator konfiguracji, kontrole składni i diff-check; testy pakietu 14/14 nie zastępują testów repo. Nie kasuj regresji, żeby uzyskać PASS.

## 12. Zakończenie sprintu i publikacja

Staging wdrożony na właściwy Worker, Version ID podany. Nowe allowlisty/gate'y testowane na wdrożonych assets i lokalnym kontrakcie produkcyjnym. Użytkownik ma otrzymać jeden link do nowego Home i konkretne linki do karty Copart, IAAI/Buy Now i kalkulatora z BEV (jawnie oznaczone fixture preview, gdy brak realnego dostępnego rekordu). Nie odsyłaj do pustego starego Home jako dowodu nowego UX.

Zaktualizuj handoff/roadmap/model kalkulatora/transportu. Dodaj raport benchmarku i instrukcję aktualizacji stawek. Na górze handoffa jeden stan bieżący: commit, wersja stagingu, ostatnia zgłoszona produkcja, done/not verified, źródła stawek i otwarte decyzje. Historyczne sekcje nie mogą udawać aktualnych.

Raport końcowy: krótkie zmiany widoczne dla właściciela, zdjęcia przed/po, przykłady z rozbiciem rachunku, dopłata EV, preferred routing, naprawa dat, wynik benchmarku i wyjaśnienie różnic, liczba testów, nowe requesty Apibara, pliki, maks. trzy grupy brakujących danych partnera. Jasno oddziel dane potwierdzone, założenia i testy syntetyczne.

Przygotuj gotowego kandydata produkcyjnego i rollback, ale NIE wykonuj production deployu, migracji, commitu ani pushu. Właściciel najpierw ogląda wynik i zatwierdza osobno publikację. Błąd w dwóch spornych wierszach cennika ma być izolowany, nie blokować innych 608. Nie nazywaj pełnym kosztem pod dom sumy bez wymaganych składników.

Wynik oczekiwany: działający, spójny produkt do odbioru, a nie kolejny raport „fundament przygotowany”.
