# Karty pojazdów, wycena i archiwum REXBID

## Wynik dla właściciela

24 listopada 2026 r. sprawdziłem 46 rzeczywistych ofert w kalkulatorze REXBID i porównałem 26 kart z rekordami Apibary o zgodnej platformie, numerze LOT i VIN. **Najważniejsze wykryte ryzyko finansowe dotyczy limitu licytacji.** Przy budżecie 50 000 zł ręcznie wpisane zerowe kwoty trzech podatków podnosiły sugerowany limit z 4 478 do 7 932 USD. Po zastosowaniu zwykłych stawek koszt dla tej drugiej kwoty wynosił 72 869,20 zł. W wersji do odbioru ręczne kwoty podatków działają w wycenie konkretnej ceny zakupu. Wyznaczenie limitu wymaga przywrócenia kwot zależnych od ceny licytacji.

**Przy dwóch pustych galeriach udowodniłem przyczynę, którą możemy usunąć sami.** Oba domy aukcyjne przydzieliły ten sam numer LOT różnym pojazdom. Automat do zdjęć pytał o sam numer. Apibara zwracała inną platformę, poprawna kontrola tożsamości odrzucała galerię i proces przechodził do następnego auta. Dwa inne puste rekordy mają zdjęcia w Apibarze i prawidłową odpowiedź po numerze LOT. Ich indywidualna przyczyna wymaga osobnego odczytu kolejki. Naprawianie jednej ścieżki nie uzasadnia uznania wszystkich galerii za uzupełnione.

## Co sprawdzono

| Próba | Wynik |
|---|---|
| 26 kart z Apibarą | 18 Copart i 8 IAAI. Zgodność identyfikacji 26/26. Dodatkowy dawny przykład Toyota Tacoma 46557821 zwrócił 404 w katalogu. |
| 46 prób wyceny | 28 Copart i 18 IAAI. Dla 22 oferta podała pełny szacunek. Dla 24 przedstawiła sumę częściową oraz brakujące pozycje. 30 przypadków wywołało dekodowanie danych pojazdu. |
| Druga grupa wycen | 20 ofert wybranych osobno z placów USA, po 10 na platformę, z różnych marek. 16 pełnych wycen. W tej grupie znalazły się również motocykle BMW i auta dostawcze. |
| Weryfikacja rachunkowa | W każdej z 22 kompletnych wycen niezależna suma wierszy w PLN po przeliczeniu walut zgadzała się z wynikiem z dokładnością do 1 grosza. Prowizja w 46 próbach 2 500 zł brutto. |
| Pięć odczytów D1 | Dla każdej badanej tożsamości jeden zgodny wiersz. Po dwa odczytane wiersze raportowane przez D1 na zapytanie. |
| Archiwum i cena sprzedaży | 6 stron, 72 różne klucze platforma–LOT–sekwencja. Dwa przykłady sprawdzone po VIN i źródłowym potwierdzeniu Sold. |
| Wyszukiwarka katalogowa | Właściwy parametr aplikacji `s`. VIN `2T3A1RFV7RW473296`, jego zapis małymi literami ze spacjami i LOT `45111614` zwracają wyłącznie tę samą Toyotę RAV4 IAAI. Zapytania błędne i nieistniejące dają pustą listę. Parametr `q` działa w archiwum. W katalogu jest ignorowany i jego wyniku nie należy używać do oceny wyszukiwarki interfejsu. |

Próba była celowa. Uwzględniała auta z Kanady, oferty bez zdjęć, hybrydy, auta elektryczne, diesle, pozycje Timed i Kup teraz, autobusy i motocykle. Wynik 22/46 opisuje dokładnie tę próbę. Oferta z uszkodzeniem „Normal wear” nie daje podstaw do stwierdzenia, że pojazd jest bezwypadkowy. REXBID udostępnia publiczne karty dynamicznie. Wyceny wykonałem w izolowanym DOM na skryptach pobranych z produkcyjnego HTML; użyłem prawdziwych odpowiedzi produkcyjnego katalogu, kursów i oficjalnego dekodera VIN przez REXBID. To test działania kalkulatora, osobny od oględzin przeglądarkowych i pomiarów wydajności.

## Co widzi klient i jak zgadza się to ze źródłem

- Dla 26/26 rekordów otrzymano dane o liczniku, dokumencie i kluczykach. Pojemność znalazła się bezpośrednio w 11 kartach, typ nadwozia w 24. W 20 kartach były elementy galerii. 12 kart deklarowało 360°, sześć deklarowało wideo. To odczyt metadanych. Odtworzenie wszystkich materiałów i test wszystkich 26 odnośników nie zostały potwierdzone.
- Źródło podało kolor w 25 rekordach. Sprawdzony publiczny obiekt karty i rzeczywista tabela `auction_listings` nie mają pola koloru nadwozia. Przy rozbudowie dodać przechowywanie jako opcjonalne pole z pochodzeniem i odświeżać przy normalnym zapisie; nie wykonywać zbiorczego zapisu całej bazy.
- W 8/26 przypadkach aktualna kwota z ostatniej obserwacji REXBID różniła się od punktowego odczytu Apibary z czasu audytu. Kup teraz różniło się w 2/26. Przykładowo Mercedes Sprinter LOT 48581306 miał w REXBID 1 300 USD, u źródła 2 950 USD. Potwierdzono rozbieżność obserwacji w czasie; pomiar nie izoluje błędu samego importu. W zachowanych danych faza źródłowa była „awaiting_auction”, gdy publiczny zapis wciąż przechowywał „scheduled” lub pustą fazę. To porównanie pól API. Oceniając widoczny użytkownikowi napis trzeba uwzględnić obliczanie fazy w przeglądarce oraz czas wygaśnięcia.
- Publiczne dane kilku rekordów Copart skracają nazwę dokumentu. Dla Dodge LOT 46087626 na karcie zapisano „ST”, kiedy źródło opisuje „PERMIT SALVAGE”. Nie wolno rozwinąć tego skrótu globalnie bez jurysdykcji. Docelowo zachować pełny opis dostawcy wraz z kodem i stanem wydania.
- W 15/26 oferta nie miała nazwy sprzedawcy, chociaż surowa odpowiedź zawierała niepusty tekst. Kontrola jakości ośmiu przykładów ustaliła, że dostawca używa również nazw zastępczych. Nie są to dowody na 15 faktycznie utraconych nazw sprzedawców. Samo określenie typu „unknown” nie identyfikuje sprzedawcy i nie może wskazywać braku ubezpieczenia.
- U źródła 4/26 dopasowanych kart miały niepustą listę zdarzeń historycznych, jedna miała pozycję innego LOT tego VIN. Różne identyfikatory mogą prowadzić do różnych zdarzeń tego samego VIN. Uruchomione testy weryfikują odrzucenie niewłaściwego LOT przy odczycie archiwum lub galerii. Produkcyjne umieszczanie każdego ponownego wystawienia w odrębnym cyklu pozostaje do osobnego sprawdzenia na kolejnych zakończeniach.

## Galerie i archiwum

| Copart LOT | Galerie publiczne / u źródła | Co wykazało ponowne zapytanie |
|---|---:|---|
| 46087626 Dodge Grand Caravan | 0 / 13 | LOT zwraca IAAI Toyota z innym VIN. Zapytanie po VIN daje właściwego Dodge’a i 13 zdjęć. |
| 46350466 Wabash | 0 / 10 | LOT zwraca IAAI Land Rover z innym VIN. Zapytanie po VIN daje właściwy rekord Copart. |
| 46995635 Kenworth | 0 / 10 | Źródło poprawnie rozpoznaje zarówno LOT, jak i VIN. |
| 72024246 Chevrolet Silverado | 0 / 10 | Źródło poprawnie rozpoznaje zarówno LOT, jak i VIN. |

Sprawdziłem liczbę pełnych elementów oraz miniatur na obu końcach. Publiczny rejestr archiwalny zwrócił Chevrolet LOT 67597216, zgodną cenę 1 950 USD i JPEG o wielkości 256 884 B. Drugi rekord, IAAI Acura LOT 46440491, ma 13 150 USD oraz JPEG 334 935 B. W obu wypadkach Apibara zwróciła zakończenie, potwierdzony wynik i cenę sprzedaży na tej samej platformie, VIN i LOT. Dodatkowy Chevrolet Bolt LOT 73424196 ma potwierdzenie kwoty 10 900 USD oraz 12 zdjęć. Utrzymać rozróżnienie między sprzedażą, ostatnią ofertą, wynikiem warunkowym i brakiem wyniku.

## Kalkulator i granice wiarygodności

W tym przebiegu zastosowano tabelę NBP 228/A/NBP/2026 z 24 listopada, USD 4,0819 zł i EUR 4,4633 zł. Poniższe sumy są produkcyjnymi szacunkami z domyślną dostawą kalkulatora. Każdy punkt ma osobny numer LOT. Pełen zestaw zakupów od 1 do 100 000 USD, składniki, zastosowane kursy i komunikaty braków znajdują się w plikach danych.

| Oferta | Cena zakupu | Szacunek pod dom |
|---|---:|---:|
| IAAI Nissan Sentra 46162264 | 1 USD | 15 995,43 zł |
| IAAI Acura TLX 46196877 | 500 USD | 21 520,39 zł |
| IAAI Mazda 3 46342287 | 1 100 USD | 26 064,81 zł |
| IAAI Lexus ES 300h 46344182 | 2 000 USD | 31 453,22 zł |
| Copart Chevrolet Equinox 53646966 | 5 000 USD | 47 415,14 zł |
| IAAI Toyota RAV4 45111614 | 4 999 USD | 54 798,08 zł |
| Copart Toyota Corolla Hybrid 59717616 | 100 000 USD | 600 853,18 zł |

**BidCars i DreamBid. W tym dniu uzyskano zero nowych równoległych wycen na identycznych autach.** Bezpośrednie otwarcie karty BidCars dla Toyoty i kalkulatora/listy DreamBid zwróciło 403. Zwykła próba przeglądarkowa także zatrzymała się na ekranie ochrony. Nie obchodziłem tego ograniczenia. Są dwa istniejące porównania identycznych samochodów z BidCars, obejmujące razem dziewięć kombinacji samochód–kwota. Ford C-Max LOT 46552401, osiem cen od 25 do 100 000 USD. Toyota Tacoma LOT 46557821, jedno porównanie z 19 listopada przy 1 100 USD i dostawie do Warszawy: REXBID 24 188,85 zł, BidCars 26 784 zł, a BidCars po pominięciu dopłaty gabarytowej 800 USD dawał 23 570 zł. Zestawienie wykazuje wpływ dopłaty. Nie uzasadnia deklaracji „zawsze najtaniej”. Nie zweryfikowano dwudziestu ofert z rachunkami obu konkurentów ani bieżącej ceny Toyoty. [BidCars – oferta Toyoty](https://bid.cars/pl/lot/0-46557821/2026-Toyota-Tacoma-Hybrid-3TYLC5LN6TT064414), [DreamBid – kalkulator](https://dreambid.pl/pl/calculator)

**Stawki wymagające kontroli biznesowej.** Profil Copart wybiera konkretną kategorię konta, dokumentu, płatności i kanału licytacji. Dla IAAI zaimplementowano szacunek na podstawie progów Copart z korektą 40 USD i odmienną opłatą dokumentową. Oficjalnych warunków rozliczeniowych konkretnego konta IAAI USA nie potwierdzono. Przed wiążącą ofertą potrzebne są stawki brokera, zasady przewoźnika dla faktycznych wymiarów i trasy oraz ewentualne koszty magazynowania, opóźnienia i ubezpieczenia. Porównanie ze stroną konkurenta nie zastępuje faktury brokera. [Oficjalne opłaty Copart](https://www.copart.com/content/us/en/member-fees-us-licensed-more)

**Podatki.** Model rozpoczyna wycenę dla standardowego auta osobowego od założenia 10% cła i 21% VAT w Holandii. Rzeczywista stawka cła zależy m.in. od klasyfikacji CN i pochodzenia. Kraj placu aukcyjnego nie stanowi dowodu pochodzenia. Polskie stawki dla samochodów osobowych obejmują 3,1% oraz 18,6%, obniżone w określonych przypadkach hybryd do 1,55% i 9,3%. Zwolnienia dla elektrycznych i niektórych PHEV wymagają spełnienia warunków. W modelu VAT mnoży wartość celną i cło przez stawkę NL. Art. 85–86 dyrektywy VAT może wymagać doliczenia określonych kosztów do znanego miejsca przeznaczenia. Podstawa polskiej akcyzy zależy także od konkretnej ścieżki nabycia. Przed ofertą wiążącą uzgodnić z agencją jedną realną odprawę Rotterdam–Polska, w tym podstawy, dokumenty i kurs celny; porównać wiersz po wierszu z fakturą i deklaracją. Nie zmieniano polityki prowizyjnej, podatków ani stawek komercyjnych bez tych danych. [TARIC – Komisja Europejska](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en), [podstawa VAT w imporcie – Komisja Europejska](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/taxable-amount_en), [stawka VAT w NL](https://www.government.nl/themes/taxes-benefits-and-allowances/vat/vat-rates-and-exemptions), [stawki akcyzy – MF](https://podatki.gov.pl/akcyza/stawki-podatkowe), [zwolnienia – MF](https://podatki.gov.pl/akcyza/zwolnienia-i-zwroty)

## Poprawki do odbioru

1. **Limit licytacji.** Ujednolicono ręczne wartości celne z ręcznymi kwotami cła, VAT i akcyzy w trybie obliczania limitu. Zakresy transportu, marży i prowizji pozostały zgodne z zamówieniem.
2. **Indywidualna taryfa.** Jednoznaczne oznaczenia autobusu, skutera, motocykla, ciągnika lub przyczepy nie pozwalają już otrzymać pełnej ceny z osobowymi stawkami cła i akcyzy po ręcznym wpisaniu transportu. W zwykłej wycenie klient może wprowadzić zweryfikowane kwoty, również zero. Niejednoznacznego nadwozia „SPORT” nie uznawano mechanicznie za motocykl. Wymaga wiarygodnego dodatkowego typu pojazdu.
3. **Tożsamość w uzupełnianiu katalogu.** Kiedy LOT przy zweryfikowanym VIN zwrócił rekord drugiej platformy o identycznym numerze, kolejny przebieg pyta po VIN w swoim budżecie. Zapisywany rekord wymaga jednoczesnej zgodności VIN, LOT i platformy. Druga błędna odpowiedź trafia do obsługi konfliktu, co wyklucza pętlę.
4. **Osobny proces zdjęć Copart.** Przy kolizji LOT pobiera kartę po VIN i ponawia ścisłą weryfikację. Dodatkowe zapytanie jest liczone w dziennym i bieżącym budżecie. Jeżeli pozostało jedno zapytanie, proces przechowuje identyfikator galerii i kontynuuje w następnym okresie. Harmonogram, limity, import oraz dane produkcji pozostały bez zmian. Punktem odniesienia był rzeczywisty proces wersji 0caccbfa-67a8-41e5-bd4c-500265d6df99.
5. **Dowód testowy.** W zestawie modułów wyceny i tożsamości przeszło 177/177 testów. W odrębnym procesie zdjęć przeszło 10/10, w tym scenariusz dwóch cykli z wyczerpaniem dziennego budżetu i pojedynczym zapisem poprawnej galerii. Selektor obsługuje zarówno bazodanowy brak wartości, jak i zapisaną pustą tablicę. Jeżeli pełne zdjęcia lub miniatury istnieją, proces zachowuje je. Uzupełnienie zdjęć na publicznej stronie po zatwierdzeniu wdrożenia wymaga kontroli kolejnych rzeczywistych wywołań.

## Co blokuje dodatkowe zdjęcia Copart

24 listopada o 18.05 czasu polskiego zweryfikowano dokładne warunki osobnego procesu uzupełniania zdjęć. Wewnętrzna rezerwa dla publikacji wstrzymywała ten proces. Dostępne miejsce w D1 wynosiło około 5,60 GB względem wewnętrznego pułapu 8 GB. Apibara Pro wskazywała 75 629 pozostałych żądań ze 100 tys. Ostatni pomyślny przebieg zachowany przez proces zdjęć pochodził z 22 listopada, godz. 20.05 w Polsce. Zapisał 20 galerii po 20 próbach. Proces pomija zapis stanu przy zatrzymaniu na rezerwie, więc dokładnej liczby pominiętych cykli nie ustalono. [Stan procesu, cztery oferty i multimedia](vehicle-gallery-priority.json), [odczyt rezerwy](vehicle-gallery-allowance.json).

O godz. 18.11 pozostawało 9,62 mln zapisów po odliczeniu wewnętrznego marginesu. Ustalona polityka chroniła 14,30 mln dla publikacji do końca okresu. Średnia z ostatnich siedmiu zamkniętych dób wyniosła 1,23 mln zapisów dziennie, przy rezerwie 1,10 mln na dobę. Proste obniżenie progu zwiększyłoby ryzyko przerwania importu lub dopłat pod koniec okresu. Najpierw należy zmierzyć odzysk przez zapisywanie zdjęć zawartych już w zwykłej paczce wraz z aktualizacją tego samego rekordu. Ewentualna osobna pamięć zdjęć wymaga pomiaru operacji i potwierdzenia tożsamości dla każdego wpisu. [Dzienne zużycie i obliczenie rezerwy](vehicle-gallery-reserve-trend.json).

Cztery pojazdy Copart z badanego zestawu miały zdjęcia w Apibarze i obie kolumny zdjęć puste w D1. Wszystkie należały do czynnego katalogu i miały prawidłowe identyfikatory. Źródłowe zapisy zestawień pochodziły z 17–20 listopada, a lokalna data uzupełnienia szczegółów była pusta. W osobnej próbie 160 aut Copart ze zbliżającym się terminem 34 miały obie kolumny puste w D1. Żadne z tych 160 nie miało dosłownej wartości `[]`. To pomiar wybranych najbliższych ofert. W czterech ofertach sesja zaczynała się o 18.00 i w chwili odczytu o 18.04 selektor siedmiodniowy już je pomijał. Dwie z czterech ofert dodatkowo ujawniły powtarzalną kolizję numeru LOT między platformami. Dla pozostałych dwóch wyszukanie w źródle po LOT i po VIN zwracało właściwy samochód z galerią. Nie przypisano im fikcyjnej przyczyny. [Pola i koszt odczytu dla każdego LOT](vehicle-gallery-priority.json), [plan skorygowanego zapytania w rzeczywistej D1](vehicle-gallery-plan.json).

IAAI LOT 46162264 i 44185350 udostępniały wideo silnika i obraz 360°. Każdy z czterech adresów uzyskanych z publicznych kart odpowiadał na odczyt początku pliku. Filmy miały właściwą sygnaturę MP4 i rozmiary ok. 16,5 i 16,0 MB. Oba odtwarzacze 360° zwracały dokument HTML o prawidłowym typie. Ten odczyt nie mierzył odtwarzania całego filmu ani płynności obracania na telefonie. [Wyniki żądań i sygnatury](vehicle-gallery-priority.json).

## Karta samochodu, wyniki i indeksacja

Do wersji testowej dodano kartę, której tytuł, nagłówek, opis, dane do podglądu udostępnianego linku i adres kanoniczny pochodzą z dokładnie dopasowanego pojazdu. Adres kanoniczny zachowuje platformę, LOT i VIN, usuwając parametry powrotu do wyników. Otwieranie karty wykorzystuje dotychczasowy odczyt katalogu i przekazuje go przeglądarce do pierwszego wyświetlenia. Brak lub brak terminu potwierdzony przez bazę zwraca 404, konflikt wymagający wyboru aukcji 409, a niedostępność odczytu 503 z krótkim czasem ponowienia. Niepełne informacje i karty bez zdjęć otrzymują instrukcję pominięcia w indeksie. Wyszukiwanie i otwieranie takich rekordów nadal korzysta z istniejącego mechanizmu. Tymczasowa awaria nie zamienia się w informację o usunięciu pojazdu.

Na rzeczywistej karcie IAAI LOT 45111614 porównano ten sam szablon i obiekt danych w 30 lokalnych próbach. Pierwsze otwarcie potrzebowało jednego odczytu oraz zera ponownych żądań po identyczny rekord przy uruchomieniu przeglądarki. Transfer skompresowany Brotli 5 wyniósł 51 703 B przed zmianą i 51 591 B po zmianie. Mediana lokalnego czasu zbudowania odpowiedzi wyniosła 3,03 ms, a 95. percentyl 5,55 ms. Pomiar nie obejmuje czasów sieci, kosztów rozliczeniowych pojedynczego wywołania ani zachowania pamięci podręcznej pod produkcyjnym ruchem. [Próby i warunki pomiaru](vehicle-ssr-cost.json).

Panel ceny karty podaje datę zapisu danych oferty z oznaczeniem polskiej strefy. Gdy źródło nie dostarczyło czasu, klient otrzymuje jawną informację o braku. To szczególnie istotne przy ośmiu różnicach ceny bieżącej na 26 porównanych pojazdów. Do oznaczenia auta jako sprzedanego oraz nazwania kwoty ceną sprzedaży wymagany jest potwierdzony wynik sprzedaży tego pojazdu. Dawny opis skrzyni „Unknown” na sprawdzonym motocyklu IAAI 44103794 otrzymuje etykietę „Brak danych”. Przeszły wszystkie 123 testy sześciu powiązanych zestawów, w tym prawidłowa sprzedaż, wynik warunkowy i pominięty znacznik potwierdzenia. [Wyniki 123 testów](vehicle-integration-regression.txt).

Na publicznym stagingu wersji e00ef917 sprawdzono prawdziwe karty IAAI 46162264 i Copart 47018496. Obie zwróciły 200 przy pobraniu strony i przy pobraniu samych nagłówków. Każda zawierała właściwą markę/model w nagłówku i tytule, poprawny kanoniczny adres, podgląd udostępniania oraz ten sam VIN w danych przeglądarki. Nieistniejący LOT i przestawiony VIN między dwiema ofertami zwróciły 404. Dostęp do katalogu przy awarii bazy sprawdzono osobno na symulowanej odpowiedzi 503. Na szerokości 390 px otwarto przyciski filmu i 360° na Nissanie IAAI. Odtwarzacz rozpoznał film 1280 px o długości 10,80 s. Widok obrotowy otworzył dokument dostawcy i pobrał obrazy JPEG. Zweryfikowany zakres nie obejmował każdej klatki ani gestów na fizycznym telefonie. [Odpowiedzi publicznego stagingu](vehicle-staging-check.json), [zrzut 390 px](vehicle-staging-iaai-390.png), [wyniki Edge dla obydwu odtwarzaczy](vehicle-staging-media.json).

Zestawienie i testy docelowego wykonawcy porównano ze źródłem wdrożenia a95d53bb w katalogu large-delivery-20261124. Zmiana obejmuje moduł uzgadniania identyfikacji i jego test. Tym samym zachowuje dotychczasowe zasady budżetu publikacji. Wszystkie 45 plików testów procesu przeszło, w wersji wyjściowej 713 testów, po samej poprawce kolizji LOT 714, na zintegrowanej kopii ze zmianami odczytu informacji o pojeździe 716. Oba oddzielne zestawy zmian można czysto nałożyć na produkcyjne źródła odpowiednich procesów. [Punkt odniesienia](vehicle-executor-baseline.json), [poprawka wykonawcy](vehicle-executor-identity.patch), [wynik po poprawce](vehicle-executor-patch.json), [pełna integracja](vehicle-executor-integrated.json), [poprawka uzupełniania galerii](vehicle-gallery-identity.patch).

## Otwarte punkty

P1 — przy bieżących zmianach użytkownik może zobaczyć kwotę lub skrót dokumentu sprzed kilku dni. Zmierzyć odstęp od ostatniego źródłowego zapisu do publikacji dla tej samej aukcji na dwóch pełnych paczkach. Dla przyszłego automatycznego uzupełniania braków potrzebny jest pomiar najwyżej jednego dodatkowego zapisu rzeczywistej galerii i zapasu przewidywanego do końca okresu rozliczeniowego.

P1 — marketingowy koszt „pod dom” ma charakter szacunku. Zmierzenie sumy i porównanie do BidCars nie zatwierdza taryf dla różnych brokerów, pojazdów i dokumentów. Właściciel wraz z brokerem i agencją powinien zatwierdzić realne rozliczenie przed przyjmowaniem kwot jako gwarantowanych.

P2 — pełny dokument, kolor oraz status sprzedawcy przeprowadzić przez importer z testami znaczenia wartości zastępczych. Potwierdzić widok historii na wielokrotnie wystawionym pojeździe z dwóch rzeczywistych cykli oraz przejścia 360° i wideo dla obu platform w czasie aktywnej sesji.

## Materiał do powtórzenia

[26 dopasowanych publicznych rekordów i 5 odczytów D1](vehicle-audit-results.json), [46 kalkulacji z dekodowaniem VIN](vehicle-extended-results.json), [dokładne wyszukiwanie i archiwalne zdjęcia](vehicle-finder-archive.json), [4 galerie i 2 wyniki potwierdzone u źródła](vehicle-gallery-source.json). Ceny bieżącej oferty oraz dostępność zdjęć mogą zmieniać się po pomiarze. Próbki nie zawierają danych klientów ani kluczy.
