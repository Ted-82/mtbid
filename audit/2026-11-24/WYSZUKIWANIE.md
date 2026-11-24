# Wyszukiwanie i powrót z karty pojazdu

24 listopada 2026, 18:03–18:05 czasu polskiego. Anonimowy odczyt publicznego rexbid.pl, z nagłówkiem wyłączającym naliczenie ruchu testowego. W dwóch seriach wykonano jednocześnie po trzy zwykłe zapytania. Jedno stanowisko, jedna sieć, jedna pora. Wynik nie wyznacza maksymalnej przepustowości serwisu.

| Wybór klienta | Co zwróciła produkcja |
|---|---|
| Subaru od 2025 | Po sześć ofert na dwóch stronach, wszystkie Subaru z lat 2025–2026. Ani jeden LOT z pierwszej strony nie powtórzył się na drugiej. Odpowiedzi po 1124 i 363 ms. |
| Elektryczne | Dwie strony po sześć, wszystkie dwanaście z potwierdzonym polem Electric, bez powtórek. Odpowiedzi po 523 i 206 ms. |
| Aktualne aukcje | Dwie strony po sześć różnych LOT-ów, każdy z datą aukcji. Odpowiedzi po 1176 i 363 ms. Czas sesji nie dowodzi aktywnej licytacji konkretnego auta. |
| Tylko „do 2017” | Sześć wyników z lat 2007–2016, zgodnych z górną granicą. |
| Zakres 2022–2024 | Sześć ofert, w tym auta dokładnie z 2022 i z 2024 r. |
| Bez granic | Sześć różnych aut z lat 2007–2019 w tej próbce. |
| „Od 2025 do 2022” | API zwróciło 400 i kod invalid_year_range. Formularz zaznaczył nieprawidłowe pole i wyświetlił „Rok: wartość „od” nie może być większa niż „do”. Popraw zakres i zastosuj filtry.” |
| Brak dopasowań | API zwróciło pustą listę i nie zaproponowało kolejnej strony. Widok klienta pokazał „Brak dopasowań w zapisanej części katalogu” i przycisk czyszczenia. |

We wszystkich sześciu odpowiedziach dotyczących dwóch stron trzech głównych wyszukań API zaoferowało dalszą stronę. Przebieg i czasy dotyczą domyślnego sortowania według najbliższego terminu i sześciu wyników na żądanie. Nie wystąpił błąd 503. Nie ustalano całkowitej liczby pasujących ofert poprzez pobieranie wszystkich stron.

## Próba w przeglądarce

Na ekranie 390 × 844 Edge/Chromium otworzono filtrowaną listę Subaru. Przycisk „Załaduj więcej” zwiększył listę z 20 do 40 różnych pojazdów. Z drugiej partii otworzono IAAI LOT 45951595. Na karcie pojawiły się ten LOT i zgodny VIN JF2BURMD7TY542315. Po użyciu Wstecz lista zawierała identyczne 40 pozycji w identycznej kolejności. Pozostały marka Subaru, dolny rocznik 2025 i poprzednie przewinięcie 16 334 px. Przycisk czyszczenia następnie usunął obie granice oraz markę, przywrócił 20 ofert pierwszej strony i adres /?catalog=1. Próby powrotu nie rozszerzano na Safari ani fizyczny telefon. [Filtrowana lista na rexbid.pl](https://rexbid.pl/?catalog=1&make=SUBARU&year_from=2025)

Dowód obejmuje czas każdego żądania, pary platforma i LOT, lata, paliwa, listę 40 identyfikatorów przed i po powrocie, pozycję przewinięcia oraz rzeczywisty komunikat formularza. [Odczyt produkcyjny](./search-public.json) · [Powtarzalny skrypt](./search-journey.cjs)

## Pula Apibary i dane Google

O 18:04 czasu polskiego odczyt /usage w tym samym audycie podał plan Pro, 100 000 zapytań REST na miesiąc, 24 371 użytych i 75 629 pozostałych. Odpowiedź nie zawierała nagłówków ze wskazaniem limitu, pozostałej puli ani Retry-After. Nie ma pomiaru minutowego limitu konta. Liczby dotyczą łącznego zużycia konta. [Zapis odczytu dostawcy](./vehicle-gallery-priority.json)

W tym audycie nie było połączenia z prywatnymi raportami Google Search Console REXBID. Odpowiedzi strony publicznej, sitemap oraz raport laboratoryjny nie określają liczby stron faktycznie wyświetlanych w Google. Właściciel może to sprawdzić w następujący sposób.

1. W Search Console wybierz usługę domenową rexbid.pl. Jeżeli nie widnieje na właściwym koncie, wybierz „Dodaj usługę” → „Domena”, wpisz rexbid.pl, dodaj otrzymany rekord TXT w aktywnym DNS Cloudflare i kliknij „Weryfikuj”. Zachowaj istniejące wpisy DNS. Jeżeli usługa ma już zweryfikowanego właściciela, może on nadać dostęp w ustawieniach usługi. [Weryfikacja własności](https://support.google.com/webmasters/answer/9008080?hl=pl)
2. W „Indeksowanie” → „Strony” sprawdź liczbę i przyczyny wykluczeń. W górnym polu sprawdzania adresu wpisz kolejno pełny URL strony głównej, poradnika i wybranej karty. Sprawdź adres kanoniczny wskazany przez Google i ostatnie pobranie. [Indeksowanie stron](https://support.google.com/webmasters/answer/7440203?hl=pl) · [Sprawdzanie adresu URL](https://support.google.com/webmasters/answer/9012289?hl=pl)
3. W „Indeksowanie” → „Mapy witryn” sprawdź stan i ostatnie pobranie https://rexbid.pl/sitemap.xml. Zgłoś ten adres, jeśli brakuje go na liście przesłanych map. [Raport map witryn](https://support.google.com/webmasters/answer/7451001?hl=pl)
4. W „Skuteczność” → „Wyniki wyszukiwania” ustaw 28 dni. Odczytaj kliknięcia i wyświetlenia w zakładkach „Zapytania”, „Strony” i „Urządzenia”. W „Podstawowe wskaźniki internetowe” otwórz raport urządzeń mobilnych. Mała próba użytkowników może pozostawić ten raport bez danych. [Skuteczność w wyszukiwarce](https://support.google.com/webmasters/answer/7576553?hl=pl) · [Podstawowe wskaźniki internetowe](https://support.google.com/webmasters/answer/9205520?hl=pl)
