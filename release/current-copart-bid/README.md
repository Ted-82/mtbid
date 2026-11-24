# Weryfikacja brakującej ceny aktywnej aukcji Copart

Moduł działa w istniejącym wykonawcy importu po przekazaniu gotowych zadań do publikacji. Po ukończeniu paczki lub w wolnym przebiegu może wypełnić pustą cenę regularnej aukcji Copart z datą w najbliższych 24 godzinach. Cenę potwierdza pełna odpowiedź Apibary, zgodna z platformą, LOT, VIN i dokładnym terminem. Odczyt musi nastąpić w ostatnich 30 sekundach, a wersja rekordu dostawcy najwyżej dobę wcześniej. Brak danych, zero, inna tożsamość, inny termin, wynik warunkowy i dowód zakończenia pozostawiają cenę pustą.

W części starszych rekordów Copart pole opisu statusu przechowuje dawny termin sesji. Tak było w Tesli LOT 65054066, gdzie w produkcyjnej D1 pozostał tekst `Nov 12, 2026 20:00`. Gdy aktywny wpis ma przyszły termin, ścisły format dawnej daty kalendarzowej umożliwia sprawdzenie pełnej aktualnej odpowiedzi. Sam dawny napis nie ustala terminu, stanu ani ceny. Słowa o nieznanym znaczeniu, oznaczenia wyniku oraz niepoprawne daty nie kwalifikują auta przez tę ścieżkę.

Najpierw moduł wykorzystuje odczyty źródła, które wykonawca już wykonał w tej samej pracy. W pamięci pozostają najwyżej cztery krótkie obserwacje. Poza tym program przegląda po 32 wpisy przez istniejący indeks platformy, stanu i daty. Gdy znajdzie kwalifikującą się ofertę, może użyć najwyżej jednego dodatkowego wywołania na pięciominutowy przedział, we wspólnej puli dostawcy. Jeśli licznik Apibary jest nieaktualny, ten przedział służy wyłącznie do odświeżenia licznika. Zweryfikowany brak odpowiedzi, starsze dane lub 404 dają możliwość przejścia do następnego pojazdu. Prywatny kursor przeglądu wraca po czasie do początku, więc oferta może zostać sprawdzona ponownie.

Zapis ceny, obserwacji w historii i kontroli tożsamości jest jedną transakcją. Nowszy wynik, cena, zmiana członkostwa albo ruch globalnego kursora podczas odczytu unieważniają transakcję pomocniczą. Czas na osi historii jest chwilą rzeczywistego odczytu pełnych danych, a data całego rekordu pozostaje dotychczasowa. Ta ścieżka nie zajmuje się aukcjami Timed, bieżącym torem Live ani ceną sprzedaży.

## Powtarzalny odbiór

Utwórz odrębną kopię pełnego wykonawcy przeznaczoną do testów. W niej umieść plik `.rexbid-isolated-build` z treścią `REXBID isolated build`. Uruchom `node integration.cjs --isolated C:/ścieżka/do/kopii` z tej paczki. Skrypt przed zapisem sprawdza obydwa miejsca podłączenia. Odrzuca częściowo zmienioną kopię. Powtórzenie przy identycznych plikach zwraca sukces.

W kopii uruchom `node --test tests/feed-known-bid.test.cjs tests/feed-known-relist.test.cjs tests/feed-sparse-repair.test.cjs tests/feed-iaai-rescheduled-reset.test.cjs tests/feed-server-runner.test.cjs`. Osobna próba wykonała publiczne zapytanie o tę samą ofertę i historię przez lokalny Workers i izolowaną D1. [Pomiar rzeczywistego API](../../audit/2026-11-24/TESLA-D1-ODCZYT-WYNIK.json)

Po zatwierdzeniu produkcji przygotuj kopię bazy i zapisz wersję wykonawcy. Odbierz dwie rzeczywiste publikacje, użycie rezerwy, właściwy VIN/LOT i dostępność ceny wraz z jej własnym śladem w historii. W przypadku regresji przełącz ruch na poprzednią sprawdzoną wersję wykonawcy. Powrót oprogramowania zachowuje poprawnie zapisane źródłowe obserwacje. [Uzasadnienie, koszty, dowody](../../audit/2026-11-24/TESLA-NAPRAWA-CENY.md)
