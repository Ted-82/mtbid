# Archiwum REXBID przy 1, 5 i 10 mln aukcji

**Rekomendacja.** Zachować galerie i rekordy aukcji w obecnym R2. Przed osiągnięciem granicy obecnego indeksu uruchomić równolegle jego drugą wersję z osobnymi indeksami po VIN, po platformie i numerze LOT oraz po kolejności publikacji. Zmiana dotyczy archiwum zakończonych aukcji. Import aktywnych ofert ma własny punkt wznowienia.

## Sprawdzone 24 listopada 2026 r.

Publiczny kod wyszukiwania przetestowano na 100 000 syntetycznych rekordów, z wyłączonym cache i licznikiem żądań w pamięci. Przy 390 segmentach indeks główny zajmował 632 401 B. Dla 16 znalezionych VIN średnia wyniosła 2,875 odczytu R2 na wyszukanie (2–9), dla 16 znalezionych numerów LOT 2,375 (2–4), a dla 16 brakujących VIN 1,5 (1–3). Pierwsza strona wymagała jednego odczytu. Wyszukiwanie i lista wykonały zero zapytań D1. Test nie mierzył prędkości sieci ani rozmiaru rzeczywistych zdjęć. [Wyniki pomiaru](archive-read-cost.json)

Obecna implementacja ogranicza indeks do **500 000 wpisów, 2048 segmentów i 8 000 000 bajtów obiektu głównego**. Segment zawiera maksymalnie 256 rekordów. Budżet zdjęć może zostać wyczerpany wcześniej. Publiczna lista zwraca po 12 pozycji. Identyfikator istniejącego zapisu zawiera platformę, tekstowy LOT i sekwencję. Próby na 1, 5 i 10 mln nie zostały wykonane. [Stan archiwum](../../release/public-site/sync/auction-archive-state.cjs) · [Segmenty i wyszukiwanie](../../release/public-site/sync/auction-archive-segments.cjs) · [Publiczne API i zdjęcia](../../release/public-site/sync/auction-archive-public.cjs)

## Projekt drugiej wersji

1. **Jeden zapis na cykl aukcyjny.** Zachować historyczny identyfikator platforma–LOT–sekwencja i powiązanie ze źródłowym identyfikatorem cyklu, gdy jest dostępny. Powtórzenie tej samej obserwacji aktualizuje istniejący cykl. Potwierdzone ponowne wystawienie tworzy następny. Nierozstrzygnięte dopasowanie trafia do weryfikacji. Zmiana ceny lub godziny na tej samej aukcji nie tworzy samodzielnie relistu. Zachować datę obserwacji, status i dowód wyniku dla danego cyklu.
2. **Trzy drogi odczytu.** Znormalizowany VIN kieruje do partycji wybranej prefiksem jego skrótu. Platforma i tekstowy LOT mają odrębny indeks takim samym sposobem. Przy samym LOT sprawdzać obie platformy i zachować oba trafienia. W partycji porównywać pełne klucze i odsyłać do cykli. Duże partycje dzielić dodatkowymi znakami skrótu. Oddzielny spis chronologiczny ma stabilny kursor z wersją indeksu, sekwencją i identyfikatorem rozstrzygającym remis. Dalsza strona nie powinna przechodzić na inną wersję w środku sesji.
3. **Galerie, widoczność i usunięcia.** Zachować klucze galerii i publiczne adresy zdjęć. Indeksy przechowują odsyłacze, a pliki zdjęć pobiera się po otwarciu galerii. Wspólny rejestr ukryć sprawdza się przed podaniem rekordu, pliku i odpowiedzi z cache. Wpis usunięcia ma pierwszeństwo również w starszym indeksie i przy odtwarzaniu kopii. Panel potwierdza pełne usunięcie dopiero po zakończeniu dotychczasowej procedury usuwania zdjęć i weryfikacji bezpośrednich adresów.
4. **Spójność i powrót.** Budować nowe, niezmienne manifesty od zapisanego punktu archiwum. Odtworzyć zmiany, relisty i ukrycia, które przyszły podczas budowy. Sprawdzić sumy kontrolne, liczbę cykli i galerii oraz widoczność. Porównywać odpowiedzi obu wersji na tych samych identyfikatorach. Po akceptacji przełączyć jeden wskaźnik wersji warunkowym zapisem sprawdzającym poprzedni ETag. Przez okres próby utrzymywać obie wersje na tym samym strumieniu zmian. Przed powrotem sprawdzić, czy poprzednia wersja doszła do bieżącego punktu i stosuje aktualny rejestr ukryć. Przed zbliżeniem się do pułapu starej wersji przygotować jako punkt powrotu poprzedni poprawny manifest nowego formatu.

## Kryteria odbioru na stagingu

Poniższe wartości są proponowanymi progami, które trzeba potwierdzić pomiarem. Liczyć **cykle aukcyjne** oraz osobno unikalne VIN. Test powinien zawierać powtarzane VIN, te same LOT na obu platformach, brakujące identyfikatory, równoczesne dopisanie i usunięcie oraz niedostępne zdjęcia. Przy każdej skali wymagana jest pełna zgodność liczby i sum kontrolnych cykli oraz widoczności. Zmierzyć co najmniej 1000 wyszukań z każdego rodzaju przy zimnym i ciepłym cache.

| Wielkość próbki | Warunek odbioru |
|---|---|
| 1 mln | Dla pierwszej strony trafionego VIN lub LOT ze znaną platformą 95% prób wymaga najwyżej 6 odczytów R2, dla braku klucza najwyżej 4. Brak zapytań D1 i zapytań do Apibary podczas odczytu archiwum. Porównać wszystkie wyniki z niezależnym indeksem odniesienia. |
| 5 mln | Utrzymać kryteria odczytu. Przy ruchu z odtworzonego szczytu sprawdzić czas odpowiedzi i równoczesne dopisywanie oraz podział partycji. Trzy kolejne strony mają komplet wyników bez powtórzeń i pominięć mimo dopływu nowych cykli. |
| 10 mln | Utrzymać poprzednie kryteria, przerwać budowę nowego indeksu na kopii, wznowić od zapisanego punktu, przetestować przełączenie i powrót oraz otworzyć reprezentatywne galerie. Żaden wcześniej ukryty rekord ani plik nie może powrócić. |

Przed decyzją o produkcji potrzebne są pomiary 95. i 99. percentyla czasu odpowiedzi, liczby operacji, kosztu jednorazowej budowy i kosztu miesięcznego przy rzeczywistym przyroście zdjęć. Pełne dziesięć milionów wpisów w prywatnym teście Cloudflare wymaga wcześniejszej kalkulacji przestrzeni i operacji. Dane syntetyczne i pierwsze testy na kopii lokalnej ograniczają wydatek. Projekt nie uruchamia nowych usług.
