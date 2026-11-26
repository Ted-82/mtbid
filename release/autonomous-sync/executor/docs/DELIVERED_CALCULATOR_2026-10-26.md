# Uproszczona wycena z dostawą — 26.10.2026

## Zakres i źródła

Właściciel zlecił własny widok REXBID wzorowany funkcjonalnie na ośmiu przekazanych zrzutach BidCars oraz prostą cenę pod dom. Zrzuty są dowodem porównawczym, nie oficjalną taryfą aukcyjną ani rozstrzygnięciem podatkowym. Zachowano poprzedni kalkulator i jego testy jako fallback; nowy widok jest głównym na karcie auta przy istniejącej fladze V4. Nie pokazuje pojemności kontenerów, liczby aut ani mnożników.

Nowe moduły: `rexbid-delivered-rates.js`, `rexbid-delivered-cost.js`, `rexbid-delivered-view.js/.css`. Ekran: kwota zakupu, wynik PLN, miejsce dostawy, kontakt i trzy zamknięte sekcje: zakup/transport, odprawa/podatki, dostawa/usługi. Stawki są oddzielone od interfejsu. Kontakt przenosi wynik jako szacunkową wycenę, osobno od budżetu wpisywanego przez klienta.

## Obliczenia i porównanie

Przy kursach referencyjnych USD3,9247/EUR4,3917, dostawie Poznań2300PLN, tłumaczeniu260PLN, ładunku niebezpiecznym100USD oraz jawnie zerowej akcyzie wszystkie sześć wyników odpowiada przykładom z dokładnością2PLN przed rabatem. Rabat250PLN pomniejsza własną usługę brutto i nie zmienia cła ani podatków.

| Zakup USD | Zrzut Copart PLN | REXBID około PLN | Zrzut IAAI PLN | REXBID około PLN |
|---:|---:|---:|---:|---:|
|5000|45795|45545|44907|44657|
|15000|99521|99271|98633|98383|
|25000|154892|154642|154004|153754|

Porównanie obowiązuje dla identycznych założeń i historycznych kursów, nie oznacza gwarancji stałej różnicy względem bieżącego konkurenta. Produkcja pobiera aktualną tabelę NBP. Przykład produkcyjny IAAI15000USD, Sayreville, PHEV1300 z potwierdzonym zwolnieniem, Poznań, kursy26.10 USD3,9293/EUR4,4026: **98498PLN** po rabacie.

- Copart: publiczny profil Preferred/non-clean/secured/Live, progi i dopłaty z oficjalnej tabeli; zastosowanie do konkretnego konta wymaga potwierdzenia.
- IAAI: model szacunkowy oparty na dostarczonych przykładach (Copart+40USD) tylko5000–25000USD; poza zakresem wymagana kwota opłat, brak nie oznacza0.
- Transport: istniejąca tabela lokalizacji plus wskazane przykłady TampaSouth485USD i Sayreville275USD, standardowy fracht995USD. Nieznane lokalizacje, Kanada i jawne duże klasy wymagają kwot indywidualnych.
- Dostawa: Poznań2300PLN, Śląskie2500PLN, inny adres do wyceny. To przyjęte stawki szacunkowe, nie potwierdzona umowa przewozu.
- Rotterdam: scenariusz cło10%/VAT21%, agencja i rozładunek500EUR. Prowizja450USD netto z VAT23%. Pochodzenie/klasyfikacja i faktyczne podstawy odprawy wymagają weryfikacji.
- Akcyza jest oddzielna; zero ze zrzutów nie stało się domyślnym zerem. HEV≤2000cm³ ma1,55%, także w legacy; PHEV≤2000 wymaga potwierdzenia zwolnienia, obowiązującego w modelu do końca2029. Ogólne `Hybrid` nie rozstrzyga HEV/PHEV. Brak pojemności/kwalifikacji daje wynik częściowy.
- Naprawy, dostosowanie, rejestracja i nieustalone opłaty wyjątkowe są poza standardowym zakresem.

Źródła oficjalne i daty, pełna arytmetyka, hashe zrzutów: `Documents/Codex/REXBID_CALCULATOR_20261026/{reference-math,fee-research}.json`. Kursy: https://api.nbp.pl/api/exchangerates/tables/A/?format=json .

## Kontrole

Pełna suite1581/1581 PASS; testy obejmują sześć przykładów, granice taryf, brakujące wartości, rabat jednokrotny, podatki, sanitizację, aktualizacje ceny bez nadpisania wartości własnej, datę archiwum, FX i kontekst kontaktu. Publiczne HTTP15/15 PASS. Browser: staging i produkcyjna karta IAAI45870928, cena własna, napęd, sekcje, wynik, przekazanie do kontaktu; szerokość390px bez przepełnienia poziomego. Brak błędów konsoli. To test responsywnego widoku, nie fizycznego wielodotyku iPhone.

NBP: timeout8s, rozmiar64KiB, walidacja walut/daty, cache6h, błąd503 bez fikcyjnego kursu. Naprawiono nieobsługiwane przez Workers `redirect:error` na `manual` z odrzuceniem każdego nie200. Logi wyłącznie kody diagnostyczne. CSS kalkulatora nie używa globalnych tagów nagłówka/stopki strony.

## Wdrożenie i wycofanie

Wersje ostateczne są w górnym wpisie `PROJECT_HANDOFF.md` i logach `REXBID_CALCULATOR_20261026/deploy-*.log`. Stan poprzedniej produkcji:16f53cbb-525f-46a4-8693-756bf1347f3e. Wycofanie Workerem do tej wersji nie cofa zapisanych ofert. UI można wycofać oddzielnym wydaniem do zachowanego V4; nie zmieniać w tym celu danych aukcyjnych ani kont.

Brak nowego abonamentu, zmian DNS, sekretów, ról lub retencji. Portal pozostaje `portal-no-files`; załączniki i automatyczne e-maile wyłączone. Dwukontowy E2E właściciela i fizyczny iPhone pozostają odłożone.

## Równoległy katalog — nie oznaczać jako ukończony rynek

Pobrano początkowe7451stron/148961rekordów z czterech zakresów Copart+IAAI Open/Live,7484próby HTTP. To zmieniający się strumień stron, nie gwarancja unikalnego pełnego snapshotu. Ostatni odczyt Basic:7610/30000 wykorzystane,22390pozostało. Pro nadal oczekuje na potwierdzenie zakupu; niczego nie zakupiono.

Import D1 jest osobnym trwałym procesem. Kopie obu baz DPAPI/restore zachowane w `private-backups/rexbid/inventory-before-20261026`. Chronione kursory, atomowe paczki, lokalny dziennik i odczyt po zapisie zapobiegają powtórzeniu nieznanych transakcji. Zmiany identyfikatora LOT dopuszczone wyłącznie przy tym samym potwierdzonym pełnym VIN; nie nadpisuje się historii.

Jedna transakcja timeout okazała się zatwierdzona:60/60odczytów zgodnych i finalne kursory. Nowa `reconcileCommitted` wymaga dowodu, SHA i związania z rezerwacją; nalicza pełny koszt konserwatywnie, bez replay. Czasowe limity GraphQL dotyczą odczytów analityki, nie wyczerpania płatnego D1. Wrapper ogranicza ich częstość i nie pisze bez rozstrzygniętego budżetu.

Następnie: dokończyć import od trwałych kursorów, odczyt liczebności/tożsamości/duplikatów, porównać chronione tabele i wszystkie wcześniejsze zdarzenia, uruchomić catch-up od checkpoint36461474, dopiero potem ocenić kompletność. Mechanizm zmian jest przetestowany i wdrożony, ale jego zadanie stream nie zostało jeszcze zasiane. Aktualizacji wszystkich ofert co15min ani licytacji przez REXBID nie deklarować.
