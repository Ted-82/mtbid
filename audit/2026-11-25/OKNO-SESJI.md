# Przyjęcie na kopii. Terminy po przełożeniu aukcji IAAI

25 listopada 2026. Godziny w raporcie podano dla Warszawy. Decyzja o wdrożeniu tej zmiany na rexbid.pl pozostaje po stronie właściciela.

## Co zobaczył klient

Na produkcji w filtrze „Okno sesji” pojawiły się trzy auta IAAI z pustym terminem. W mobilnym Chrome karta Forda F-250, LOT 45516116, VIN 1FTNX21S11EA69796, wyświetlała „Termin nieustalony”. W oryginale paczki 23864 znajduje się zmiana 120217745 odczytana 25 listopada o 08:22:26. Apibara przełożyła aukcję tego Forda na **3 grudnia 2026 o 06:30 czasu polskiego**. W kontrolnej próbie już po kolejnym pełnym cyklu Ford nadal trafiał do filtra trwających sesji. Dla Nissanów 46499174 i 46570801 przejrzano 24 zachowane pliki z przerwami w pokryciu. Termin i bieżąca licytacja obu pozostają niepotwierdzone. [Porównanie po LOT](../../../ongoing-quality-20261123/iaai-three-lots-source-20261125T0828Z.json)

Na kopii pracującej z kodem produkcyjnym wykonawca zapisał nową datę Forda, zachowując starą fazę sesji. Przy odczycie ta faza ukrywała datę. W osobnej próbie sam komunikat o przejściu do Live mógł wyczyścić prawidłowy początek sesji albo przyszły termin zakończenia Timed. Drugi przypadek odtworzono w teście. [Dowody przyczyn](../../../ongoing-quality-20261123/live-session-diagnosis-20261125T0828Z.json)

## Co zmieniono na odizolowanej kopii

| Obszar | Wynik |
|---|---|
| Przekładanie aukcji | Wykonawca rozpoznaje jednoznaczne przełożenie zwykłej aukcji IAAI. Uwzględnia tożsamość wystawienia, nową datę i stan. Przy jednoznacznej zmianie samego statusu zachowuje właściwy termin tej sesji lub aktywny koniec Timed. |
| Filtr „Okno sesji” | Zwykła aukcja musi mieć ustaloną godzinę i mieścić się w oknie sesji. Lista i karta rozróżniają przyszłą sesję, aktywne okno, oczekiwanie na wynik i niepełne dane. Faktyczna licytacja konkretnego auta nadal wymaga świeżej obserwacji toru. |
| Sortowanie i odczyty | Kontrolka pokazuje kolejność zwróconą przez serwer. Po wybraniu platformy baza korzysta z istniejącego indeksu przeznaczonego dla sesji. Nie ma migracji, nowego indeksu ani dodatkowego wywołania Apibary. Wcześniejszy pojedynczy HTTP 503 nie ma potwierdzonej przyczyny. |
| Starsze zapisane aukcje | W Chrome 390 × 844 po lokalnym zastosowaniu oryginału Ford pojawił się na zwykłej liście i karcie z terminem 3 grudnia o 06:30. Zniknął z filtra „Okno sesji”. Pozostała w nim kontrolna aukcja, której sesja trwała. Sprawdzono ponowienie na dawnym niespójnym rekordzie i brak dalszego zapisu przy trzecim zastosowaniu. [Ścieżka w Chrome](../../../ongoing-quality-20261123/operator-browser-combined-20261125T0828Z.json) |

Przed wydaniem sprawdzono produkcyjną ścieżkę od listy, przez zdjęcia, do wyceny i formularza, bez wysyłania zapytania. W trzech listach załadowano po 40 unikalnych ofert po użyciu „Pokaż więcej”. Fizycznego telefonu w tej kontroli zastąpił mobilny Chrome. Próby panelu klienta i właściciela obejmowały 159 testów i 21 sprawdzeń przeglądarkowych na koncie symulowanym. [Kontrola telefonu](../../../ongoing-quality-20261123/mobile-paths-20261125T0828Z.json) · [Panele i role](../../../ongoing-quality-20261123/portal-roles-20261125T0828Z.json)

## Wyniki odbioru

| Zakres | Przed | Po połączeniu zmian |
|---|---:|---:|
| Pełny zestaw strony | 2727/2727 | 2730/2730 |
| Pełny zestaw wykonawcy | 810/810 | 813/813 |

Pierwsze wspólne uruchomienie strony wykryło brak nowego identyfikatora wersji skryptu w pamięci podręcznej oraz aktualizację układu całej listy przy samej zmianie opisu sortowania. Po korekcie przeszły wszystkie testy, następnie powtórzono ścieżkę Forda w Chrome. Gałąź strony `qa/session-window-20261125`, kod `8d71a7c`. Gałąź źródeł zmian wykonawcy `qa/session-importer-20261125`, kod `9e49f96`. Wersja strony skompilowała się lokalnie, rozmiar przesyłanego kodu po gzip wyniósł 198,88 KiB. [Pełny test wykonawcy](../../../ongoing-quality-20261123/operator-full-regression-20261125T0828Z/final-proof.json)

Na 375 000 sztucznych wierszy z definicjami indeksów z kopii produkcji zbadano pięć powtórzeń po rozgrzaniu każdego zapytania. Końcowy kod przy pustej stronie Copart (20 ofert na stronę) obniżył medianę lokalnego zapytania z 1647 do 1,49 ms. Przy pełnej pierwszej stronie IAAI mediana spadła z 466 do 0,60 ms. W obu wariantach otrzymano te same identyfikatory ofert. Czasy obejmują tylko SQLite na komputerze, zależą od jego obciążenia i nie mierzą zdalnej D1 ani czasu ładowania strony. [Dane i plany wykonania](../../../ongoing-quality-20261123/session-window-final-benchmark-20261125T0828Z.json)

## Co działa w produkcji

O 09:47 historia Audi S5 IAAI 46410658 pokazała **ostatnią ofertę 12 700 USD, odczytaną o 01:42:43**, oraz osobno potwierdzony przez dostawcę wynik za tę samą kwotę z datą 24 listopada. Dokładna godzina sprzedaży jest nieznana. O 09:56:40 katalog potwierdził następną pełną publikację do 120507925, po wcześniejszej 120382903. Przyrost 125 022 dotyczy pozycji globalnego kursora. Numer generacji tej dostawy oraz aktualny budżet konta wymagają prywatnego odczytu. Wrangler wcześniej przyjął logowanie o 07:55, lecz obecna próba odczytu prywatnego zakończyła się błędem autoryzacji. [Historia Audi](../../../ongoing-quality-20261123/audi-current-20261125T0828Z.json) · [Produkcja przed i po publikacji](../../../ongoing-quality-20261123/publication-next-20261125T0828Z.json)

## Wydanie i powrót

1. Po zgodzie właściciela odczytać bieżące aktywne wersje strony i wykonawcy. Jeśli od tego pomiaru się zmieniły, nałożyć poprawki na bieżący kod i powtórzyć testy. Poprzednik strony w tym pomiarze to 5ea24dd5-9f45-4810-9d6d-5c4fc25af985, a wykonawcy 3e03ecf9-cf36-417a-8875-598ae1877991.
2. Przed zapisem sprawdzić punkt odtworzenia D1, późniejsze zdarzenia tego Forda, członkostwo w aktywnym katalogu, stan i czas modyfikacji wiersza. Zachować kopię wiersza i historii. Gdy nowsza informacja jest sprzeczna, zastosować nowszy potwierdzony stan. Wydanie samego kodu nie zmieni wcześniej zapisanego Forda.
3. Stronę oraz wykonawcę wdrażać osobno. Dla wykonawcy użyć odtworzonego artefaktu dołączonego do testów. W dwóch czystych kompilacjach otrzymano SHA-256 `3fd0894fac10534f409cf359fd522823b530b7a3f5f7bedad054d4496d238dee`. Starszy katalog źródeł wykonawcy z gałęzi strony nie zawiera wszystkich poprawek cen Audi. [Kontrola kompilacji](../../../ongoing-quality-20261123/operator-full-regression-20261125T0828Z/offline-build-proof.json)
4. Dla tego Forda uzgodnić wyłącznie potwierdzoną zmianę na aktualnym wierszu, z warunkiem chroniącym równoczesne aktualizacje. Pozostawić główny kursor i harmonogram na bieżącej pozycji. Zweryfikować dokładny VIN i LOT na liście, karcie i w filtrze sesji. Sprawdzić również Audi i następną automatyczną publikację.
5. Jeśli pojawi się regresja, wrócić osobno do zarejestrowanej poprzedniej wersji odpowiedniego Workera. Ewentualna naprawa wiersza po przełączeniu wymaga uwzględnienia późniejszych zdarzeń. Nie przywracać całej bazy wstecz do starszej paczki.
