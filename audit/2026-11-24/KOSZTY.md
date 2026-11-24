# Koszt utrzymania REXBID i zapas na wzrost
24 listopada 2026, USD przed podatkami. Wdrożenie dotyczyło tylko stagingu w dotychczasowym koncie. Poniżej są osobno odczyt zużycia, cena planów i symulacja.

## Co kosztuje dzisiaj

| Pozycja | Co ustalono |
|---|---|
| Cloudflare Workers Paid | 5 USD/mies. za konto. W przekazanej fakturze z 6 listopada widnieje 5 USD. Bieżące zbiorcze liczniki odczytano z Analytics. Dostęp techniczny do listy abonamentów zwrócił 403, więc kwota kolejnej faktury pozostaje nieznana. [Cennik](https://developers.cloudflare.com/workers/platform/pricing/) |
| Apibara Vehicle Auction Data API Pro | 70 USD/mies. według cennika, 100 tys. zapytań REST. Odczyt konta o 18:04 potwierdził Pro, 24 371 zapytań użytych i 75 629 pozostałych. Basic za 25 USD nie daje tej samej usługi. Paczki i strumień Live w Pro mają oddzielne ograniczenia operacyjne. [Apibara](https://apibara.tech/en/pricing) |
| D1 | 50 mln wierszy zapisanych, 25 mld odczytanych i 5 GB łącznie w pakiecie. Nadwyżka 1 USD/mln zapisów, 0,001 USD/mln odczytów, 0,75 USD/GB-mies. [Cennik D1](https://developers.cloudflare.com/d1/platform/pricing/) |
| R2 Standard | 10 GB-mies., 1 mln operacji klasy A i 10 mln klasy B w miesięcznej puli. Potem 0,015 USD/GB-mies., 4,50 USD/mln A i 0,36 USD/mln B. Wyjście danych bez opłaty transferowej. Operacje rozliczane blokami, przekroczenie 1 mln A może kosztować 4,50 USD nawet przy niewielkiej nadwyżce. [R2](https://developers.cloudflare.com/r2/pricing/) |
| Supabase i Resend | Supabase obsługuje konta. Model przyjmuje Free, 50 tys. aktywnych kont/mies., 500 MB bazy, możliwość uśpienia po tygodniu braku aktywności. Resend Free ma 3000 maili/mies. i 100/dobę. Ostatnie ustalenia i kod wykazują użycie obu usług. W tym audycie nie odczytano ich prywatnych faktur. [Supabase](https://supabase.com/pricing/) · [Resend](https://resend.com/pricing) |
| Domena i poczta OVH | Opłaty związane z domeną/skrzynką rozliczane są oddzielnie. Pełny koszt firmy to poniższy wynik + rzeczywista faktura OVH w przeliczeniu na miesiąc + podatki. Brak dokumentu z aktualną kwotą OVH. ChatGPT jest narzędziem pracy zespołu i nie jest potrzebny do publicznej obsługi zapytań. |

**Pomiary.** 6–24 listopada do 17:58 czasu polskiego (początek okna 6 listopada przyjęty z historii rozliczeń, D1 agreguje po dacie UTC). 36 180 273 zapisów i 965 976 070 odczytów D1. Sześć baz zajmowało łącznie 4,9783 GB, czyli 21,69 MB do progu naliczenia opłaty za miejsce. Aktywny katalog zajmował 2,3981 GB przy wewnętrznym progu 8 GB. Po rezerwie roboczej miał 5,594 GB miejsca na wzrost. Zestawienie z 22 listopada wskazywało 4,9581 GB łącznie. Różnica około 20,2 MB w ponad dwie doby jest za krótka na prognozę długoterminową. Przekroczenie 5 GB zwiększa opłatę za przechowywanie. Przy 8 GB wszystkich baz przez cały miesiąc nadwyżka za samo miejsce wyniosłaby 2,25 USD. Napełnienie **samego katalogu** do 8 GB przy utrzymaniu pozostałych baz wymaga doliczenia ich przestrzeni.

R2 miał około **42,15 GB** (suma ostatnich maksimów kubełków w sześciogodzinnym oknie), z czego około 39,32 GB w największym kubełku. Przy utrzymaniu takiej średniej przez miesiąc opłata za miejsce wyniosłaby około 0,50 USD. Odczytano 673 871 operacji klasy A, w tym 473 009 operacji listowania, oraz 1 180 636 operacji klasy B. Przy równym tempie klasa A osiągnęłaby około 1,08 mln w 30 dni. To konkretny cel optymalizacji. W kolejnym wydaniu warto rozdzielić listowania według kubełka, prefiksu i zadania, aby zastępować powtarzane przeglądanie po znanym kluczu. Wyłączenie potwierdzeń kolejki mogłoby zgubić zmiany.

Workers w ostatnich 24 h odnotował 9215 wywołań i 0 błędów wykonania w zbiorczym liczniku konta. Odpowiedź aplikacji 503 obsłużona w kodzie może nie zwiększyć tego licznika. Mediany czasu CPU ani pojedynczego percentyla nie można pomnożyć przez liczbę wywołań, aby ustalić faktyczną fakturę. [Surowe agregaty](usage.json)

## Ile kosztuje większy ruch

Jedna osoba odwiedza serwis raz dziennie. Model przyjmuje 30 dni, 4 strony na wizytę, 40 rozliczanych wywołań Workera po 6 ms CPU, 6 wyszukiwań po średnio 500 odczytanych wierszy D1, 0,1 rozliczanego zapisu D1 na wizytę, 0,5 odczytu R2 związanego z archiwum, 4 wywołania licznika wizyt i umiarkowane wykorzystanie Live. Część plików statycznych przechodzi obecnie przez Workera. Założenia kosztowe są konserwatywne względem skutecznej pamięci podręcznej. Pomiar pojedynczego VIN ma zupełnie inny koszt od złożonego filtrowania. W tle przyjęto dotychczasowe tempo importu i R2, ostatnią dobę żądań Workers × 30 oraz dodatkowe 5 mln ms CPU miesięcznie jako założenie. Dla kosztu importu liniowe przeliczenie daje około **58,02 mln zapisów na 30 dni**, czyli 8,02 USD powyżej puli. Dzisiejszy zapas wewnętrzny i zmienna wielkość paczek mogą ten wynik zmienić. Model nie sumuje drugi raz abonamentu Workers.

| Osób/dzień | Infrastruktura bez Apibary, USD/mies. | Z Apibarą, USD/mies. | Bez Apibary, USD/rok | Z Apibarą, USD/rok |
|---:|---:|---:|---:|---:|
| 100 | 18,02 | 88,02 | 216,20 | 1056,20 |
| 1000 | 18,02 | 88,02 | 216,23 | 1056,23 |
| 10 000 | 19,82 | 89,82 | 237,83 | 1077,83 |
| 100 000 | 66,95 | 136,95 | 803,39 | 1643,39 |

Jeśli automat zmieści się w puli zapisów i operacji A, obecna baza opłat przy oszacowanej powierzchni magazynu wyniosłaby około **75,50 USD/mies.** To alternatywny scenariusz, nie gwarantowana kwota. Gdy importowanie przyspieszy bez optymalizacji, kolejne 10 mln zapisów nad pulą to 10 USD. Przy 300 GB przechowywanych przez cały miesiąc miejsce R2 kosztowałoby około 4,35 USD. Kalkulacja obejmuje oddzielne wywołania licznika wizyt; zakłada się zmieszczenie czasu pracy i zapisów Durable Objects w puli. Długo utrzymywane pokoje Live, wzrost retencji logów lub intensywniejsza obsługa klientów mogą zmienić koszt. Przy 100 tys. wizyt dziennie nawet 0,1% wizyt z dwoma e-mailami daje około 6000 wiadomości na miesiąc. Bez zmiany planu bezpłatna usługa pocztowa nie obsłuży takiego wolumenu. Ewentualny Resend Pro to osobna decyzja, cennik od 20 USD/mies. Dostęp do galerii stron aukcyjnych, umowy z partnerami i limity ich usług są osobnymi ograniczeniami. [Model do ponownego przeliczenia](cost-scenarios.json) · [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)

**Decyzja techniczna.** Pozostawić gorący katalog w istniejącej D1, zdjęcia i historię w R2 i ograniczony do potwierdzonego przypadku ponowny odczyt po VIN. Obecny koszt i wielkość danych nie uzasadniają migracji portalu ani następnego abonamentu. Na progu 500 tys. archiwalnych rekordów trzeba wcześniej przebudować indeks archiwum, a nie przenosić zdjęcia lub dane klientów. Pierwszą próbę nowego indeksu wykonać w okolicy 100 tys., z porównaniem kompletności VIN/LOT, pamięci i liczby odczytów. Wprowadzać alert na prognozę nadwyżki i zaległość; ograniczenie dodatkowych zdjęć ma niższy priorytet niż publikacja ofert. Decyzję o wydawaniu ponad zaakceptowany budżet podejmuje właściciel.

