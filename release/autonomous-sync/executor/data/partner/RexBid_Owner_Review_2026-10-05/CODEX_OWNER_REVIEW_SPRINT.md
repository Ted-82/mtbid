# REX.BID — OWNER REVIEW: DZIAŁAJĄCY KALKULATOR + SPÓJNY UX + NOWY WYGLĄD

Data ustaleń: 2026-10-05. Jeden sprint integracyjny, bez dokładania nowych przedsięwzięć.

## 0. Co jest celem i co jest źródłem

Właściciel kończy zbieranie uwag na ten etap. Nie może dalej oceniać serwisu, dopóki kalkulator i kategorie nie działają czytelnie. Wykonaj zebrane poprawki w jednym kandydacie stagingowym, a następnie przekaż konkretne linki i dowody działania. Nie przepisuj produktu od początku.

Dokument uzupełnia istniejący `data/partner/RexBid_Calculator_V4_2026-10-04/CODEX_SPRINT_CALCULATOR_V4_UX.md`. Zastępuje jego wcześniejszy kierunek wizualny navy/złoto i hasło „Cena z aukcji to dopiero początek”. NIE zastępuje źródłowych stawek, dowodów routingu, mnożników, dopłaty BEV, zasad podatkowych, ochrony danych ani poprawionego modelu harmonogramu. Rozstrzygnięcia biznesowe właściciela mają pierwszeństwo przed wygenerowanymi hasłami marketingowymi.

Repo kanoniczne: `C:\Users\nowic\Desktop\stona_auta-www`, GitHub `Ted-82/mtbid`. Pracuj na najnowszym zachowanym `public/car.html` z lokalnego working tree. Odczyt GitHub main przy przygotowaniu tego zlecenia: `5c781c7a6db9a8ac3f70aedb638f4543dfce16e0`. Lokalne V4 jest nowsze — NIE resetuj go do main.

Ostatni raport Codexa, nie niezależna kontrola aktualnego runtime: 339/339 testów repo, 14/14 pakietu partnera; staging `4f207454-3c67-457a-9595-1e458818a2ee`. Właściciel później zgłosił problemy poniżej, więc raport PASS nie zastępuje odtworzenia jego ścieżek. Produkcyjna wersja ostatnio zgłoszona: `351ac4e7-2175-4d51-813b-5f85d9527f64`.

### Fakty z przeglądu właściciela

- Home nie pokazuje samochodów; „Zobacz więcej” otwiera katalog z rekordami. Samo to NIE dowodzi błędnego filtra: katalog może zawierać tylko stare oferty. Rozstrzygnij aktualność danych i logikę zapytań osobno.
- „Elektryczne → Zobacz więcej” nie ma czytelnej kontynuacji w katalogu; pozostają stare skróty bez Elektrycznych.
- Kalkulator raz jest niewidoczny mimo odnośnika, a na innym zrzucie widać panel z 25 USD i brakującymi kwotami. To DWA odrębne problemy: render oraz brak użytecznych obliczeń.
- Jasne tło odpowiada właścicielowi. Nadmiar ramek, drobnych tabel i powtarzanych informacji wygląda niemodernie.
- Rozdzielenie aktualnej oferty i Kup teraz zostało ocenione pozytywnie — zachować.
- Długie komunikaty statusu zasłaniają zdjęcia. W kategorii Kup teraz cena na zdjęciu powinna oznaczać właśnie Buy Now, nie myląco niską ofertę licytacyjną.
- Kierunek wizualny: zaakceptowana wizualizacja czerwonej Corvette REX, granat/antracyt/czerwień, jasny katalog i karty. Marka Rex.Bid pozostaje; decyzja domenowa nie zapadła.

Materiały: `references/hero_direction.png`, `references/corvette_original.jpg`, zrzuty aktualnej karty/katalogu oraz porównawcze DreamBid/BidCars/Copart. Manifest opisuje ich przeznaczenie. Grafika hero jest kierunkiem, nie gotowym interfejsem do wklejenia jako obraz.

## 1. Sposób pracy bez krążenia po tym samym audycie

Na początku raz sprawdź HEAD, `git status`, ostatni handoff, konfigurację, źródła stawek i istniejące zmiany V4. Ustal listę konkretnych usterek i kolejność: render i obliczenia → dane/kategorie → warstwa wizualna → całe ścieżki w przeglądarce → staging/raport.

Utrzymuj krótki `docs/V4_OWNER_REVIEW_PROGRESS.md`: zrobione, pliki, ostatni wynik testów, aktywne błędy, budżet requestów, następna czynność, wersja stagingu. Po skróceniu kontekstu czytaj ten plik i lokalny diff — nie zaczynaj po raz kolejny pełnego audytu całej historii. Dopisuj stan po ukończeniu spójnej części, nie po każdym poleceniu.

Nie zmieniaj architektury Sync, nie integruj teraz nowej Apibara Durable Sync Beta, nie konfiguruj domeny/SMTP/produkcji. Testuj celowane regresje w czasie pracy; pełny zestaw na spójnym kandydacie i po poprawkach końcowych. Nie zamieniaj błędnych testów w luźne asercje obecności słowa w HTML.

Zachowaj kopię zastanego WIP lokalnie bez sekretów/cache przed dużą edycją. Nie kasuj plików źródłowych ani `.codex-wrangler-cache/`, nie resetuj working tree, nie commituj i nie pushuj. Nie mieszaj starego załączonego car.html z aktualną wersją w repo.

## 2. Kalkulator: najpierw działanie na zwykłej karcie

### 2A. Napraw niewidoczny panel

Odtwórz: Home/katalog → kliknięcie auta → „Przejdź do kalkulatora”; również bezpośredni URL, odświeżenie i mobilny układ. Sprawdź oba używane adresy `/car` i `/car.html`, ich query, gate V4, allowlist, kolejność skryptów, CSP, ładowanie stawek, lazy initialization, hidden/display, rozmiar kontenera, z-index, sticky panel, anchor ID i błędy synchroniczne. Nie zakładaj root cause z samego zrzutu.

Ma istnieć JEDEN moduł kalkulatora w DOM i jedno działające miejsce docelowe odnośnika. Podstawowe dane auta nie czekają na kalkulator/historię. Brak transport match, brak kursu, brak danych silnika ani błąd modułu nie mogą chować całej sekcji. Błąd ma czytelny lokalny stan; nie nieskończony spinner i nie cichy return. Nie maskuj błędu samym wydłużeniem timeoutu.

### 2B. Doprowadź znane stawki do ekranu

Prześledź rzeczywiste dane: provider/D1 DTO → platforma i plac → normalizacja lokalizacji → matcher 610 lokalizacji → preferowany terminal → wariant → UI. Napraw utracone pola, aliasy i błędną kolejność inicjalizacji. Nie przepisuj parsera ani silnika, gdy usterka dotyczy integracji.

Automatycznie uzupełniaj to, co źródło jednoznacznie podaje. Przy braku/niejednoznaczności lokalizacji pokaż jedno pole wyboru właściwego placu, zawężone platformą; przechowaj ręczne wskazanie jako jawne założenie tej wyceny. Nie losuj po ZIP/mieście, nie dobieraj stawki innej platformy i nie hardkoduj wyjątków pod auta testowe. Dla nieznanej klasy transportowej zapewnij czytelny wybór klasy. Nie wymagaj ręcznego wpisania kwot, które już są w cenniku.

Aktualna oferta / Kup teraz / Własna cena: właściwa kwota i etykieta, tylko dostępne tryby. Zmiana trybu lub założeń natychmiast przelicza wynik bez requestu Apibara. Aktualizacja danych nie nadpisuje własnej ceny. Przełączenie na inne auto nie przenosi poprzedniej wyceny. Nie podpisuj bieżącej oferty jako przewidywanej ceny wygrania aukcji.

### 2C. Zachowaj dokładne reguły partnera

- Terminal preferowany z kolorów, NIE minimum land+sea. Te same terminale w wariantach 4 i 3 aut; alternatywa tylko jako jawna zmiana, nie ukryta optymalizacja.
- Savannah / Elizabeth / Houston / Los Angeles / Indianapolis / Montreal; stare route_1…route_6 tylko wewnętrznie. Terminal wyjściowy nie jest dowodem portu docelowego.
- Mnożnik ×0,8/×1/×1,5/×2 dotyczy TYLKO lądu według klas źródłowych; nie wymyślaj progów Large/Oversized.
- Fracht z tabeli jest na pojazd. Nie dziel przez 3/4 ponownie. Nie zakładaj, że każdy duży pojazd pasuje do załadunku czterech aut.
- Pakowanie potwierdzonego BEV: 150 USD raz na auto w każdym alternatywnym scenariuszu. Nie mnożyć gabarytem, nie dzielić liczbą aut. Nie naliczać jednocześnie obu scenariuszy. HEV/PHEV nie są BEV; ich dopłata pozostaje nierozstrzygnięta, nie udawaj potwierdzonego zera.
- Konflikt Albany/Elizabeth 310/325 izolowany do odpowiednich wierszy. Nie dezaktywuje pozostałych 608 lokalizacji.
- Puste kwoty to null. Jawny brak zastosowania to odrębny stan. Źródła, wersja i data cennika są zachowane.

Minimum liczbowe do potwierdzenia W PRZEGLĄDARCE na prawdziwych komponentach (jawne fixture, gdy brak odpowiedniego live rekordu): bazowy Houston 205+675=880 / 205+850=1055 USD; BEV Houston +150=1030/1205 USD; Portland–Gorham IAAI, Elizabeth 450+575=1025 / 450+650=1100 USD. Wszystko przed dodatkowymi kosztami importu. Dla Camry Hybrid ze zrzutu sprawdź HEV, nie doliczaj automatycznie dopłaty BEV.

### 2D. Przydatny wynik bez fałszywej ceny pod dom

Jeden kompaktowy panel, najlepiej pod aukcją po prawej. Na mobile pod galerią i cenami, przed długimi specyfikacjami. Duża liczba odpowiada rzeczywistemu zakresowi: „Transport”, „Zakup i transport” lub „Szacowany koszt pod dom”. Sama cena auta 25 USD NIE może udawać wyniku importu.

Widok podstawowy: podstawa ceny, wariant, wynik, 4–6 krótkich grup kosztów, jeden komunikat o brakach. Nie powtarzaj kilkunastu wierszy „Do potwierdzenia”. Pod „Szczegóły kalkulacji” pozostają składniki, source, kursy, podstawy, terminal, dopłata BEV, ręczne korekty i niepewności. Użytkownik nie może pomylić subtotalu z pełnym kosztem.

Nie twórz kosztów podatków, prowizji, portu, opłat IAAI ani dostawy PL tylko po to, by uzyskać sumę. Jeśli odpowiednie źródła/profil są już zatwierdzone, wykorzystaj je; inaczej jeden zwięzły brak. Automatyczny transport ma działać niezależnie od niekompletnej wyceny fiskalnej. Przy zmianie logiki podatkowej najpierw zweryfikuj ją w aktualnych urzędowych źródłach; nie przepisuj bezkrytycznie stawek ze screenu BidCars.

Benchmark BidCars: zachowaj osobny raport porównujący te same wejścia i zakres, nie kopię ich taryfy. Honda CR-V LOT 45369972: screenshot aktualnej oferty 1550 USD; aukcja 550; ląd 525; morze 995; suma tych czterech 3620 USD, prowizja 450 osobno. To benchmark, NIE koszty Rex.Bid. Nasz zakup+transport 2575/2650 USD nie zawiera opłaty aukcyjnej ani całego importu. Wynik 25835 PLN ze screenu wymaga pozostałych założeń; nie dopasowuj do niego kwot arbitralnie i nie porównuj go z osobnym trybem prognozy.

## 3. Home i katalog: spójne kategorie oraz aktualne dane

Cztery sekcje Home: Aktualne aukcje, Timed Auction, Kup teraz, Samochody elektryczne. Nadchodzące pozostaje filtrem katalogu. Katalog ma wyraźny skrót „Elektryczne”, prawidłowy aktywny chip oraz URL, który zachowuje filtr po odświeżeniu, przejściu wstecz i paginacji. „Zobacz wszystkie” z EV musi pokazać katalog BEV, nie ogólne 20 aut. Nie klasyfikuj modelu Camry Hybrid jako BEV. HEV/PHEV wykluczaj z tej kategorii, brak napędu nie jest dowodem BEV.

Wspólna reguła kwalifikowania ofert ma działać w Home, katalogu i API; osobno zweryfikuj D1 i provider-backed envelope. Backend filtruje przed paginacją. Nie wybieraj elektryków tylko z pierwszej losowej strony i nie skanuj setek stron, aby zapełnić cztery kafelki.

Odtwórz zgłoszenie: sekcja pusta, a powiązany katalog pełny. Porównaj faktyczne parametry, daty, dostępność i liczbę kwalifikujących się rekordów. Jeśli istnieją poprawne dopasowania, napraw zapytanie/render/cache. Jeśli są tylko stare dane, nie nazywaj tego awarią pobierania i nie usuwaj warunku aktualności, żeby „coś było”. Nie podmieniaj dat na dzisiejsze.

### Świeżość i możliwość oceny

Nie zwiększaj istniejących limitów API, nie włączaj Cron, Durable Sync, discovery/backfill ani nowej kampanii w ramach tego zlecenia. Zachowaj pozostały, wcześniej zatwierdzony limit V4 (20 łącznie z całym QA) oraz liczniki już zużyte — nie zeruj budżetu po wznowieniu kontekstu. Przed live odczytem sprawdź i zapisz pozostały limit. Jeśli jego reszty nie da się ustalić, użyj fixture, nie zakładaj dostępnych kolejnych 20. Błędy, detail/history i automatyczne fallbacki też kosztują requesty. Nie uruchamiaj nowego provider-backed Home wielokrotnie bez licznika.

Dla powtarzalnego przeglądu przygotuj oddzielny staging-only ekran `/__staging/owner-review` (lub odpowiednik zgodny z repo) wykorzystujący TE SAME komponenty i zapisane fixture: zwykłe auto, Buy Now, BEV, HEV, bez terminu, brak stawki. Widoczna etykieta „Podgląd testowy — nieaktualne/syntetyczne oferty”. Bez wyjścia do providera, bez zapisu do katalogu, bez obchodzenia Auth. Twardy gate dokładnego hosta i flagi, produkcja 404. Dane testowe nie trafiają do normalnego Home ani wyników wyszukiwania.

To służy ocenie wyglądu i rachunków, NIE dowodzi świeżości rzeczywistego rynku. Oddzielnie sprawdź zwykłą kartę/katalog z dostępnymi prawdziwymi danymi. Nie nazywaj pustego Home dowodem gotowości treści. Jeśli konieczne jest nowe, niezatwierdzone odświeżenie, przygotuj jeden mały, policzony plan/czynność do akceptacji; brak tej zgody blokuje tylko live odświeżenie, nie cały UX i lokalne QA. Nie proś o serię kliknięć po dwie strony.

## 4. Ceny, miniatury i harmonogram

Miniatury: czyste duże zdjęcie. Usuń rozbudowane statusy, VIN, platformę i datę z nakładek; przenieś potrzebne informacje pod zdjęcie. Jedyna nakładka informacyjna to małe czytelne pole ceny z krótką etykietą. Kontrolka obserwowania może być dyskretna i nie zasłaniać auta.

- Kategoria Kup teraz: „Kup teraz: 800 USD” dla Camry, NIE dominujące „25 USD” jako sugerowany szybki zakup.
- Zwykła licytacja: „Oferta: …” tylko dla rzeczywiście aktualnej oferty; nie podstawiaj kwoty historycznej.
- Nieznana lub niepotwierdzona aktualna kwota: bez zmyślonego zera; stan opisany pod zdjęciem.

Usunięcie napisu „Termin minął · wynik do potwierdzenia” z fotografii NIE usuwa faktu niepewności. Cena Buy Now z starego rekordu nie dowodzi aktywności opcji. Zarazem sam miniony termin nie dowodzi, że opcja na pewno nie istnieje — użyj aktualnej semantyki źródła; nie mieszaj stanu harmonogramu z dostępnością zakupu. Nie pokazuj jako pewnego zakupu czegoś, czego aktualności nie potwierdzono.

Zachowaj duże, spójne bloki Aktualna oferta / Kup teraz na karcie i przyciski „Policz dla tej ceny”; nie udawaj złożenia zlecenia licytacji, którego backend nie obsługuje.

Utrzymaj poprawiony model schedule: świeże explicit unassigned usuwa stary pomocniczy termin; samo null nie kasuje prawidłowych danych; date-only bez wymyślonej godziny; countdown wyłącznie z potwierdzonego czasu i strefy; koniec odliczania nie dowodzi sprzedania. Copart Upcoming unassigned != każda przyszła aukcja IAAI. LOT 58307896 to historyczny przypadek regresyjny, a nie status do hardkodowania na zawsze. Testuj spójność Home/list/karta, relisting, cache i przejście z unassigned do scheduled.

## 5. Nowy wygląd i hero — implementacja, nie poster

Kierunek: granat/antracyt, czerwień Corvette i biel. Jasne tło katalogu, jasne karty i kalkulator. Czerwone akcenty zastępują brandingowe złoto; kolory semantyczne błędu/ostrzeżenia/sukcesu pozostają odrębne. Wspólne tokeny kolorów, typografii, odstępów, ramek i przycisków, zamiast kolejnych nakładanych bloków CSS. Usuń konfliktujące przestarzałe reguły po sprawdzeniu użyć. Nie ukrywaj całych sekcji w celu pozornego uproszczenia.

Hasło Home:
**Wybierz wymarzony pojazd. My zajmiemy się resztą.**
Podtytuł:
**Aukcje w USA, transport i formalności — z naszym wsparciem na każdym etapie.**
Nie dodawaj twierdzeń o setkach klientów, gwarancji ceny, „bez ukrytych opłat”, zniżkach ani legalności rejestracji bez podstaw. Wygenerowane takie napisy z referencji NIE są zatwierdzonymi faktami.

Wizualizacja `hero_direction.png` jest wzorem kompozycji/koloru. NIE wstawiaj całego obrazu z wypalonym logo, nawigacją, przyciskami i napisami jako gotowego hero ani tła pod kolejną warstwę takich samych tekstów. Obraz auta/tła, prawdziwe logo, H1, opis, CTA i wyszukiwarka muszą być oddzielnymi warstwami. Bez angielskiego sloganu jako wymogu. Zachowaj markę Rex.Bid, zaproponuj spójne skalowalne logo w bieli/czerwieni na podstawie referencji, nie zmieniaj domeny ani technicznych nazw usług.

Źródło auta: `corvette_original.jpg`; usuń inne pojazdy/tło przy przygotowaniu assetu i zachowaj rozpoznawalny samochód. Tablica pokazuje REX z paskiem PL. Nie zamieniaj go na przypadkowe auto stockowe. Użyj rzeczywistych narzędzi graficznych, jeśli dostępne; nie opisuj nieistniejącego wycięcia jako wykonanego. Gdy koniecznego assetu nie da się przygotować dostępnym narzędziem, zgłoś precyzyjnie brakujący plik i domknij niezależną resztę; nie twórz fikcyjnego placeholdera udającego zatwierdzoną grafikę.

Hero kompaktowe: wyszukiwarka i początek ofert szybko dostępne. Desktop: tekst i wyszukiwanie po lewej, auto po prawej; mobile: czytelny tekst, CTA/wyszukiwanie i odpowiedni kadr, bez zasłaniania. Rzeczywiste responsywne obrazy WebP/AVIF lub inne zgodne z repo, rozmiary zależne od ekranu, zdefiniowane wymiary, rozsądna waga; nie ładuj wielomegabajtowego PNG na każdy telefon.

Katalog jak nowoczesne ogłoszenia: duże zdjęcie, nazwa i 1–2 linie kluczowych danych. Rocznik/platforma/lokalizacja nie powtarzają się w pięciu komórkach. Zależnie od miejsca 3–4 kolumny desktop, 2 tablet, 1–2 czytelne na mobile. Bez narzuconych sześciu kolumn kosztem mikroskopijnego tekstu. To inspiracja hierarchią DreamBid, nie kopia ich kodu, znaków ani treści.

Karta: galeria i czytelne ceny dominują, kalkulator tuż obok/pod cenami; specyfikacje w krótkich grupach, mniej pełnych ramek; historia zwarta, ewentualny scroll tylko lokalny tabeli. Przy 100% zoom nie zmniejszaj fontu, aby wszystko weszło na jeden ekran. Orientacyjnie zwykły tekst 14–16px, liczby cen większe, dotykowe kontrolki wygodne. Sticky menu/panel nie zasłania tytułu, kalkulatora ani końca formularza.

## 6. Sprzedawca i dokument

Jeden nowoczesny blok „Sprzedawca i dokument”. Nazwa tylko ze źródła; przy samym typie np. „Ubezpieczyciel”, bez „Nazwa niedostępna · Insurance”. Bez fikcyjnych odznak verified i rekomendacji.

Oryginalny TITLE, stan dokumentu, uwagi/brand i Title Pending odrębnie od stanu placu oraz fazy aukcji. Nie rób zielonej gwarancji rejestracji w Polsce z samego słowa Salvage. Zwięzłe polskie objaśnienie nie zastępuje dokumentu ani pewnej kwalifikacji. Link „Pokaż dokument” tylko jeśli jest rzeczywisty dokument/URL. Usuń powtarzanie tych samych danych w kilku dużych sekcjach.

## 7. QA kończące się dowodem działania, nie samym 200

Użyj prawdziwej przeglądarki/Playwright zgodnie z dostępnymi narzędziami. Co najmniej desktop 1440×900, mobile 390×844 i 360px, 100% zoom. Emulowany viewport to test responsywności, nie certyfikat działania na każdym telefonie. Testy przez kliknięcia z Home/katalogu, nie tylko bezpośredni URL lub ręczne wywołanie funkcji w konsoli.

Sprawdź: bez sesji; wolniejszy fetch; moduł niedostępny; odświeżenie; back/forward; /car i /car.html; CSP i cache po nowym deployu; jedno auto z oboma cenami; znany transport; BEV; HEV; brak dopasowania; unassigned i confirmed future; galeria/lightbox/history/favorites; cały ekran kalkulatora wraz z końcem szczegółów. Testuj prawdziwe skrypty/HTML; atrapa nie może dostarczać metody, której produkcyjny klient nie eksportuje.

Wiersz akceptacji ma zawierać: wejście, kroki, oczekiwany wynik, dowód, rodzaj danych LIVE / zapisane źródłowe / syntetyczne. Screenshots nie zastępują asercji kwot i stanu filtra, a liczba testów nie zastępuje widoczności DOM i możliwości kliknięcia.

### Obowiązkowe kryteria odbioru

1. Katalog → auto → kalkulator: jeden widoczny panel; anchor trafia w jego początek na obu szerokościach.
2. Znana lokalizacja: UI rzeczywiście wyświetla ląd, morze i ich sumę; nie same „do potwierdzenia”.
3. BEV Houston: 1030/1205 USD transportu przy opisanej klasie/scenariuszu; dopłata dokładnie raz. HEV nie staje się BEV.
4. Kup teraz: widoczna odpowiednia cena na kafelku i karcie; klik „Policz” zmienia podstawę, własna cena przetrwa odświeżenie danych.
5. EV Home → „Zobacz wszystkie” → kolejne strony/back/refresh: aktywny filtr Elektryczne i same BEV, albo uczciwy brak dopasowań; nie ogólne 20 aut.
6. Home z dopasowanymi danymi: sekcje pokazują kafelki; dane stare/puste nie stają się fikcyjnie aktualne. Preview testowy wyraźnie oddzielony od live.
7. Zdjęcia bez długich nakładek statusu; prawdziwa semantyka ceny/statusu zachowana pod zdjęciem i w dostępności kategorii.
8. Nowe hasło, granat/czerwień/jasne karty i układ niebędący jednym obrazkiem; brak fałszywych twierdzeń marketingowych.
9. Seller/TITLE uporządkowany, poprawione terminy nie cofnięte, galeria/history/local favorites bez regresji.
10. Desktop/mobile: brak poziomego overflow strony, działające menu/filtry/CTA/kalkulator, nic istotnego nie jest schowane pod sticky panelem.

## 8. Wdrożenie, źródła i zakończenie

Dozwolony deploy WYŁĄCZNIE `rexbid-auth-test`, dokładny host `rexbid-auth-test.tedn828.workers.dev`, D1 `rexbid-auth-test-db` / `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Bez produkcyjnego `mtbid`/`rexbid-db`, migracji produkcyjnych, zmiany ich flag/budżetów. Nie kupuj domeny ani usług. Nie włączaj produkcyjnego Auth/D1-first/Cron. Nie ma potrzeby nowych migracji do samej korekty UI; ewentualną konieczność zgłoś jako oddzielną decyzję.

Przed deployem pełne `node --test`, testy pakietu partnera, oba właściwe generatory `--check`, walidator konfiguracji, składnia i CRLF-aware diff-check. Następnie przeglądarka na FAKTYCZNIE nowej wersji. Zachowaj istniejące gate'y i brak staging debug w produkcji. Artefakty referencyjne, prywatne zdjęcia ekranu, źródła i pełne cenniki nie są automatycznie publikowane jako assets. Do public/ trafiają wyłącznie potrzebne, świadomie przygotowane zasoby.

Cennik pozostaje jeden, wersjonowany: dane → walidacja → diff → generator → test → akceptacja. Utrzymaj instrukcję zmiany jednej kwoty, preferencji, mnożnika i dopłaty EV bez edycji algorytmu. Nie nazywaj zmiany samego XLSX aktualizacją strony, jeśli importer czyta CSV. Nie usuń audytu konfliktów.

Raport ma być krótki: lista wdrożonych uwag właściciela, Version ID, konkretne linki (Home, katalog BEV, znany transport, Buy Now, BEV preview), screenshoty przed/po desktop/mobile, 3 kontrolne rachunki, wynik kryteriów powyżej, requesty i ich źródło licznika, testy, zmienione pliki, maksymalnie 3 rzeczy wymagające potwierdzenia partnera. Zaktualizuj PROJECT_HANDOFF/ROADMAP i dziennik sprintu, oddzielając dane historyczne, obecne, live i testowe.

Nie nazywaj całości READY tylko dlatego, że HTTP=200 lub testy przechodzą. Nie odsyłaj właściciela do wyłącznie pustego Home i karty bez kosztów. Jeżeli czegoś nie można potwierdzić, nazwij konkretnie co, bez zgadywania; nie zatrzymuj niezależnych poprawek. Na koniec kandydat do oceny i osobnej zgody na publikację. Bez commitu/pusha/production deployu w tym zadaniu.
