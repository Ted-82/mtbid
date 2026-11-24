# Tesla Model Y. Koszt uzupełnienia jednej kwoty

**2026 Tesla Model Y, Copart LOT 65054066, VIN 7SAYGDED8TA458053.** Na odizolowanej kopii zwykły odczyt karty i wyszukiwarka VIN zmieniły wyświetlaną kwotę z braku danych na **70 USD**. W czterech wariantach cena sprzedaży pozostała nieznana. Import zachował dotychczasowy punkt synchronizacji.

**Skąd klient odczyta datę?** W karcie auta sekcja **Historia aukcji → Zapisane obserwacje** wyświetla kolumny „Data odczytu” i „Zapisana oferta”. Zwykła odpowiedź historii po procedurze zawiera jeden wpis `observed_snapshot` z ceną 70 USD. W Polsce był to **24 listopada o 21:33**. Serwer zapisał dokładny czas sprawdzenia odpowiedzi REST, `2026-11-24T20:33:31.004Z`. Dane nie określają chwili złożenia lub zmiany oferty. Ogólny stempel całego wiersza katalogu pozostał z 8 listopada. Pola czasu pojedynczej oferty oraz źródła tej kwoty w DTO karty i listy pozostały puste. Ta ścieżka nie dodaje odpytywania historii przy renderowaniu list ani rozpoznania wyniku sprzedaży.

| Wariant pojedynczego uzupełnienia | Nowe żądania dostawcy | Wiersze odczytane D1 | Wiersze zapisane D1 |
| --- | ---: | ---: | ---: |
| Źródłowa odpowiedź już opłacona i dostępna w pamięci tego cyklu | 0 | 17 | 10 |
| Nowy odczyt, obydwa okresowe liczniki jeszcze nie istnieją | 1 | 81 | 53 |
| Nowy odczyt, liczniki już istnieją w bazie, nowy obiekt obsługi cyklu | 1 | 87 | 50 |
| Nowy odczyt, liczniki zainicjalizowano w tej samej obsłudze cyklu | 1 | 76 | 44 |

W pierwszym wierszu pokazano dodatkowy koszt po otrzymaniu odpowiedzi. Sam wcześniej wykonany odczyt w tej próbie zużył osobno 34 odczyty i 26 zapisów D1. Powtórzenie procedury użyło 0 dodatkowych żądań źródłowych i nie powieliło obserwacji. Po pierwszym wariancie koszt samej kontroli wyniósł 9 odczytów i 6 zapisów, obejmujących stan skanera. Po pozostałych wariantach wyniósł 8 odczytów i 0 zapisów.

**Granice pomiaru.** Liczniki pochodzą z metadanych poszczególnych rzeczywistych zapytań i partii zapytań w lokalnej D1 Miniflare z workerd. Użyto schematu katalogu, indeksów, punktu odtwarzania i jednego rzeczywistego przypadku. Wczytanie początkowych danych, założenie testowej bazy i odczyty kontrolne użytkownika wyłączono z kosztu badanego uzupełnienia. Liczba kandydatów w danym oknie, liczba wcześniej rozliczonych prób, indeksy i obciążenie produkcji mogą zmienić zużycie. Zestawienie nie jest rachunkiem miesięcznym. Wszystkie odpowiedzi źródłowe odtworzono lokalnie.

[Pełna metryka każdego zapytania i odpowiedzi](./TESLA-D1-ODCZYT-WYNIK.json) · [Powtarzalna próba](./TESLA-D1-ODCZYT.cjs)
