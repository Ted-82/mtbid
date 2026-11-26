# Rex.Bid — analiza cennika partnera / CargoLoop
Data opracowania: 2026-10-04
Wersja danych: `partner-rates-d8167ad4ef8bce56`
Stan: materiały zapisane do dalszej integracji; bez zmian w GitHubie, D1 i produkcji.

## 1. Źródła i granice analizy
Zachowano oryginalny Markdown z 610 pozycjami, 2 fotografie monitora, 9 kolorowych zrzutów tabeli lądowej, 1 zrzut tabeli morskiej oraz tekst tabeli morskiej przekazanej w rozmowie. Oryginały są w `sources/`; ich hashe są w `audit/source_manifest.json`.

Kwoty i nazwy wszystkich 610 rekordów pochodzą bezstratnie z wcześniejszego pliku `Wklejony kod markdown(20260930-082748).md`. Pierwsza linia ABBOTSFORD to rekord, NIE nagłówek. Nie zgubiono jej podczas importu.
Nowe zrzuty posłużyły do odczytu kolorowych preferencji routingu, fotografie do odczytu nagłówków/reguł i sprawdzenia widocznych cen.
Nie twierdzimy, że wszystkie 2942 kwoty ponownie przepisano z obrazów. Nie użyto OCR.
Stwierdzone sprzeczności kwot zapisano osobno, nie rozstrzygano ich po cichu.

## 2. Kolumny terminali — potwierdzone w obu fotografiach
| Alias istniejący | ID stabilny | Nazwa źródłowa |
|---|---|---|
| route_1 | savannah_ga | Savannah, GA |
| route_2 | elizabeth_nj | Elizabeth, NJ |
| route_3 | houston_tx | Houston, TX |
| route_4 | los_angeles_ca | Los Angeles, CA |
| route_5 | indianapolis_in | Indianapolis, IN |
| route_6 | montreal_qc | Montreal, QC |

To są terminale/punkty wyjściowe tabeli. Nie każdy taki identyfikator oznacza bezpośredni port morski. Nie zmieniamy Indianapolis na Chicago ani Montreal na ogólną „Kanadę”.
Zachowujemy aliasy route_1–route_6 dla zgodności z istniejącym kalkulatorem.

## 3. Preferred routing — podstawowa zmiana w kalkulatorze
Na fotografii znajduje się zdanie: „Color coded terminals indicated preferred routing.”
Kolorowe obramowanie wskazuje trasę preferowaną przez CargoLoop. To NIE oznaczenie najniższej kwoty.

Dla wszystkich 610 rekordów odczytano preferowany terminal z obramowań 9 zrzutów. Odczyt oparto na dokładnych kolorach, położeniu wiersza i kolejności oryginalnej tabeli. W nakładających się wierszach nie znaleziono konfliktów preferencji. Dane dowodowe (plik obrazu, zakres pikseli w pionie, kolor i liczba pikseli obramowania) są w `audit/preferred_routing_evidence.json`.

Podział preferencji:
- Savannah: 158
- Elizabeth: 126
- Houston: 83
- Los Angeles: 116
- Indianapolis: 102
- Montreal: 25

Wariant domyślny kalkulatora: dokładnie dopasowana lokalizacja → preferowany terminal → stawka lądowa tego terminalu → fracht tego samego terminalu.
Nie wybieramy osobno najtańszego terminalu dla scenariusza 3 i 4 aut. Oba używają preferencji partnera, dopóki nie zatwierdzono innej trasy.
Alternatywy wolno pokazać jako porównanie, a nie jako automatycznie zatwierdzoną logistykę.

Dla 69 z 610 rekordów preferowana suma ląd + fracht (mnożnik lądu 1, 4 auta) jest większa od matematycznego minimum. To dowód, że dotychczasowe `min(land + sea)` zmienia decyzję partnera. Obliczenie dotyczy zachowanej bazy MD i znanego bloku frachtu, nie całkowitego importu.

## 4. Reguły transportu lądowego z fotografii
Nagłówek: `Local Transportation Prices`, `Valid from October 1st, 2026`.

| Klasa źródłowa | Mnożnik stawki lądowej |
|---|---:|
| Sedan; SUV (Standard); Van (Standard); MUV (Side-by-side); Golf cart; Snowmobile; Jet Ski | 1.0 |
| Motorcycle; ATV; Lawn Mower | 0.8 |
| SUV (Large); Pickup Truck (Standard); Pickup Truck (Large) | 1.5 |
| Van (Large); Pickup Truck (Oversized) | 2.0 |
| All other cargo types | wycena indywidualna |

Mnożnik dotyczy TYLKO lądu. Nie mnożymy nim frachtu ani wszystkich kosztów importu.
Źródła nie definiują progów długości/wagi dla Standard/Large/Oversized. Nie wolno ich wymyślić ani przydzielać po samym paliwie/nazwie modelu.
Fotografie nie podają dopłaty EV. Aktualizacja 2026-10-04: właściciel podał dodatkową opłatę 150 USD za pakowanie każdego BEV. Osobne źródło: sources/OWNER_EV_PACKING_2026-10-04.md. Reguła dotyczy pakowania, nie lądu; dla hybryd zakres pozostaje niepotwierdzony. Nie rozstrzyga innych dopłat ani dopuszczalności przewozu uszkodzonej baterii.

## 5. Fracht morski
Fotografia pokazuje `Per Unit`, a pełny zrzut etykiety `1 car`, `2 cars`, `3 cars`, `4 cars` w `40'HC`. Zapisujemy kwoty jako stawki NA POJAZD, zależne od liczby aut w kontenerze.

| Aut w 40'HC | Savannah | Elizabeth | Houston | Los Angeles | Indianapolis | Montreal |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1850 | 1850 | 2400 | 4400 | 2400 | 4200 |
| 2 | 950 | 950 | 1250 | 2250 | 1250 | 2100 |
| 3 | 650 | 650 | 850 | 1515 | 850 | 1485 |
| 4 | 575 | 575 | 675 | 1175 | 675 | 1050 |

Waluta robocza: USD, zgodnie z wcześniejszym ustaleniem projektu. Sam znak $ nie rozstrzyga ISO USD/CAD; tę proweniencję zachowano w metadata.
Źródła nie pokazują portu docelowego, pełnego zakresu opłat, ubezpieczenia, reguł załadunku ani podatków.
Nie dopisujemy Rotterdamu ani innego portu. Nie wyprowadzamy z tych zdjęć VAT, cła, akcyzy ani ceny dostawy w Polsce.
3 i 4 auta to scenariusze, nie gwarancja pojemności dla dowolnego gabarytu i nie uniwersalny przedział minimum–maksimum ceny.

Na fotografii morskiej poniżej znanego bloku widać dodatkowe 5 wierszy. Ich lewe etykiety są ucięte. Kwoty zachowano jako nieaktywne w `audit/unidentified_ocean_rows.json`; NIE zgadywano klas ani typów kontenerów.

## 6. Rozbieżność wersji cennika
Copart `ALBANY 12205` oraz IAAI `Albany 12303`, kolumna Elizabeth:
- Markdown oraz zrzut 144117: 310 USD.
- Fotografia 120158 z nagłówkiem 01.10.2026: 325 USD.

Zachowano bazowe 310 USD, alternatywne 325 USD i status `source_conflict`. Żadna z tych dwóch wartości nie jest arbitralnie uznana za ostateczną.
Data 01.10.2026 została przypisana regułom z fotografii, nie bezwarunkowo starszym kwotom z MD ani stawkom morskim.
Dla tych dwóch rekordów integracja powinna wymagać potwierdzenia lub jawnej decyzji o wersji.

## 7. Jakość danych
610 rekordów: Copart 252, IAAI 202, Manheim 90, Adesa 66.
USA 585, Kanada 25.
718 pustych komórek tras na 3660: zachowane jako null. 2942 niepuste stawki.
Brak osobnej kolumny ZIP w 14 rekordach; brak miasta w 14.
10 przypadków różnicy między ZIP wpisanym w nazwę placu a osobną kolumną ZIP. Zachowano obie informacje.
Brak kolizji znormalizowanych kluczy platforma + pełna lokalizacja.
Wspólne ZIP-y i miasta mogą dawać kilka placów; nie wolno wybierać losowo ani mieszać platform.

## 8. Przykłady arytmetyczne
| Lokalizacja | Preferowany terminal | Ląd bazowy | Morze 4 | Ląd+morze 4 | Ląd+morze 3 |
|---|---|---:|---:|---:|---:|
| Houston, Copart | Houston | 205 | 675 | 880 | 1055 |
| Chicago North, Copart | Indianapolis | 295 | 675 | 970 | 1145 |
| Los Angeles, Copart | Los Angeles | 220 | 1175 | 1395 | 1735 |
| Portland–Gorham ME, IAAI | Elizabeth | 450 | 575 | 1025 | 1100 |
| Anchorage, IAAI | Los Angeles | 3050 | 1175 | 4225 | 4565 |
| Denver Central, Copart | Savannah | 875 | 575 | 1450 | 1525 |

Są to tylko sumy transportu dla wskazanego scenariusza i mnożnika 1.0.
Dla standardowego pickupa z Houston sam ląd: 205 × 1.5 = 307.50 USD. Dodanie frachtu 675 dałoby 982.50 USD, ALE fracht 4-autowy można zastosować dopiero po potwierdzeniu dopuszczalnego załadunku tego pojazdu.
Nie dopasowujemy tych wartości sztucznie do kalkulatora BidCars.

## 9. Pliki i aktualizacja
- `Cennik_transportu_RexBid_2026-10-04_EV.xlsx`: 10 zakładek, filtry, preferencje jako osobne pola, przykłady i porównanie liczone formułami.
- `data/land_rates.csv`: pełne 610 rekordów; sześć kwot i osobny `preferred_terminal_id`.
- `data/sea_rates.csv`: 24 stawki, na pojazd.
- `data/terminals.csv`: stabilne terminale i aliasy.
- `data/land_multipliers.csv`: reguły gabarytowe, tylko ląd.
- `data/surcharges.csv`: dopłaty jednostkowe; obecnie EV 150 USD/auto, ze źródłem i statusem.
- `data/metadata.json`: waluta, data/reguły, status i braki.
- `generated/partner-rates.review.json`: dane dla integracji, nie automatyczny deploy.
- `tools/build-partner-rates.cjs`: generator bez zewnętrznych zależności.
- `audit/`: konflikty, dowody preferencji, dane jakości i hashe źródeł.
- `sources/`: oryginały.

### Procedura kolejnej zmiany cennika
1. Zachować ten pakiet jako poprzednią wersję.
2. Zmienić konkretne kwoty w arkuszu albo CSV; nie zmieniać ID terminali/rekordów.
3. Oddzielnie zmienić `preferred_terminal_id`, jeśli partner zmieni trasę.
4. Ustawić potwierdzoną datę obowiązywania oraz nowe źródło.
5. Przekazać zmieniony XLSX do ponownego eksportu LUB zmienić odpowiednie CSV w `data/`.
6. Uruchomić generator i sprawdzenie:
   `node tools/build-partner-rates.cjs`
   `node tools/build-partner-rates.cjs --check`
7. Obejrzeć różnice kwot/preferencji i przetestować istniejący kalkulator na stagingu.
8. Dopiero po akceptacji opublikować nową wersję rate setu; zachować możliwość powrotu.

Ważne: generator czyta CSV, nie XLSX. Samo zapisanie arkusza nie aktualizuje strony ani JSON. Przykłady w arkuszu przeliczają się z danych arkusza.
Testy `tools/validate-package.test.cjs` odnoszą się do TEGO historycznego zestawu. Po świadomej aktualizacji cen konkretne asercje należy porównać z nowym źródłem, a nie zmieniać je bez weryfikacji.

## 10. Wynik kontroli pakietu
Import: 610 rekordów, 24 stawki morskie, 16 klas.
Preferencje: 610 odczytanych, brak nierozstrzygniętych obramowań.
Generator i jego `--check`: PASS.
Testy referencyjne pakietu: 14/14 PASS. To nie są testy całego repozytorium Rex.Bid.
Arkusz: sprawdzone formuły przykładów i kontrola braku błędów #REF/#VALUE/#N/A.
Nie wykonano requestów Apibara, migracji, commitu ani deployu.

## 11. Aktualizacja EV — 04.10.2026
Wersja rozszerzona zawiera osobne data/surcharges.csv i zakładkę Doplaty_EV. Mnożnik gabarytowy dotyczy wyłącznie lądu. Warianty 3/4 auta nie dzielą pakowania; 150 USD dodaje się raz do każdego BEV. Cztery BEV = 600 USD dopłaty łącznie.

Przykład kontrolny Houston BEV, klasa bazowa, założony zgodny wariant załadunku: 205+675+150=1030 USD (4 auta); 205+850+150=1205 USD (3 auta). To transport przed ewentualnymi podatkami i innymi usługami, nie cena pod dom.

Nie oznaczać hybryd jako BEV. PHEV/HEV/FCEV wymagają potwierdzenia reguły dopłaty. Pakowanie ma przejść przez model podatkowy właściwego importu; nie dopisywać go mechanicznie dopiero po naliczeniu wszystkich podatków. Sam pakiet nie oblicza cła/VAT/akcyzy.

Kwoty i preferencje istniejących 610 wierszy nie zostały zmienione. Konflikty Albany nadal wymagają rozstrzygnięcia. Nie uznawać całego pakietu za potwierdzoną ofertę door-to-door.
