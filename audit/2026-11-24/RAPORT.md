# REXBID. Odbiór wersji testowej z 24 listopada 2026

**Końcowy odbiór wersji testowej z 24 listopada.** Poprawiono ponowne wystawianie aut na przykładzie Dakoty, ceny Audi i Tesli oraz panoramę IAAI. Komplet trzech poprawek katalogu przeszedł na kopii 803/803 testy. Czysta wersja strony przeszła 2710/2710. Zdalny staging, rzeczywiste czasy publikacji dotychczasowego automatu, rosnąca zaległość odrębnego archiwum oraz warunki przed przyjęciem płatnych zleceń są w [bieżącym raporcie odbioru](ODBIOR-DANE-I-MEDIA.md).

**Aktualny stan całego polecenia z 17:34** uwzględnia późniejsze wdrożenia na rexbid.pl, trzy opublikowane paczki i sprawdzenie galerii Copart na produkcji. Poniższe wyniki zachowują datę i zakres pierwotnego odbioru stagingu. [Rejestr ukończonych i otwartych punktów](STAN-AUDYTU-1734.md)

**Można rozpocząć odbiór portalu na telefonie i komputerze.** Najważniejsza zmiana chroni kupującego przed zalicytowaniem powyżej jego budżetu. Drugą jest prawidłowe rozpoznanie auta, gdy Copart i IAAI mają różne pojazdy o identycznym numerze LOT. Trzecią jest szybsza karta z datowaną ceną, którą można ocenić jeszcze przed załadowaniem całej galerii. W publicznej edycji testowej można przejść od wyboru auta przez zdjęcia do wyceny. Przekazywanie danych klienta i uruchamianie importu zostało oddzielone od podglądu. [Otwórz staging](https://rexbid-audit-staging.tedn828.workers.dev/) · [Otwórz kalkulator](https://rexbid-audit-staging.tedn828.workers.dev/kalkulator-budzet)

**Rekomendacja biznesowa.** Po sprawdzeniu prywatnej ścieżki klienta opublikować najpierw interfejs. Przepływ zdjęć i nowych pól włączyć oddzielnie, po odtworzeniu kopii i próbie kosztu zapisów. Pierwszych klientów obsłużyć w pilotażu z indywidualnym potwierdzeniem auta i kwoty. Z płatną kampanią poczekać na wiążące warunki importu oraz zgodność rozliczenia przykładowego auta z dokumentami brokera i agencji celnej.

## Ocena przed i po

Oceny w skali 0–10 dotyczą opisanych ścieżek. Wersję po zmianach oceniono na stagingu i na kopiach automatu. Wynik nie jest prognozą sprzedaży ani certyfikatem bezpieczeństwa.

| Obszar | Produkcja przed pracami | Wersja do odbioru | Co rozstrzygnęło ocenę |
|---|---:|---:|---|
| Znalezienie auta i powrót do wyników | 7 | 8 | Trzy równoległe wyszukania i kolejne strony z ofertami, powrót do 40 Subaru z filtrem i pozycją przewijania. Na telefonie nagłówek wyników zajmuje o 374 px mniej. |
| Tożsamość auta, dokument, status i cena | 6 | 8 | Właściwe auto sprawdzone z dostawcą w 26/26. Karta ma tożsamość już w HTML, błędna para VIN/LOT zwraca 404, cena sprzedaży wymaga potwierdzenia. Część zapisów jest starsza niż odczyt źródłowy. |
| Bezpieczeństwo decyzji o budżecie | 5 | 8 | Przy 50 tys. zł ręczne wyzerowanie podatków zawyżało limit o 3454 USD. Dodano wymaganie przeliczenia podatków przy zmiennej cenie. 22 kompletne wyniki z 46 sumowały się do grosza. W 24 przypadkach brakowało danych do pełnego wyniku. |
| Telefon i galeria | 6 | 8 | Archiwum mieści się na ekranie, fokus wraca po zamknięciu zdjęcia, główna galeria na badanej karcie wymagała o 79% mniej bajtów na komputerze. W przeglądarce mobilnej działały 360° i film IAAI. Brak zdjęć nadal dotyczy części ofert. |
| Techniczne SEO | 4 | 7 | Właściwy tytuł i adres kanoniczny karty, rzeczywiste 404 i sześć spójnych adresów mapy. Raport prywatny Google i rzeczywiste wskaźniki użytkowników pozostają do sprawdzenia. |
| Aktualność i ciągłość katalogu | 6 | 6 | Działające automatyczne publikacje, ale osobne uzupełnianie galerii ma za mało bezpiecznych zapisów. Nowy kod wykonawcy sprawdzono na kopii. |
| Zaufanie i przyjęcie zlecenia | 6 | 6 | Klient ma proces, prowizję i kontakt. Publiczne dokumenty nadal noszą oznaczenia robocze, a przy bieżącym wydaniu nie przeprowadzono doręczenia wiadomości z pełnym logowaniem. |

## Usterki, przyczyny i stan napraw

| Priorytet | Skutek dla kupującego i potwierdzona przyczyna | Co wykonano i gdzie |
|---|---|---|
| P1 | Przy budżecie 50 000 zł można było uzyskać 7932 USD limitu. Zakup za tę kwotę przy zwykłych stawkach w badanym przypadku kosztowałby 72 869,20 zł. | **Staging.** Poprawiono odwrotne obliczenie. Wynik przy domyślnych założeniach to 4478 USD. W wycenie jednej wybranej ceny nadal można wpisać własne wartości podatków. Przy nietypowym pojeździe pojawia się wymóg właściwej taryfy. Prowizja 2500 zł brutto. |
| P1 | Zapisana stara oferta mogła wyglądać jak aktualna, a wynik sprzedaży jak potwierdzony. W 8 z 26 przypadków bieżąca kwota różniła się między czasami odczytu. | **Staging.** W karcie i na liście widać datę zapisanej obserwacji. Status sprzedaży i cena wymagają źródłowego potwierdzenia. Zapisany pojazd poza bieżącym katalogiem można obejrzeć bez zachęty do ustalenia bieżącego limitu. |
| P1 | Dwa przypadki pustych galerii wynikały z takiego samego LOT na różnych platformach. Źródło faktycznie miało zdjęcia, a poprzedni proces odrzucał niepasujące auto. | **Kopia wykonawcy i procesu zdjęć.** Jedno ograniczone budżetem wyszukanie po VIN, kontrola platformy, LOT i VIN, wznowienie po wyczerpaniu przydziału. Uzupełnianie obsługuje pustą listę i brak wartości. Powrót zdjęć w produkcji czeka na decyzję o wydaniu i dostępny budżet zapisów. |
| P1 | Generyczna karta zwracała 200 także dla nieistniejącego LOT. W początkowym HTML brakowało tożsamości auta. | **Staging.** Dane właściwego pojazdu są w pierwszej odpowiedzi i są używane ponownie przez przeglądarkę. Potwierdzony brak zwraca 404, niejednoznaczność 409, przejściowa awaria 503. Nie pobiera się ponownie tego samego rekordu tylko po to, aby narysować kartę. |
| P2 | Pełna nazwa dokumentu i kolor bywały dostępne u dostawcy, chociaż klient widział skrót lub brak. | **Kopia i dwa przykłady na stagingu.** Dodatkowa opcjonalna kolumna koloru, aktualizacja istniejącej nazwy dokumentu, zachowanie znanej wartości przy pustym źródle. Próba odtworzenia bazy udana. Standardowe dane produkcji nadal pochodzą ze starego schematu. |
| P2 | Miniatury pobierały niepotrzebnie duże pliki. Archiwum wymagało poziomego przewijania. Niektóre kontrolki nie miały dostępnych nazw lub odpowiedniego kontrastu. | **Staging.** Mniejsze zdjęcia przy pierwszym otwarciu, HD na żądanie, poprawa galerii, nawigacji klawiaturą i kontrastu. Zachowano logo i cztery kategorie. |
| P2 | Nieaktualne schematy testowe i dawno zaszyte w nich terminy powodowały fałszywe błędy. W serwerze podglądu Node skaner zależności wykrył dwa znane ostrzeżenia. | **Gałąź robocza.** Poprawiono dane i dodano regresje dla dat, list przed paginacją, relacji historii i tożsamości. Po aktualizacji zależności środowiska uruchomieniowego skaner zgłosił 0 znanych ostrzeżeń w tym zakresie. |

[Kompletność poszczególnych pól](POLA.md) · [Auta, daty, zdjęcia, źródła i podatki](POJAZDY-WYCENY.md) · [Próby koloru, pełnych dokumentów i odtworzenia danych](KOLOR-DOKUMENT.md) · [Wiarygodność testów katalogu](wiarygodnosc-testow-katalogu.md)

## Co faktycznie działa na produkcji

24 listopada o 18:24 czasu polskiego wszystkie pięć skontrolowanych usług nadal miało te same wersje co przed etapem. Paczka **22975** została opublikowana o **12:58:33**. Po niej automat opublikował dziesięć kolejnych, aż do **23178 o 18:12:09**. Do tej ostatniej od odebrania minęło 36 min 14 s. Nowsza **23201** była odebrana i w zapisie. Różnica czasów odbioru między ostatnią opublikowaną i najnowszą wynosiła około 30 minut. W tej obserwacji pliki przychodziły zwykle co pół godziny, choć w ostatnich 24 odstępach odnotowano także długą lukę. Nie ma podstaw do obietnicy stałej aktualizacji każdej ceny w czasie rzeczywistym. Próba publiczna otworzyła oba auta i obrazy JPEG, w tym 13 zdjęć Copart i 11 IAAI. Sekcja Timed miała 3405 pozycji z datą w osobnym odczycie źródła sprzed około 3 godz. 38 min. [Kontrola końcowa](production-after.json) · [Wiersze zakończonych paczek](generations.json)

Archiwum osiągnęło **13 314 galerii** według pomiaru o 18:21. Pozostawało około 256,8 GB w budżecie magazynu. Wybiórczo sprawdzono 72 różne wpisy na sześciu stronach i dwie zakończone aukcje z ceną sprzedaży potwierdzoną u dostawcy. Osobny proces zdjęć dla bieżących Copart wykazywał 2791 wcześniejszych uzupełnień i rezerwę zapisów przeznaczoną na publikację. W celowo wybranych 160 ofertach 34 nie miały zdjęcia. To nie jest odsetek całego katalogu. Z czterech wybranych pustych galerii wszystkie miały po 10–13 zdjęć u dostawcy. Dwie wyjaśniła kolizja numeru. Pozostałe wymagają śledzenia konkretnych operacji. [Próba i rezerwa zapisów](POJAZDY-WYCENY.md)

Kontrola uzupełniająca o 18:33 potwierdziła postęp zapisu paczki 23201 z części 18 do części 67 i wzrost archiwum do 13 334 galerii. W chwili tego odczytu ostatnią w pełni opublikowaną generacją pozostawała 23178. [Odczyt o 18:33](production-closing.json)

## Jak obejrzeć zmiany i dowody


1. Na telefonie wybierz wyszukiwanie Subaru od 2025, otwórz drugą stronę, wejdź na kartę i wróć do wyników. Oczekiwane są zachowana kolejność, zakres rocznika i pozycja. [Katalog na stagingu](https://rexbid-audit-staging.tedn828.workers.dev/) · [Udokumentowana próba produkcyjna](WYSZUKIWANIE.md)
2. W kalkulatorze wpisz **100 000 zł** i wybierz platformę z numerem LOT. Przy próbie Ford Escape Copart 77039066 wynik wyniósł 13 882 USD, a Toyota Camry Hybrid IAAI 46533436 dała 13 341 USD. Późniejsze kursy, aktualność i ceny mogą zmienić wynik. [Kalkulator](https://rexbid-audit-staging.tedn828.workers.dev/kalkulator-budzet)
3. Otwórz przykłady z oznaczeniem próby źródłowej. Na Dodge widać biały kolor i „PERMIT SALVAGE”, na Hondzie szary i „REBUILDABLE (Florida)”. [Przykład Copart](https://rexbid-audit-staging.tedn828.workers.dev/car?proba=dane&platform=copart&lot=46087626&vin=2C4RDGBG4HR742563) · [Przykład IAAI](https://rexbid-audit-staging.tedn828.workers.dev/car?proba=dane&platform=iaai&lot=44103794&vin=RLHKF4714PY100644)
4. Porównaj [katalog przed](browser/before/catalog-390.png) i [po](browser/release/catalog-390.png), [kartę przed](browser/before/car-390.png) i [po](browser/release/car-390.png), [archiwum przed](browser/before/history-390.png) i [po](browser/release/history-390.png). Na karcie IAAI 46162264 rzeczywisty film miał 10,80 s, a podgląd obrotowy pobrał obrazy w oknie przeglądarki. [Dowód multimediów](vehicle-staging-media.json)

## Wydajność, dostępność i próby awarii

96 pomiarów w Chrome, sześć rozdzielczości od 360×800 do 1920×1080, a do tego 18 ścieżek interaktywnych w Chromium, Firefox i WebKit. W porównaniu tej samej karty ilość zdjęć przy wejściu na komputerze spadła z 1 716 920 do 352 481 bajtów. W trzech naprzemiennych parach Lighthouse mobile mediana LCP tej karty spadła z 3,11 do 1,26 s, a wynik wydajności wzrósł z 81 do 88. TBT wyniósł 506 → 477 ms. Mediana TTFB w sześciu odczytach strony wzrosła z 208 do 260 ms. Na telefonie krótszy początek katalogu pokazuje więcej zdjęć i może podnieść transfer pierwszego widoku. W sześciu sprawdzonych widokach automat dostępności nie zgłosił po zmianach wcześniejszych naruszeń. Rzeczywisty INP użytkowników, głosowy czytnik ekranu i fizyczne telefony pozostają do odbioru. [Pomiary, zrzuty, regresje i ograniczenia metody](browser/UX-BROWSER.md)

Na osobnej usłudze testowej niezalogowany użytkownik otrzymał odmowę dostępu do danych klienta i panelu właściciela. Na izolowanej kopii przeszło 236 prób uprawnień, sesji, dokumentów i archiwum oraz 116 prób odporności. Sprawdzono m.in. odmowę przy cudzej realizacji, drugi składnik, szyfrowane załączniki testowe, odpowiedź przy niedostępnej bazie, utracie połączenia i zatrzymanym zapisie paczki. To części większego zestawu. W tym etapie nie logowano się prywatnymi danymi klientów ani nie wymuszano przerw w produkcji. [Bezpieczeństwo, awarie i koszt archiwum](BEZPIECZENSTWO-AWARIE.md) · [Przegląd kodu i aktywne ustawienia prywatności](PRZEGLAD-KODU.md) · [Końcowe wyniki pełnych zestawów](WYNIKI-TESTOW.json)

W osobnej próbie Chrome przeszedł pięć scenariuszy prywatnego panelu na lokalnych danych testowych (21/21 sprawdzeń). Otwierał właściwą rozmowę, zmieniał realizację, sprawdzał rolę właściciela z MFA i usuwał dane z widoku po wygaśnięciu sesji. Zapis i wysyłka do zewnętrznych usług były wyłączone. [Próba panelu ze zrzutami](PORTAL-UI.md)

## Konkurenci, SEO i pozyskanie pierwszych klientów

BidCars pokazuje lokalizację, transport i informacje historyczne na karcie. DreamBid prowadzi od katalogu i poradników do kontaktu, VinBidHistory ma odrębne adresy marek i VIN. Mocna strona REXBID to przejście od budżetu klienta w złotych do limitu w dolarach dla wybranego auta. Do kupującego samochód za kilkadziesiąt tysięcy złotych lepiej przemówią sprawdzone rozliczenie jednej transakcji i jawny termin odpowiedzi niż kolejne kategorie na stronie głównej. Oceniono pięć domen i oznaczono miejsca, w których kontrola dostępu ograniczała własny pomiar. Dla 20 jednakowych aut nie udało się uzyskać w tym etapie aktualnych, równoległych wycen w obu konkurencyjnych kalkulatorach. Dostępne dwa historyczne porównania BidCars obejmują dziewięć kombinacji auto–cena. Różnica w koszcie może wynikać m.in. z kwalifikacji gabarytów. [Porównanie funkcji z ocenami i źródłami](konkurencja-seo.md)

Indeksować publiczne strony, które mają potwierdzoną treść. Mapa zawiera sześć kanonicznych adresów, a nie miliony kombinacji filtrów. Karty otrzymały opis w pierwszej odpowiedzi. Dokumenty wymagające zatwierdzenia są poza mapą. Kolejne strony powinny odpowiadać na rzeczywistą intencję: jak czytać uszkodzenia, jak wycenić transport do Polski przez Holandię, jak sprawdzić historię VIN. Prywatne raporty Search Console pokażą dopiero faktyczne wyświetlenia i wizyty. [Konfiguracja Search Console](WYSZUKIWANIE.md) · [Strategia SEO i progi jakości](konkurencja-seo.md)

| Budżet miesięczny | Pierwsze działanie | Warunek dalszej inwestycji |
|---|---|---|
| 0 zł | Pilotaż przez rzeczywiste polecenia, kalkulator i jeden udokumentowany przykład importu. | Sprawdzić zapis zapytania, odpowiedź pracownika i kwalifikację kontaktu. |
| 1000 zł | 850 zł na Google Search i 150 zł na materiał. | Wstrzymać grupę, jeżeli wyda dwukrotność ustalonego kosztu kwalifikowanego kontaktu i nie da ani jednego. |
| 3000 zł | 1800 zł Search, 600 zł Meta, 400 zł film, 200 zł rezerwa. | Porównywać koszt realnych rozmów i podpisanych zleceń osobno dla kanałów. |

Plan 30/60/90 dni, konkretne słowa i wykluczenia, teksty reklam, partnerstwa, film, prywatność i miary konwersji są w [planie pozyskiwania klientów](marketing-90-dni.md). Właściciel powinien zatwierdzić dane i relację podmiotów REXBID i REX AUTO CARGOLOOP przed twierdzeniami marketingowymi o umowach, odpowiedzialności lub dorobku. Podczas audytu budżet uruchomionych kampanii wyniósł 0 zł.

## Koszty i granice skali

Aktywny plan Apibary to **Pro**. Odczyt dostawcy wykazał 24 371 ze 100 000 zapytań REST. Bieżące konto Cloudflare już obsługuje portal, katalog D1 i R2. Obecne przechowywanie w R2 przy tej samej średniej przez miesiąc kosztowałoby ok. 0,50 USD. Przy utrzymaniu puli operacji pod limitami koszt podstawowy z Apibarą wynosi szacunkowo 75,50 USD/mies. Przy zmierzonym tempie importu i operacji magazynu model dla 100 użytkowników dziennie daje 88,02 USD/mies., dla 1000 również 88,02, dla 10 000 około 89,82, dla 100 000 około 136,95. To scenariusze, bez podatków oraz faktury za domenę i pocztę OVH. Nie kupowano usług ani nie zwiększano płatnych limitów. [Stawki, założenia, wyjątki i kwoty roczne](KOSZTY.md)

Zapas aktywnej bazy to ok. 5,6 GB do wewnętrznego progu. Ograniczeniem oddzielnego uzupełniania zdjęć są operacje zapisu. Na pomiarze pozostawało bezpiecznie 9,62 mln wobec 14,30 mln rezerwy na publikację, przy średnio 1,23 mln rzeczywistych zapisów na dobę w siedmiu poprzednich dniach. Zmniejszanie rezerwy bez oszczędności mogłoby ponownie zatrzymać katalog. Archiwum pozostawić w obecnym R2. Przy 100 tys. sztucznych wpisów trafiony VIN kosztował średnio 2,875 odczytu R2 i zero D1. Przed 500 tys. rzeczywistych wpisów trzeba zastąpić twardo ograniczony indeks wspólny segmentami o stałym maksymalnym rozmiarze i osobnym wyszukiwaniem VIN/LOT. [Próba kosztów archiwum](BEZPIECZENSTWO-AWARIE.md)

## Warunki publikacji i zadania otwarte

Projekt przejścia od dzisiejszego indeksu do 1, 5 i 10 mln rekordów obejmuje wyszukiwanie po VIN i LOT, kolejne aukcje tego samego auta, wycofania zdjęć oraz odwracalne przełączenie. [Projekt i kryteria prób przy wzroście](ARCHIWUM-SKALA.md)

Kod publicznego wydania jest na lokalnej gałęzi `audit/staging-20261124`, commit `2296979`, nad zabezpieczonym stanem produkcyjnego serwisu `db60e5a`. Internetowy GitHub wskazywał starszą rewizję `5c781c7`. W odtworzonej wersji są prywatne taryfy, dlatego kompletny pakiet i historia commitów pozostają w prywatnej kopii lokalnej. Do przekazania przygotowano kopię Git możliwą do zweryfikowania i odtworzenia. Stan odtworzenia zapisano także w punkcie startowym następnego czatu. Obowiązujący cykliczny nadzór zachowuje harmonogram i wymaga oddzielnej zgody na poprawki produkcji.


| Priorytet | Odpowiedzialny i warunek odbioru |
|---|---|
| P1 — kwoty i umowa | Właściciel, broker i agencja rozpisują jedną prawdziwą odprawę oraz osobno aktualne taryfy. Zatwierdzają treść warunków, polityki prywatności i podmiot zawierający umowę. Do tego czasu wycena orientacyjna, z indywidualnym potwierdzeniem. |
| P1 — ciągłość | Zespół po zgodzie na produkcję mierzy dwa pełne cykle po nowej wersji. Porównuje ten sam LOT, VIN, cykl, cenę, czas i galerię ze źródłem. Dwie niewyjaśnione puste galerie oraz koszt jednego uzupełnienia sprawdza osobno. |
| P1 — dostęp klienta | W odizolowanym środowisku kont przejść od prywatnego logowania klienta do odpowiedzi właściciela z MFA, doręczenia maila i otwarcia rozmowy. Bieżący staging publiczny udostępnia tylko odczyt. |
| P2 — jakość danych | Udokumentować kolejne wystawienie tego samego VIN w dwóch rzeczywistych cyklach, odtwarzanie 360° dla obu platform przy dostępnym materiale, obserwację zmiany ceny i auta w świeżej sesji Live obu platform. |
| P2 — pomiary | Zebrać terenowe INP, LCP i CLS, porównać urządzenia fizyczne, powtórzyć test konkurencyjnych wycen, kiedy ich strony udostępnią interaktywną ścieżkę. Śledzić regionalne strony katalogu i uzupełnić linki do wartościowych stron aut bez generowania pustych adresów. |
| P1 — źródło następnych wydań | Publiczny GitHub i działający produkcyjny kod są rozbieżne. Dedykowana lokalna gałąź zawiera zabezpieczony punkt wyjścia, poprawki i dowody. Przed następnym wydaniem uzgodnić prywatne miejsce docelowe dla pełnego kodu, w tym taryf partnerów. |

Wersja stagingu `2fcc6a47-a0f9-4420-bb6b-b199d7d3b5f2`. Produkcja ma osobne identyfikatory pięciu usług. [Wersje, bramki wydania i wycofanie](WYDANIE.md) · [Lista zmienionych plików](ZMIENIONE-PLIKI.txt) · [Gałąź i wynik odbioru](WYNIKI-TESTOW.json)

