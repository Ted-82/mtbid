# Tesla Model Y. Brak aktualnej oferty w znanym rekordzie Copart

**Na izolowanej kopii zwykła karta, wyszukiwanie i historia LOT 65054066 prawidłowo pokazały 70 USD.** W źródle była to aktualna oferta dla VIN 7SAYGDED8TA458053. Cena sprzedaży pozostała nieznana. Pierwszą odtworzoną kwotę sprawdzono 24 listopada o 21:33:31 czasu polskiego. Ogólna data zapisu rekordu zachowała 8 listopada. Czytelny ślad czasu odczytu konkretnej kwoty dla tego zwykłego Coparta jest w publicznej historii. Osobny znacznik czasu na liście i karcie dla tego rodzaju ceny wymagałby rozszerzenia dotychczasowego interfejsu. [Próba rzeczywistych punktów wejścia](TESLA-D1-ODCZYT-WYNIK.json)

Przed naprawą produkcyjny katalog miał aktywny wiersz oraz poprawny termin 25 listopada o 07:00 czasu polskiego, ale cenę pustą. Cztery sprawdzone paczki, 23038, 23058, 23338 i 23361, nie zawierały tego LOT. Przyczyna po stronie REXBID jest węższa niż stwierdzenie o brakującym zdarzeniu dostawcy. W dotychczasowej konfiguracji brak kwoty w znanym przyszłym Coparcie nie kwalifikował go do nowego odczytu. Dokładna chwila zmiany kwoty u Apibary i treść pozostałych paczek pozostają nieustalone. [Dowody z produkcji sprzed zmiany](TESLA-CENA-KWALIFIKACJA.json)

## Ile kosztuje sprawdzenie

| Wariant z próby na jednej Tesli | Dodatkowe wywołania Apibary | Odczytane wiersze D1 | Zapisane wiersze D1 |
| --- | ---: | ---: | ---: |
| Wykorzystanie wcześniej opłaconej odpowiedzi | 0 | 17 | 10 |
| Nowy odczyt, utworzenie liczników | 1 | 81 | 53 |
| Nowy odczyt, istniejące liczniki i nowy obiekt obsługujący przebieg | 1 | 87 | 50 |
| Nowy odczyt, liczniki ustawione już w tym przebiegu | 1 | 76 | 44 |

Wyniki pochodzą z metadanych lokalnej D1, osobno dla każdego wariantu. Wspólna rezerwa przydziela najwyżej jeden dodatkowy start transportu na pięć minut, do **288 przedziałów przez dobę** lub 8 640 przez 30 dni. Kontrola licznika źródła również zajmuje taki przedział. Własne limity 500 wywołań dziennie i 12 000 miesięcznie, zapas dla głównego importu i rzeczywista pozostała pula mogą obniżyć tę liczbę. Wykorzystanie odpowiedzi, którą już pobrano z innego powodu, nie zużywa dodatkowego wywołania.

W Workers Paid pierwsze 25 mld odczytów i 50 mln zapisów D1 miesięcznie wchodzi w cenę planu. Przy hipotetycznym przekroczeniu obu pul operacje w wierszu z utworzeniem liczników kosztowałyby **0,000053081 USD**. Gdyby 8 640 takich zapisów miało identyczny rozmiar, stanowiłoby to około **0,46 USD** za te operacje D1. To przykład dla jednej zmierzonej oferty. Liczba przeglądanych rekordów, faktyczne użycie całego konta, pamięć, CPU Workera i inne funkcje mają wpływ na fakturę. Poprawka nie dokupuje danych ani usług i nie tworzy dodatkowej bazy. [Cennik D1](https://developers.cloudflare.com/d1/platform/pricing/)

## Sprawdzenia i granice

- Zestawy wykonawcy dotyczące cen, harmonogramu, importu, ponownych wystawień i szczątkowych rekordów przeszły **111/111** testów, z czego osiem dotyczy tej poprawki.
- Testy obejmują powtórzenie, użycie opłaconego odczytu, jeden koszt nowego sprawdzenia, brak rezerwy, odświeżenie starego licznika, przeniesienie uwagi na drugi LOT po błędzie pierwszego, nowszy wynik w trakcie zapisu oraz ochronę pustych danych.
- Przed kopiowaniem sprawdzono działanie instalatora dla kompletnej kopii, identycznego powtórzenia, zmienionego drugiego punktu podłączenia, częściowej instalacji i nieoznaczonego katalogu.
- Próba nie wykonywała nowych odczytów prywatnego źródła dla tej Tesli ani zapisów na rexbid.pl. Jedną kwotę można odtworzyć z prawdziwej zachowanej odpowiedzi. Nie ma gwarancji odświeżenia każdego pojazdu w katalogu przed sesją. Przepustowość zależy od liczby pustych ofert, kolejności, aktualności dowodów i dostępnego budżetu. [Kod wydania i wycofanie](../../release/current-copart-bid/README.md)
