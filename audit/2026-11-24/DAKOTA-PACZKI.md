# Dodge Dakota, Copart 65917836

**Apibara przekazała nowy termin w paczce 23248, w zdarzeniu `auction.rescheduled` o numerze 118299636.** VIN to `1B7GG32X82S697320`. Dostawca przeniósł początek sesji z 24 listopada, godz. 18.00, na **1 grudnia 2026, godz. 03.00 czasu polskiego**. W tym samym zdarzeniu włączył Kup teraz z ceną 468 USD.

| Zdarzenie z 24 listopada | Czas polski | Co wynika z odczytu |
|---|---|---|
| Paczka 23226, sekwencja 118077155 | 18.13.50 | Źródło zgłosiło zakończenie poprzedniego cyklu, 225 USD, `Sold on Approval`. Późniejszy odczyt historii wskazywał `Not Sold` i 225 USD. Kwota nie dowodzi sprzedaży. |
| Paczka 23248, sekwencja 118299636 | 19.01.57 | Czas zapisania zdarzenia zmiany terminu przez źródło. Pole `after["auction.auction_at"]` zawiera `2026-12-01T02:00:00+00:00`, a `after["auction.upcoming"]` wynosi 1. |
| Odebranie paczki 23248 przez REXBID | 19.05.55 | Automat odnotował generację obejmującą sekwencje 118174500–118318554. |
| Ukończenie publikacji paczki 23248 według rejestru importu | 19.22.45 | Wyszukiwanie nadal później pomijało to auto. Rejestr paczek nie potwierdza aktualizacji konkretnej karty. |
| Paczka 23271, sekwencja 118318605 | 19.04.06 w źródle, paczka ukończona 19.52.21 | Dostawca wyczyścił na bieżącym cyklu dawne pola wyniku i kwoty 225 USD. |
| Kontrola bazy i wyszukiwania | 20.55–20.58 | W aktywnej bazie data nadal była pusta. Publiczne wyszukiwanie pełnego VIN zwróciło pustą listę. Szczegóły Apibary wskazywały nowy termin. |

Odczyt objął partycję 72 ze 128 w każdej z siedmiu kolejnych ukończonych generacji 23178, 23201, 23226, 23248, 23271, 23293 i 23316. Wszystkie zdarzenia dla pary Copart i ten LOT trafiają do tej samej partycji. Sprawdzono skróty manifestów względem D1, sumy SHA-256 fragmentów i liczbę wierszy. Sprawdzono także klucz partycji każdego wiersza. Łącznie 7 118 wierszy, 8 zdarzeń tego auta, 89 odczytów obiektów R2, 29 461 147 bajtów odczytanych z odpowiedzi R2 oraz 628 skanowanych wierszy D1 w zapytaniu o paczki. Generacja 23338 była jeszcze w trakcie zapisu i została wyłączona z tych liczb. W dowodzie JSON pole `published` jest czasem ostatniej zmiany w rejestrze. Oznacza ukończenie wyłącznie w wierszach ze statusem `complete`.

W źródle wystarczają dane do wykrycia przełożenia i skierowania konkretnego auta do ponownego potwierdzenia. Rozbieżność wystąpiła po stronie publikacji REXBID. Weryfikacja obejmuje ten konkretny przypadek i przedział odczytu. Daty z rejestru zmian, z pełnego rekordu i z historii wyniku są oddzielnymi informacjami.

Dowody znajdują się w [DAKOTA-PACZKI.json](./DAKOTA-PACZKI.json) i [powtorne-wystawienie-dowod.json](./powtorne-wystawienie-dowod.json). W JSON czasy mają jawny offset. Brak `record` oznacza, że dostawca wysłał przyrostową zmianę pól.

## Sprawdzenie zasięgu błędu

Oryginalny plik 23248 w R2 miał 5 549 537 bajtów. Przy osobnym odczycie jego SHA-256 zgodził się z D1. Zawierał 144 000 zmian, w tym 5 417 zdarzeń przełożenia aukcji. W 5 404 z nich termin był późniejszy od czasu rejestracji zdarzenia. Wszystkie te zmiany przyszły bez pełnej karty pojazdu. Są to liczby zdarzeń w jednym pliku.

Sprawdzono wszystkie **35 różnych pojazdów** z takim zdarzeniem w partycji 72. Partycja została wybrana ze względu na Dodge’a. To próba diagnostyczna z jednej paczki. Identyczność każdego pojazdu w pełnej odpowiedzi dostawcy sprawdzono na podstawie platformy, numeru LOT i VIN łącznie. Zapytania do katalogu i członkostwa D1 korzystały z indeksów. Łącznie 694 odczytane wiersze D1 w drugim pomiarze, w tym odczyt małej tabeli metadanych generacji. Zużyto 1 odczyt obiektu R2 dla oryginału. Łączne sprawdzenie próbki u dostawcy wymagało 39 zapytań z obecnej puli Pro, w tym trzy poprawne weryfikacje po VIN i powtórzenie jednej odpowiedzi z kolizją numeru LOT. Wszystkie porównania przeprowadzono w ciągu kilku minut, odczyty nie tworzą wspólnej transakcji między systemami.

| Stan potwierdzony u dostawcy i w REXBID | Liczba pojazdów |
|---|---:|
| Otwarta oferta z przyszłym terminem, lokalnie nieaktywna | 10 |
| Otwarta oferta z przyszłym terminem, brak lokalnego rekordu | 2 |
| Otwarta oferta z datą zgodną między bieżącym REST i aktywną bazą | 21 |
| Zakończona u dostawcy, lokalnie nieaktywna lub pominięta | 2 |

**Wszystkie 12 brakujących ofert (9 IAAI i 3 Copart) zwróciło pustą listę przy wyszukiwaniu po VIN na rexbid.pl.** Dwie kontrole dodatnie wybrane z grupy 21, po jednej z każdego domu aukcyjnego, zwróciły po jednym pojeździe o właściwej tożsamości. Wszystkie 14 odpowiedzi miało HTTP 200. Wykonano odczyty publicznej wyszukiwarki z oznaczeniem ruchu testowego.

W 11 z 21 poprawnych aktywnych ofert godzina w pierwotnej zmianie różniła się o dwie godziny od późniejszego pełnego rekordu dostawcy. Lokalna godzina zgadzała się z pełnym rekordem. W trzech odczytach szczegółów po numerze LOT odpowiedź zwróciła pojazd z drugiej platformy, mimo filtra `platform=iaai`. W tych trzech przypadkach API wyszukane po VIN zwróciło zgodne IAAI, LOT i VIN. Wdrożenie powinno sprawdzać tożsamość w każdej odpowiedzi i potwierdzać aktualny stan, zanim zmieni ofertę. Parametry identyfikatora opisuje [specyfikacja dostawcy](https://apibara.tech/openapi/v1.json).

Listę z VIN, numerami LOT i zmianami zawiera [porównanie R2 i D1](./DAKOTA-PACZKI-PROBA.json), bieżące statusy zawiera [próba 35 odpowiedzi Apibary](./DAKOTA-PACZKI-KONTROLA.json), a wyniki klienta zawiera [próba publicznego wyszukiwania](./DAKOTA-PACZKI-WYSZUKIWANIE.json).

## Odzyskanie pominiętych ofert

1. Na stagingu odtworzyć ścieżkę operującą na oryginalnym `auction.rescheduled` po zakończeniu poprzedniego cyklu. Sprawdzić również otwarte IAAI i oba przykłady, które później się zakończyły. Bieżące wyniki i historię potwierdzać oddzielnie. W polu `vehicle_updated_at` wiadomości Dakoty występuje cofnięcie czasu mimo rosnących sekwencji dziennika.
2. Po zatwierdzeniu produkcji rozpocząć pojedynczą, ograniczoną próbę od 12 pozycji. Sprawdzić aktualną tożsamość, stan i nowsze zdarzenia bezpośrednio przed zapisem. Rozliczać rzeczywiste wiersze, obsługiwać powtórzenie tej samej zmiany i sprawdzić wynik publicznej wyszukiwarki. Docelowo kandydaci powinni trafiać do tej samej kolejki automatycznie.
3. Dla wcześniejszych plików jednokrotnie przetwarzać oryginały w kolejności generacji, zapamiętać postęp osobno od importu, zebrać wyłącznie przełożenia, usunąć powtórzenia tej samej oferty i sekwencji. Kandydatów sprawdzać po kluczach w D1, pytać REST wyłącznie przy niezgodności lub braku, respektować wspólną pulę. Ominąć oferty z późniejszym potwierdzonym zakończeniem. Wstrzymywać osobną pracę naprawczą, gdy zabraknie zapasu do zwykłego importu.
4. W kodzie porządkowania R2 kopie robocze ukończonych plików kwalifikują się do sprzątania po 48 godzinach, oryginały po 7 dniach. W momencie próby tabela metadanych zawierała 298 ukończonych generacji bez flagi wycofania. Ten licznik nie dowodzi fizycznej dostępności każdego pliku. Przed odtwarzaniem sprawdzać dostępność i sumę SHA-256 danego oryginału. Pełny katalog i globalny kursor importu nie wymagają cofania. [Reguła retencji](../../release/public-site/sync/feed-archive-retention.cjs)
