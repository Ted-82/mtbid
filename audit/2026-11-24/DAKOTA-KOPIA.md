# Próba przełożenia aukcji na odizolowanej kopii

**Test rozszerzony zaliczony.** W lokalnej kopii po przetworzeniu rzeczywistych zmian wyszukiwarka pokazała wszystkie **12 z 12** potwierdzonych brakujących ofert. Dziesięć rekordów wróciło do katalogu. Dwa nowe rekordy IAAI, Honda Accord LOT 46331966 i Lexus ES LOT 46440066, zostały zapisane ze zweryfikowanych danych dostawcy. Zakończony Buick pozostał poza katalogiem.

| Etap testu | Ile z 12 ofert znajduje wyszukiwarka po pełnym VIN |
|---|---:|
| Skopiowany stan wyjściowy | 0 |
| Po paczce 23248 | 8 |
| Po przejściu kolejno przez paczki 23271, 23293 i 23316 | 12 |
| Po powtórzeniu całej sekwencji | 12 |

W czterech rzeczywistych przypadkach IAAI godzina w pierwotnej paczce była o dwie godziny wcześniejsza od obecnego pełnego rekordu dostawcy. Przy pierwszej paczce automat odroczył te oferty. Apibara przekazała skorygowane terminy dla LOT 46590142, 46575567 i 46444541 w paczce 23271, odpowiednio w sekwencjach 118322515, 118324446 i 118381962. Korekta dla LOT 46331966 przyszła w paczce 23316, w sekwencji 118642285. Każdy z czterech późniejszych terminów zgadza się z pełnym rekordem właściwego VIN i LOT.

Próba rozszerzona obejmuje 52 odczyty lokalnego HTTP, każdy z kontrolą treści i tożsamości. Wykonawca wykorzystał 17 odpowiedzi odtworzonych z zapisanej próby Apibary. Pełne powtórzenie nie wykonało dodatkowego odczytu szczegółów, nie zmieniło zadań, ich potwierdzeń ani kursora. Skrypt testowy w trybie `extended` odtwarza rzeczywiste zmiany w kolejności plików. Jest to test kwalifikacji, zapisu i wyszukania samochodu. Przygotowując lokalne dane do testu pominięto zewnętrzne adresy zdjęć. Weryfikacja pobierania galerii i czasu nadejścia paczek odbywa się osobno. [Wynik rozszerzonego testu](./DAKOTA-KOPIA-ROZSZERZENIE-WYNIK.json) · [Dane i zachowane odpowiedzi](./DAKOTA-KOPIA-ROZSZERZENIE.json) · [Późniejsze zdarzenia cen i terminów](./DAKOTA-KOPIA-POZNIEJSZE.json)

## Pierwsza próba integracyjna

| Wyszukiwany VIN | Pojazd i LOT | Przed naprawą | Po naprawie i po powtórzeniu wejścia |
|---|---|---:|---|
| 1B7GG32X82S697320 | 2002 Dodge Dakota Sport, Copart 65917836 | 0 ofert | 1 oferta, sesja 1 grudnia o 03.00 w Polsce |
| 1G1ZD5ST6KF110771 | 2019 Chevrolet Malibu LT, IAAI 45833848 | 0 ofert | 1 oferta, sesja 3 grudnia o 15.30 w Polsce |
| 5GAKVCKD6HJ137124 | 2017 Buick Enclave Premium, IAAI 46162902 | 0 ofert | 0 ofert, nowszy zapis o zakończeniu zachowany |

## Czego dowodzi próba

W odizolowanym środowisku Cloudflare workerd i Miniflare utworzono lokalną D1. Test wystartował z odczytanych nieaktywnych wierszy aukcji i danych o przynależności do katalogu. Z odzyskanego pliku wybrano zdarzenia dotyczące sprawdzanych LOT. Dane użytkowników, pliki klientów i produkcyjne klucze nie weszły do kopii. Konfiguracja istniejącego zdalnego wykonawcy stagingowego wskazuje wspólną bazę testów kont, dlatego lokalny test dostał własną bazę.

Test uruchomił kod reduktora zmian, zarejestrowania zadań w kolejce i weryfikacji przy następnym cyklu. Transport dostawcy odtworzył zachowane prawdziwe odpowiedzi z kontrolą tożsamości. Sprawdzono rezultat przez żądania HTTP GET do zwykłego czytnika `/api/cars?view=cards&per_page=20&s=VIN`, uruchomionego w workerd. Ten sam czytnik wybiera dane z testowej bazy D1 i buduje odpowiedź publicznej listy. Zapis aktywnych ofert nastąpił wyłącznie w kodzie importera. Zestaw prób objął dziewięć odczytów HTTP i dwa zarejestrowane przez transport testowy odczyty detalu.

Ponowne przetworzenie identycznej generacji zachowało wszystkie pola zadań i potwierdzeń, wyniki wyszukiwania oraz globalny kursor importu. Liczba dodatkowych odczytów detalu po powtórzeniu wyniosła zero. Naprawa dotyczy bieżącej dostępności, daty i potwierdzonych cen. Pole świeżości całej karty może pozostać oznaczone jako starsze. W próbie zachowano datę oryginalnego pełnego opisu pojazdu.

**Co rzeczywiście poprawiono w trakcie tej kontroli.** W pierwszej wersji zabezpieczenie tożsamości zatrzymywało Dakotę. Odczyt po jej VIN prowadził do poprzedniego LOT 63030896. Odczyt po bieżącym LOT 65917836 zwrócił prawidłowy samochód. Test wykrył również ponowny zapis potwierdzenia po powtórzeniu tej samej zmiany zakończonego Buicka. Ostateczny test z oboma poprawkami przeszedł.

## Granice wyniku

Czas między lokalnymi cyklami był symulowany, a metadane testowego punktu synchronizacji były przygotowane na opróżnionej kopii. Test nie obejmuje rzeczywistej dostawy nowej paczki od dostawcy, zdalnej kolejki, wywołania zegara Cloudflare, produkcyjnych budżetów ani warstwy cache na publicznej domenie. Dostępność klienta na docelowej stronie wymaga osobnego odczytu po zatwierdzonym wdrożeniu. Wyniki rzeczywistej publicznej produkcji w chwili audytu znajdują się w [odczytach wyszukiwarki](./DAKOTA-PACZKI-WYSZUKIWANIE.json).

Próbę wykonuje [skrypt lokalny](./DAKOTA-KOPIA-TEST.cjs) przyjmujący kolejno katalog z przygotowanym poprawionym wykonawcą, katalog źródeł publicznej strony i katalog lokalnych zależności Wrangler z Miniflare oraz esbuild. Wykonanie wymaga dostępu do interfejsu sieciowego lokalnego komputera. Skrypt nie potrzebuje zalogowanego konta Cloudflare ani klucza Apibary. Dowody zawierają [wybrane pola źródła i kopii](./DAKOTA-KOPIA-DANE.json), [odczyty tożsamości](./DAKOTA-KOPIA-TOZSAMOSC.json), [wynik sprzed korekty obsługi LOT](./DAKOTA-KOPIA-PRZED-ZMIANA-LOT.json) oraz [końcowy zapis testu, razem z sumami kodu](./DAKOTA-KOPIA-WYNIK.json).
