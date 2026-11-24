# Test klienta REXBID w przeglądarce

24 listopada 2026. Produkcja rexbid.pl i odizolowany staging rexbid-audit-staging.tedn828.workers.dev. Testy oznaczono jako ruch techniczny. Formularz kontaktowy przeszedł próbę lokalnej walidacji pustych pól. Wysłanie wiadomości, przyjęcie pieniędzy i dostęp administratora są poza zakresem tych pomiarów.

## Wyniki dla właściciela

- Na telefonie o szerokości 390 px nagłówek wyników wyszukiwania kończył się na wysokości 687 px. Skrócenie go do 313 px daje 374 px miejsca na katalog. Rozbudowany kalkulator budżetu pozostaje na głównej. Przejście do wyników pomija filtry i ustawia fokus klawiatury na początku listy.
- Na karcie tego samego auta przy 1366 px przeglądarka pobrała 1 716 920 B zdjęć na produkcji i 352 481 B na stagingu (spadek o 79%). Osobna próba identycznej oferty i obu wersji kodu na lokalnym serwerze potwierdziła mechanizm. Transfer obrazów wyniósł odpowiednio 1 716 450 i 351 913 B. Główne zdjęcie na pulpicie zachowuje rozdzielczość, a powiększenie, zmiana zdjęć i zamknięcie klawiszem Esc zostały sprawdzone.
- Na trzech telefonicznych rozmiarach archiwum przestało wychodzić 24–25 px poza ekran. Odczyt wszystkich trzech szerokości znajduje się w surowych pomiarach. Na stagingu po otwarciu nie trzeba przesuwać poziomo strony, aby odczytać kartę lub użyć przycisku wyszukiwania.
- W pierwszym wdrożeniu stagingu znaleziono 404 pięciu skryptów kalkulatora. Próba budżetu po wybraniu konkretnego LOT-u odtworzyła surowy błąd JavaScript. Włączono właściwe moduły stagingu, a w kodzie dodano bezpieczny komunikat z działaniem dla klienta na wypadek kolejnego problemu. Test regresji odłącza moduł na kopii.

## Metoda i zakres

Chrome 157.0.8103.51. Rozdzielczości 360×800, 390×844, 430×932, 768×1024, 1366×768 oraz 1920×1080. Po jednym przejściu każdej z sześciu tras dla każdego rozmiaru, a przy 390×844 łącznie po trzy uruchomienia. Produkcja i staging po 48 odczytów. Nowy profil audytowy, wyłączony lokalny cache Chrome, sieć i CPU laptopa bez sztucznego spowolnienia. Bufory CDN oraz chwila źródłowa kopii katalogu mogą się różnić. Przechwycone dane sieciowe obejmują pierwsze 1,25 s po pełnym załadowaniu strony.

Interakcje sprawdzono w Chromium, Firefox i WebKit przez Playwright. Zrzuty przedstawiają silniki na Windows z emulowanym ekranem. Rzeczywiste urządzenia i czytniki ekranu wymagają osobnego sprawdzenia.

### Mediany mobilne z trzech prób

W każdej parze pierwsza wartość dotyczy produkcji, druga końcowego stagingu. Transfer jest rzeczywistą liczbą przesłanych bajtów według Chrome, podaną w kB dziesiętnych. Wyniki różnych hostów obejmują ich własne dane i cache.

| Ekran | TTFB ms | FCP ms | LCP ms | CLS | Żądania | Transfer kB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Główna | 71 → 88 | 328 → 364 | 328 → 364 | 0 → 0 | 16 → 15 | 122 → 123 |
| Subaru od 2025 | 75 → 79 | 296 → 340 | 296 → 340 | 0 → 0 | 20 → 20 | 246 → 383 |
| Karta Copart 47018496 | 67 → 201 | 220 → 368 | 496 → 368 | 0 → 0 | 44 → 42 | 411 → 412 |
| Budżet zakupu | 61 → 138 | 196 → 260 | 196 → 260 | 0 → 0 | 14 → 14 | 106 → 108 |
| Archiwum | 62 → 67 | 180 → 216 | 196 → 508 | 0 → 0 | 8 → 8 | 39 → 38 |
| Kontakt | 54 → 84 | 276 → 288 | 276 → 288 | 0 → 0 | 10 → 10 | 51 → 52 |

### Lighthouse Mobile

Wartości z osobnego audytu Lighthouse 13.6.0 z symulacją spowolnienia na telefonie. Jeden przebieg na trasę i host. Różnice pojedynczych milisekund lub punktów mogą wynikać z wahań środowiska.

| Ekran | Wydajność /100 | LCP ms | TBT ms | CLS | Dostępność /100 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Główna | 99 → 99 | 1136 → 1667 | 126 → 14 | 0.000 → 0.000 | 96 → 100 |
| Subaru od 2025 | 97 → 96 | 1510 → 1452 | 193 → 158 | 0.009 → 0.087 | 96 → 100 |
| Karta Copart 47018496 | 88 → 97 | 3306 → 1326 | 243 → 207 | 0.000 → 0.000 | 96 → 100 |
| Budżet zakupu | 100 → 100 | 966 → 978 | 0 → 0 | 0.000 → 0.000 | 96 → 100 |
| Archiwum | 99 → 100 | 1027 → 1106 | 9 → 0 | 0.062 → 0.000 | 96 → 100 |
| Kontakt | 98 → 100 | 967 → 1175 | 167 → 0 | 0.000 → 0.000 | 97 → 100 |

## Testy ścieżek i dostępności

| Ekran | Chrome | Firefox | WebKit | Sprawdzenie |
| --- | --- | --- | --- | --- |
| Główna | OK | OK | OK | Menu, Esc, kalkulator i cztery kategorie |
| Subaru od 2025 | OK | OK | OK | Wyniki, rozwijanie filtrów, fokus po skoku, widok listy |
| Karta Copart 47018496 | OK | OK | OK | Galeria, HD, Esc, powrót fokusu, dwie wyceny |
| Budżet zakupu | OK | OK | OK | 30 000 zł i otwarcie auta po numerze LOT |
| Archiwum | OK | OK | OK | Komunikat dla niepoprawnego VIN |
| Kontakt | OK | OK | OK | Zmiana tematu i wymagane pola bez wysyłania |

Wyniki axe-core 4.14.1 dla dostępnych reguł WCAG 2 A/AA, 2.1 A/AA oraz 2.2 AA przy 390 px. Liczba oznacza elementy wskazane przez narzędzie, a ten sam element może wystąpić w kilku regułach.

| Ekran | Produkcja | Staging |
| --- | ---: | ---: |
| Główna | 5 | 0 |
| Subaru od 2025 | 147 | 0 |
| Karta Copart 47018496 | 13 | 0 |
| Budżet zakupu | 2 | 0 |
| Archiwum | 2 | 0 |
| Kontakt | 2 | 0 |

## Interpretacja i materiał do odbioru

Po wpisaniu kolejno 1 100 i 2 500 USD kalkulator pokazał 13 680 zł oraz 20 354 zł. Pojazdem testowym jest autobus IC Corporation, LOT 47018496. Test weryfikuje zachowanie interfejsu. Poprawność finansowa każdego składnika wymaga oceny na rzeczywistej stawce dla odpowiedniej klasy pojazdu.

Przed zmianami na pulpicie każda miniatura Copart pobierała duży plik *_ful.jpg. Na stagingu miniatury pobierają *_thb.jpg tylko dla pozycji widocznych w pasku. Po błędzie można użyć obrazu dostarczonego przez źródło. Gdy źródło nie dostarcza zdjęcia, samochód pozostaje dostępny z czytelnym oznaczeniem.

Po skróceniu nagłówka przeglądarka może wcześniej pobrać kolejną pełnowymiarową okładkę na liście, ponieważ znajduje się bliżej widoku. W lokalnej porównywalnej próbie katalog przy 390 px pobrał więcej obrazów, 125 kB wobec 261 kB. Wybór mniejszego wariantu powiązanego ze źródłem dla okładki 350 px wymaga potwierdzenia jej realnych wymiarów i ostrości. Oszczędność transferu dotyczy potwierdzonej galerii na karcie.

Najdłuższe zarejestrowane syntetyczne zdarzenie interakcji w końcowych próbach Chrome miało 72 ms. Wynik INP użytkowników w 75. percentylu pozostaje niepotwierdzony. Do jego oceny potrzebne są obserwacje użytkowników w CrUX / RUM. [Dokumentacja CrUX](https://developer.chrome.com/docs/crux/api) i [definicja INP](https://web.dev/articles/inp).

W [pomiarach produkcji](before/measurements.json) i [pomiarach stagingu](release/measurements.json) są czasy poszczególnych zdjęć, czasy sieciowe, główne zasoby, transfer i odpowiedzi API. Dostępne są [próby Chrome](release/chrome-interactions.json), [Firefox](release/firefox-interactions.json), [WebKit](release/webkit-interactions.json), [wynik testów kodu](unit-latest.tap) oraz [pełny zestaw pomiarów Lighthouse na stagingu](lighthouse-final-after.json).

Zrzuty tego samego widoku na telefonie: [lista przed](before/catalog-390.png), [lista po](release/catalog-390.png), [wyniki po kliknięciu](release/chrome-catalog-wyniki.png), [archiwum przed](before/history-390.png), [archiwum po](release/history-390.png), [karta przed](before/car-390.png), [karta po](release/car-390.png).

## Dodatkowe powtórzenie Lighthouse na karcie

Po wdrożeniu opisu pojazdu bezpośrednio w HTML trzy naprzemienne pary dla identycznego LOT-u dały medianę 81 → 88 punktów, LCP 3109 → 1264 ms, TBT 506 → 477 ms. [Próba 1](lighthouse-ssr-card-1.json), [próba 2](lighthouse-ssr-card-2.json), [próba 3](lighthouse-ssr-card-3.json).

Publiczne zapytanie do PageSpeed Insights o pomiary użytkowników zwróciło HTTP 429. [Wynik sprawdzenia danych terenowych](psi-field-status.json).

Po wprowadzeniu treści pojazdu do HTML wykonano sześć naprzemiennych pobrań tego samego adresu na obu usługach. Mediana TTFB 207.5 → 259.5 ms, mediana pobrania kompletnego HTML 280 → 347 ms (produkcja → staging). Różne hosty i cache ograniczają możliwość przypisania różnicy wyłącznie renderowaniu. [Odpowiedzi serwera](ssr-timing.json).

Próby awarii po stronie przeglądarki znajdują się w [wynikach awarii kontrolowanych](failure-drills.json). Odczytano 3 scenariusze.

## Limit licytacji i oferta poza aktualnym katalogiem

Na stagingu załadowano 2025 Subaru Forester Wilderness, Copart LOT 66837846. Po pobraniu kursu przeglądarka pokazała limit 1562,00 USD dla 30 000 zł i 12 105,00 USD dla 100 000 zł. Wyniki Chrome, Firefox i WebKit były zgodne. Oferta IC Corporation, Copart LOT 47018496, przestała być obecna na liście w trakcie audytu. Jej karta nadal istnieje. Po podaniu platformy kalkulator pokazuje odnośnik do zapisanej karty i objaśnia brak bieżącego potwierdzenia możliwości licytacji. Nie wyświetla limitu dla tej oferty. Odczyty dla aktywnego i zapisanego auta oraz czas przygotowania wyniku zawierają [próby Chrome](release/chrome-budget-flow.json), [Firefox](release/firefox-budget-flow.json) i [WebKit](release/webkit-budget-flow.json). D1 na kartach listy używa opisu ostatniej zapisanej oferty wraz z datą. Wyświetlenie ceny sprzedaży wymaga aktualnego potwierdzonego wyniku Sold u źródła. [Próby zapisanej ceny, budżetu, historii i ochrony kwoty zero](price-contract.tap).

## Dane pojazdu ze źródła

Dwa oznaczone przypadki na stagingu wykorzystują zapis odczytu Apibary. Copart LOT 46087626 ma kolor biały i dokument PERMIT SALVAGE. IAAI LOT 44103794 ma kolor szary i dokument REBUILDABLE (Florida). Obie karty wskazują próbny charakter i czas pobrania. Po wyłączeniu próby ta sama karta Copart pokazuje skrót ST. [Copart – kolor](release/probe-copart-fields.png), [Copart – dokument](release/probe-copart-document.png), [IAAI – kolor](release/probe-iaai-fields.png), [IAAI – dokument](release/probe-iaai-document.png), [wariant zwykły](release/standard-copart-document.png), [ogłoszenie o próbie](release/probe-iaai-header.png).

Szczegóły Subaru mają starszy odczyt z 27 października. Podany limit jest symulacją. Katalog nadal zawiera ten LOT; bieżąca dostępność wymaga potwierdzenia. W tym samym formularzu sprawdzono świeżo odczytane oferty Copart LOT 77039066 i IAAI LOT 46533436 oraz ich komunikaty. [Pola aktualności Subaru](release/check-subaru-fresh.json) i [daty odczytu próby aktualnego katalogu](release/check-home-fresh.json).

## Odbiór ostatniego wdrożenia stagingu

Wersja 2fcc6a47-a0f9-4420-bb6b-b199d7d3b5f2. Na telefonie widoczny jest nagłówek „Samochody z aukcji w USA. Sprawdź koszt importu.” Lokalne dodanie Subaru do ulubionych oraz powrót na stronę ulubionych pokazały ten sam LOT. Po zakończonym odświeżeniu widoczne były „Oferta z zapisu”, 2500 USD oraz czas 27.10.2026, 15:56. W budżecie dla tej oferty na trzech silnikach pokazano datę i informację o konieczności potwierdzenia dostępności przed licytacją. Próbna karta motocykla IAAI pokazuje „Skrzynia — Brak danych”. [Odczyt gotowej strony](release/final-version-check.json), [główna](release/final-home-390.png), [ulubione](release/final-favourite-390.png).
