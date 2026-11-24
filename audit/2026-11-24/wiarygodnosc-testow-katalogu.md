# Weryfikacja katalogu i archiwum na izolowanej kopii

**Stan 24 listopada 2026 r.** W pięciu grupach testów katalogu początkowo nie przechodziło 17 prób. Część miała wspólną przyczynę w nieaktualnych danych testowych. Dodano jeden przypadek porównujący listę z dostępem do historii. Wykonano rzeczywiste zapytania SQL w SQLite z aplikacyjnym kodem odczytu. Ten wynik nie dowodzi stanu dzisiejszego importu w Cloudflare.

| Grupa | Przed | Po | Ustalenie |
|---|---:|---:|---|
| Członkostwo w aktywnym katalogu, obciążenie i przełączenie | 6/16 | 16/16 | Baza testowa pomijała indeks daty używany przez produkcyjne zapytanie. Wpisy bez daty reprezentowały aukcje, których oczekiwano na liście. Kod testujący harmonogram nie mógł załadować zmienionego modułu Workera. Dodano rzeczywisty indeks z kodu aplikacji, przydzielony termin i prawidłowe zależności testu harmonogramu. |
| Odczyt zapisanego katalogu | 6/10 | 11/11 | Daty z 2099 roku wykraczały poza obsługiwany roczny horyzont. Daty testowe odnoszą się do dnia uruchomienia. Osobno potwierdzono, że brak daty, termin miniony i termin poza horyzontem wykluczają auto z listy przed podziałem na strony. Historia każdego pozostała dostępna. |
| Nazwa dokumentu | 6/7 | 7/7 | Ręcznie utworzone tabele pomijały realne kolumny daty i statusu. Zastąpiono je rzeczywistym schematem. Sprawdzono dokładne dopasowanie, filtrowanie przed paginacją, zakres platformy, ograniczenie parametrów i brak wywołań dostawcy. |
| Odczyty D1 i wariant listy z jedną fotografią | 7/8 | 8/8 | Auta w testach standardowo miały zamknięty w przeszłości termin i status Copart Upcoming. Dla próby publicznej listy samochodom nadano termin i status Open. Zdjęcia, pola i zgodność wskaźnika kolejnej strony są nadal porównywane z pełną odpowiedzią. |
| Historia oraz filtry przeglądarki | 42/43 | 43/43 | Test próbował wybrać nieistniejący już przycisk „upcoming”. Obecny interfejs publikuje potwierdzony termin jako zasadę. Sprawdzono faktyczny filtr zdjęć i lokalizację wraz z pozostałymi, zachowaniem adresu i stron, czyszczeniem oraz powrotem. |
| **Razem** | **67/84** | **85/85** | Bez zmiany zapytań lub harmonogramu produkcyjnego. |

### W jaki sposób odróżniono błędy produktu od błędów prób

Lokalne raporty before-*.txt oraz after-*.txt zapisują każde wykonanie. Dla błędów HRESULT/503 na kopii dodano lokalny ślad nieudanej kompilacji SELECT. SQLite podał brak indeksu idx_listings_public_auction_date oraz brak kolumny l.source_status w ręcznie okrojonym schemacie. Testy po poprawce faktycznie wywołują trasy publiczne. W testach przerwanego odczytu pozostają asercje liczby prób, braku użycia niezweryfikowanego cache i oddzielnego stanu po zmianie wersji katalogu. Brak przypisanego terminu nadal daje kontrolowane auction_date_pending na publicznej karcie. Ścieżka historii pozostaje dostępna po identyfikatorze. Własny wskaźnik paginacji można stosować tylko ze zgodnym sortowaniem i wersją katalogu. Sprawdzono również dawne sortowanie po dacie zapisu po cofnięciu wskaźnika aktywnej bazy.

### Dwa potwierdzone problemy produktu

- Przy wejściu ze współdzielonego adresu zawierającego wyłącznie filtr zdjęć pierwszy HTML głównej mógł pokazać stronę główną do czasu uruchomienia JavaScript. Dopisano with_photo do tych samych warunków wyboru widoku, których już używa formularz. Odpowiedź nie zawiera wprowadzonych wartości parametrów.
- API archiwum zamieniało brak statusu w sold. Również sam renderer dla nierozpoznanego statusu mógł wypisać „Sprzedany · bez ceny” lub potraktować kwotę jako potwierdzoną mimo braku dowodu. Aktualna implementacja pokazuje cenę wyłącznie przy statusie sold oraz prawidłowej dodatniej kwocie w centach. Status not_sold daje „Bez sprzedaży”. Brak statusu, nierozpoznany status i wartość warunkowa dają „Wynik niepotwierdzony”. Dotyczy publicznej odpowiedzi i widoku; na kopii nie zmienia się zapisów danych, zdjęć ani kursora. Testy bezpośrednio sprawdzają także stary rekord bez statusu i brak ceny. Stan surowych danych jest zachowany. Dla starych rekordów, których stan sprzedaży nie zachował się, użytkownik może zobaczyć mniej potwierdzonych cen; odtworzenie dowodu źródłowego to odrębna operacja.

Cztery pliki testów dotyczące publikacji, archiwalnych etykiet, odczytu archiwum i regulaminu dały 47/47 pozytywnych wyników w niezależnym przebiegu. Obejmuje to jednocześnie mapę, znaczniki kalkulatora, demonstrację kopii ochronnej katalogu i chronioną obsługę plików. Ustawień produkcyjnych nie zmieniono.

