# Ponowne wystawienie jednego VIN. Próba na danych Copart

Ostatnia dodatkowa kontrola o 20:58:57 czasu polskiego potwierdziła termin 1 grudnia u źródła i pustą datę w aktywnej bazie REXBID. Rekord dostawcy miał znacznik aktualizacji 24 listopada o 18:16:21, a pełny rekord D1 znacznik 8 listopada o 09:18:56. W tym momencie najnowsza opublikowana paczka 23316 zakończyła się o 20:49:14 na sekwencji 118680705. Odpowiedź szczegółowa REST nie podała sekwencji tej zmiany, a w zachowanych próbkach paczek z wcześniejszego odbioru nie odnaleziono tego LOT. Przyczyna rozbieżności pozostaje niepotwierdzona.

24 listopada 2026 r. porównano ten sam Dodge Dakota Sport z 2002 r., VIN `1B7GG32X82S697320`, u dostawcy, w obu produkcyjnych bazach katalogowych i w publicznej wyszukiwarce. **Apibara potwierdza dwa wystawienia pod różnymi LOT. Wyświetlenie obu wystawień na REXBID pozostaje otwarte.**

| Dane źródłowe tego VIN | Data zapisu w historii aukcyjnej Apibary | Status źródła | Kwota w historii |
|---|---|---|---:|
| Copart LOT 63030896, ten sam VIN potwierdzony również w `vin_lots` | 17.08.2026 | Sold on Approval, wynik warunkowy | 125 USD |
| Copart LOT 65917836, VIN zgodny z kartą źródłową | 24.11.2026 | Not Sold, nie sprzedano | 225 USD |

Obie wartości są kwotami przypisanymi przez dostawcę do zdarzeń. Brakuje potwierdzonej ceny sprzedaży w obu wskazanych przypadkach. Źródło podało dla nowszego LOT również następny termin 1 grudnia o 03:00 czasu polskiego. Rozdzielenie wystawień opiera się na odrębnych numerach LOT przypisanych przez źródło do jednego VIN oraz dwóch historycznych wynikach. Sama późniejsza data na LOT 65917836 nie przesądza o odrębnym cyklu.

W aktywnej i wcześniejszej bazie REXBID znaleziono zapis nowszego LOT, w obu po 0 zdarzeń w `auction_events`. Starszy LOT nie miał w tych bazach osobnej karty. Aktywna baza miała pustą datę dla LOT 65917836. O 20:56 czasu polskiego zwykłe wyszukiwanie po VIN w publicznym katalogu zwróciło 0 ofert. Kontrola nie ustala przyczyny spóźnienia tego rekordu ani skali problemu w katalogu. [Publiczne wyszukiwanie tego VIN](https://rexbid.pl/?catalog=1&s=1B7GG32X82S697320)

Własne archiwum z galeriami obejmuje roczniki 2018+. Ten Dodge jest poza tym zakresem. Sprawdza wystawienia w źródle i stan bieżącego katalogu. W zapisanej próbie 26 dopasowanych kart wyłącznie ten pojazd miał odrębny LOT w polu `vin_lots`. W przypadku kontrolnym autobusu LOT 47018496 starsza baza zawierała 30 pozycji historii przypisanych do tego samego LOT. Te pozycje nie rozstrzygają wymogu dwóch niezależnie potwierdzonych wystawień w archiwum 2018+.

W pierwszej dzisiejszej próbie zapis z publicznej karty nosił znacznik 8 listopada 09:18:56 czasu polskiego. Odczyt u dostawcy z polem aktualizacji 24 listopada 16:31:32 wskazywał sesję 24 listopada o 18:00. W późniejszej kontroli źródło sprawdzono do 20:54:59, obie bazy do 20:55:55, a wyszukiwarkę o 20:56:31. Są to oddzielne odczyty. Do rozstrzygnięcia rozbieżności terminu trzeba odnaleźć w dostawie zmianę tej konkretnej aukcji, powiązać ją z sekwencją i punktem ukończenia paczki, uwzględnić ewentualne późniejsze zmiany, następnie odczytać ponownie D1 i zwykłą kartę. Sam numer ostatniej opublikowanej paczki nie rozstrzyga, czy zawierała tę zmianę.

Sprawdzenie wykonano odczytami. Pominięto otwarcie mechanizmu wzbogacania historii, ponieważ przy braku aktualnej historii normalne wywołanie może dopisać pracę do produkcyjnej kolejki. Widok tabeli na karcie tego auta i późniejsze działanie uzupełniacza pozostają nieprzetestowane. Warunek odbioru to rzeczywiste auto od rocznika 2018 z dwoma potwierdzonymi wystawieniami, przy którym REXBID udostępnia oba wpisy pod tym samym VIN, właściwy LOT, datę, status i odpowiednio opisaną kwotę. [Pola i wyniki odczytu](powtorne-wystawienie-dowod.json)
