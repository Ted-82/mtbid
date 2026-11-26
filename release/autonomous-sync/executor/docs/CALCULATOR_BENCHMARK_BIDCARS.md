# Porównanie kalkulatora Rex.Bid z benchmarkiem BidCars

**Data i zakres:** 2026-10-04. Materiał wejściowy: screenshoty przekazane przez właściciela w `data/partner/RexBid_Calculator_V4_2026-10-04/references/ux/`. Screenshot to obserwacja konkretnego auta i chwili; nie jest taryfą partnera Rex.Bid ani źródłem aktualnych stawek.

## Honda CR-V — LOT 45369972, IAAI Portland–Gorham, aktualna oferta

Założenie porównania to dokładnie widoczny na benchmarku tryb aktualnej oferty: cena zakupu 1 550 USD. Nie porównujemy do osobnego trybu prognozy 54 582–56 833 PLN.

| Składnik | Screenshot BidCars | Rex.Bid V4 | Interpretacja |
|---|---:|---:|---|
| Cena zakupu | 1 550 USD | 1 550 USD (wejście porównawcze) | Ta sama wartość wejściowa; aktualna oferta nie oznacza ceny sprzedaży. |
| Opłaty aukcyjne | 550 USD | Do potwierdzenia | Rex.Bid nie ma potwierdzonego profilu opłat dla tego konta/aukcji. Nie kopiujemy 550 USD. |
| Transport lądowy USA | 525 USD | 450 USD | Stawka partnera dla Portland–Gorham, preferowany terminal Elizabeth. |
| Fracht morski | 995 USD | 575 USD standard / 650 USD ostrożny | Stawka Rex.Bid per pojazd dla 4 / 3 aut w 40'HC; nie jest dzielona ponownie. |
| Transport razem | 1 520 USD | 1 025 / 1 100 USD | Rex.Bid niższy o 495 / 420 USD w samych dwóch transportowych pozycjach. Zakres usługi może się różnić. |
| Suma zakupu + aukcja + land + sea | 3 620 USD | 2 575 / 2 650 USD znanych pozycji, plus nieznana opłata aukcyjna | Rex.Bid subtotal pomija unknown fee i nie jest pełnym porównaniem całego zakupu. |
| Prowizja/usługa | 450 USD osobno na screenie | Niepotwierdzona / do potwierdzenia | Nie doliczamy ani nie zakładamy, czy zawiera VAT, bez potwierdzenia zakresu Rex.Bid. |
| Cło, VAT, obsługa, dostawa | Screen pokazuje m.in. Rotterdam, cło 10%, VAT 21%, 500 EUR handling i 2 500 PLN dostawy | Do potwierdzenia | Nie przenosimy kraju odprawy, procentów ani cen konkurenta do modelu Rex.Bid. |
| Wynik końcowy | 25 835 PLN na screenie | Brak kompletnej ceny pod dom | Brak zgodnej podstawy podatkowej, kosztów importu, FX i dostawy; porównanie końcowych sum byłoby mylące. |

Kwoty transportowe Rex.Bid pochodzą z wersjonowanych tabel partnera: Portland–Gorham ma preferencję Elizabeth. Nie wybieramy najtańszej alternatywy i nie nazywamy terminalu portem docelowym. Screenshot nie wskazuje potwierdzonego napędu tej Hondy, więc nie doliczamy 150 USD EV.

## Dlaczego wyników nie dopasowujemy

- BidCars wyświetla usługę/odprawę według własnej ścieżki, taryf, portu i profilu. Rex.Bid ma potwierdzone robocze stawki partnera dla lądu i morza, ale nie ma potwierdzonych opłat aukcyjnych tego konta ani pełnej oferty importowej/dostawy.
- BidCars pokazuje składniki, których Rex.Bid jeszcze nie ma jako zatwierdzonych stawek. Pominięcie ich z wyniku Rex.Bid oznaczamy jako `do potwierdzenia`, a nie jako 0 USD.
- Kursy, podstawa celna, VAT, akcyza i zawartość usług nie są udowodnione jako porównywalne. USD/EUR/PLN nie sumujemy bez jawnego kursu, źródła i daty.
- Drugi screenshot to odrębny tryb prognozy; nie porównujemy go z aktualną ofertą 1 550 USD i nie dodajemy fikcyjnej prognozy do Rex.Bid.

Screenshoty służą do kontroli czytelności i sensowności rozpiski, nie do kopiowania UI, brandingu, stawek ani metodologii konkurenta.

## 25.10.2026 — Mercedes-Benz GLB, Copart LOT 70325616

Materiał: cztery screenshoty właściciela z 25.10.2026 (171120, 171147, 171209, 171251). To porównanie widocznych liczb, nie nowy cennik REXBID ani potwierdzenie zastosowania podatków. Nie pobierano nowych danych aukcyjnych.

| Widoczny składnik | Kwota na screenshotach |
|---|---:|
| Cena pojazdu / finalna oferta | 11 400 USD |
| Opłaty aukcyjne (850 + 160 + 95 + 15 + 20) | 1 140 USD |
| Dostawa do portu USA | 365 USD |
| Fracht | 995 USD |
| Suma pozycji 1–4 | 13 900 USD |
| Prowizja oznaczona „+VAT” | 450 USD |
| Cło | 1 242 EUR |
| VAT | 2 596 EUR |
| Agencja celna i rozładunek | 500 EUR |
| Suma odprawy | 4 338 EUR |
| Dostawa | 2 500 PLN |
| Tłumaczenia | 260 PLN |
| Wyświetlony wynik końcowy | 78 539 PLN |

Przy widocznych kursach USD/PLN 3,9247 i EUR/PLN 4,3917 proste zsumowanie wymienionych kwot daje **78 130,64 PLN**, czyli **408,36 PLN mniej** niż wyświetlony wynik. Nie ustalono, czy różnica wynika z opodatkowania prowizji, niewidocznych składników, zaokrągleń lub innych założeń. Nie dodano fikcyjnej opłaty w celu wyrównania wyników.

Na screenshotach fracht wskazuje Rotterdam, a wybór VAT opisany jest jako 19% (Bremerhaven); zakres faktycznej trasy i odprawy wymaga zgodnego porównania. Podstawa akcyzy 0 PLN na ekranie nie potwierdza zwolnienia tego pojazdu. Nie oceniano tutaj prawidłowości podatkowej kalkulacji konkurenta.

Wniosek dla REXBID: upraszczamy główny widok i eksponujemy jeden wynik. Kwota w PLN z dostawą pojawia się dopiero po uzupełnieniu wymaganych składników; pozostaje szacunkiem według wpisanych kwot. Transport V4 zachowuje potwierdzone źródło i wersję. Do porównania końcowych cen potrzebne są te same: auto, cena zakupu, profil opłat aukcyjnych, zakres frachtu i obsługi, miejsce odprawy, podatki, kursy oraz adres dostawy. Samo podobieństwo cen konkurenta nie potwierdza tych danych.
