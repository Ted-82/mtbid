# Poranna blokada publikacji REXBID

27 listopada 2026 o 07:28 czasu polskiego ostatnią opublikowaną paczką była 25719 z sekwencją 124110428. Od 25469 do 25719 zatwierdzono 14 kolejnych paczek. Zakres każdej z nich zaczynał się od następnego numeru po końcu poprzedniej. Ostatnie cztery paczki 25738, 25758, 25778 i 25798 były już pobrane i zachowane, lecz nie weszły do wykonawcy publikacji. Przyczyna leżała po stronie REXBID. Dostawy Apibary trwały.

Dzienny licznik wykonawcy miał 152 416 804 rozliczone odczyty przy efektywnym limicie 150 mln. Zwykłe transakcje publikujące pracowały w małych zakresach odczytu. W oddzielnych wywołaniach wypadały serie po około 2,95–2,97 mln odczytów. Miesięczne rozliczenie wewnętrzne miało jeszcze 18,54 mld odczytów i 9,88 mln zapisów, a katalog około 5,38 GB zapasu do ustawionego sufitu. Zwiększenie planu lub pomijanie paczek było zbędne do odblokowania tej sytuacji.

W produkcyjnym planie SQL uzupełniania zdjęć D1 najpierw przeglądała aktywne członkostwo katalogu, potem odpytywała pojazdy i filtrowała listę przekazanych LOT. Zmieniono kolejność na identyfikatory → indeks `(platform, lot)` → konkretne członkostwo. Poprawiony odczyt rzeczywistego Copart LOT 76971556 znalazł jeden wiersz za sześć odczytów D1 i zero zapisów. Dla innych LOT trzeba sprawdzić produkcyjne użycie w kolejnych cyklach. API logów wykonawcy zwróciło 403, więc same koszty wszystkich uruchomień przypisujemy na podstawie zapisanego rozliczenia, a koszt konkretnego zapytania na podstawie planu i próby.

Dodatkowo w trybie rozliczania według miesięcznego cyklu dzienny zapas odczytów zależy od 1% aktualnie niewykorzystanej wewnętrznej puli. Kontrola sumy okresu nadal działa atomowo i zatrzymuje rezerwację po wyczerpaniu puli. Dzienny próg zapisów, miesięczne limity, opłacona infrastruktura i ochrona danych pozostają takie same. Poprawka wykorzystuje zdjęcia także z już opłaconego odczytu listy pojazdów. Próba Apibary zwróciła 20 z 20 galerii. Test celowej niedostępności zapisu zdjęć potwierdził, że strona weryfikacji aukcji zachowuje punkt dalszej pracy.

Na kopii testowej odtworzono blokadę z 152 416 804 odczytami, poprawne przyjęcie nowej pracy z wolną miesięczną pulą oraz odmowę po wyczerpaniu okna. Przeszło 845 testów synchronizacji. Punkt odtworzenia D1 z 07:31:16 PL zweryfikowano dwukrotnie, z lokalnym odtworzeniem pięciu ofert, kontrolą integralności i zerem zdalnych zapisów. Wersja bazowa to `756d96b9-cbf7-443a-a028-043b40486267`.

Wersję `477aa3ce-96ee-4bfe-bcde-146c2fbf82bd` włączono o 07:35 PL po sprawdzeniu zgodności 31 powiązań i kodu. Automat zarejestrował najstarszą oczekującą paczkę 25738 o 07:36:27 bez ręcznego przesuwania kursora. Punkt powrotu przywraca poprzedni pakiet kodu, pozostawiając dane bazowe.

## Wznowienie archiwum

Archiwum stanęło wcześniej przy 18 890 galeriach na paczce 18968. Odtworzono brakujący odcinek z wiarygodnych terminalnych zdarzeń Apibary i dołączono dwanaście kolejnych surowych plików po sprawdzeniu ich granic i sum SHA-256. Dla dużej 25281 przetestowano odczyt 1025 wydarzeń z dziewięciu małych porcji. Zapisano 23 przygotowane obiekty w istniejącym prywatnym R2, łącznie 28,36 MB. Wszystkie odczytano ponownie i zweryfikowano ich sumy. Zdalny zapis kopii nie zmienił w tym momencie indeksu publicznego.

Archiwizator `700b5244-51ed-4bfe-8547-cd7b566d1607` aktywowano o 07:49:54 PL. Punkt powrotu `8805e4d5-4fcf-4958-8790-bee995902e8b`. Sprawdzono kopię indeksu, dwa nowe przypięcia wejścia, zgodność istniejących zasobów i ten sam harmonogram. O 07:51:50 indeks zawierał 18 900 galerii, o 10 więcej. Punkt przesunął się automatycznie na 106678658. Publiczny odczyt Copart LOT 71230196 potwierdził 13 zdjęć i cenę sprzedaży 7 000 USD. Pierwsze zdjęcie odpowiadało HTTP 200 jako JPEG. Pozostają do odbioru tempo nadrobienia, aktualność nowych galerii i automatyczne ponawianie prywatnie odłożonych zadań.

Drugi cykl zakończył się o 07:56:19. Licznik wzrósł do 18 910, a kursor do 106679142. Po wygaśnięciu 30-sekundowej pamięci podręcznej wyszukiwanie publiczne znalazło Copart LOT 70038756 z potwierdzoną ceną 3 250 USD. Galeria miała 12 zdjęć, a pierwszy JPEG odpowiedział HTTP 200. Zapas R2 po uwzględnieniu rezerw wyniósł około 239,75 GB.

## Próby publiczne po wznowieniu

Wyszukiwania Subaru od 2025, dwóch kontrolnych VIN i drugiej strony elektrycznych zadziałały. Osiem dobranych pojazdów z 25738 i 25758 było na liście i otwierało właściwe karty. Sześć cen zgadzało się z paczką. Dla dwóch pozostałych Copart bieżący odczyt szczegółów źródłowych zwrócił `null`, zgodny z publicznym brakiem ceny. Kwot z wcześniejszej obserwacji nie traktujemy jako ceny sprzedaży ani aktualnej oferty. Szersza kontrola pokazała 16 763 z 47 569 zapisanych aktywnych aukcji Copart bez adresu zdjęć i 5 z 37 973 IAAI. Częściowy brak adresów nadal wymaga sprawdzenia pokrycia i tempa uzupełniania.

## Przepustowość archiwum

Harmonogram co 5 minut i pułap 10 nowych galerii na uruchomienie dają maksymalnie 2 880 galerii na dobę nawet przy idealnych odczytach. W poprzednim pomiarze 5 238 nowych galerii odpowiadało 22,01 godz. czasu widocznego w zdarzeniach źródła, co daje około 5 710 galerii na 24 godz. danych z tego fragmentu. Jest to szacunek gęstości jednego okresu na podstawie poprawnie zarchiwizowanych galerii. Nie mierzy typowego napływu całej oferty ani pełnego tygodnia. W takim okresie dotychczasowy pułap nie wystarcza do nadrobienia całości. Gdy paczki są kompletne, kolejne pomiary powinny liczyć równolegle rozpoznane zdarzenia, galerie, odłożone zadania, przepustowość i wiek kursora. Sama rosnąca liczba zdjęć nie potwierdza malejącej zaległości.

Obecna naprawa zabezpiecza pierwotne dane i rozdziela błędną galerię od możliwości postępu. Do stałego działania potrzeba trwałej, niewielkiej paczki zakończeń wytwarzanej podczas sprawdzania każdej dostawy i odrębnego, ograniczonego zapisu galerii. Retencja powinna uznawać za zabezpieczone tylko paczki odebrane przez archiwum albo objęte gotową, zweryfikowaną małą kopią zdarzeń. Główny import musi nadal mieć niezależne pierwszeństwo w budżecie i kolejce.
