# REXBID V4 — pięć rzeczywistych kalkulacji i kontrola podatków

## Metoda / dowód

**Odczyty dynamiczne 2026-10-05, około 21:26–21:35 UTC (23:26–23:35 Europe/Warsaw).** Każdy BidCars otrzymał przez widoczny input cenę **10 000 USD**, a zaktualizowany wynik potwierdzono w DOM i na screenshotach. Nie składano ofert. RexBid również 10 000 USD przez „Własna cena”; niżej rzeczywiste rachunki V4. Materiały z pakietu właściciela pozostają historycznymi obserwacjami i nie trafiły do configu stawek.

BidCars: Rotterdam/NL, cło 10%, VAT 21% (wybrane wartości UI konkurenta, nie nasza kwalifikacja prawna). Dodatkowe hazardous/oversize opcje nie były zaznaczane. Etykieta kursu: 5 Oct 2026 11:00 PM, strefa tego kursu niezweryfikowana. **Kontrolne USD/PLN 3,9116; EUR/PLN 4,3855; USD/EUR 0,8919**. Nie są kursem celnym dla rzeczywistej odprawy.

**Zakresy nie są identyczne.** Partner nie potwierdził europejskiego portu i końcowego miejsca dostawy, profilu opłat i podatków. Nie nadaliśmy im Rotterdam tylko dla benchmarku. W BidCars brak osobno odczytanej akcyzy/dostawy PL w wyniku; to unknown, nie 0. Dlatego pełna różnica „pod dom” pozostaje NOT VERIFIED. Poniżej rozliczone znane składniki i źródło dużej różnicy między subtotal RexBid a szerszą sumą konkurenta.

Cennik REXBID: 610 lokalizacji, `rex-partner-v4-f0a67460b203286f`, USD, preferowany terminal, 4 auta standard / 3 ostrożny, per vehicle. Mnożnik tylko land. BEV +150 raz. Nazwa Elizabeth vs Newark konkurenta nie dowodzi równoważności dokładnego terminalu/usługi.

## Tesla Model 3 2024 — COPART 62674546

VIN `5YJ3E1EA3RF866005`. [REXBID — rzeczywista karta](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=5YJ3E1EA3RF866005&lot=62674546&platform=copart) · [BidCars](https://bid.cars/en/lot/1-62674546/2024-Tesla-MODEL-3-5YJ3E1EA3RF866005) · [screen REXBID](qa/v4-live-2026-10-05/tesla-desktop.jpg) · [screen BidCars](qa/v4-live-2026-10-05/bidcars-tesla.jpg).

Założenia REXBID: Sedan ×1, BEV (dane źródłowe). Preferowany terminal **Houston, TX**.

| Pozycja | REXBID standard | REXBID ostrożny | BidCars odczyt |
|---|---:|---:|---:|
| Zakup USD | 10000 | 10000 | 10000 |
| Opłaty aukcyjne USD | do potwierdzenia | do potwierdzenia | 1140 |
| Ląd USD | 205 | 205 | 285 |
| Morze USD | 675 | 850 | 1095 |
| Pakowanie BEV USD | 150 | 150 | brak osobnego odczytu; opcje additional niezaznaczone |
| Znany transport USD | 1030 | 1205 | 1380 |
| Znany zakup+transport USD | 11030 | 11205 | 11380 (bez fee) |
| Prowizja USD | unknown | unknown | 450 + VAT/Tax |
| Cło EUR | unknown | unknown | 1117 |
| VAT EUR | unknown | unknown | 2579 |
| Obsługa odprawy EUR | unknown | unknown | 500 |
| Akcyza / dostawa PL | unknown | unknown | brak osobnego odczytu |
| Pełna cena pod dom PLN | **incomplete — nie wyliczamy** | **incomplete — nie wyliczamy** | **69542**, szacowana suma konkurenta; zakres dostawy niezweryfikowany |

Różnica samych land+sea: **-500 USD / -1955.80 PLN** na kontrolnym FX (bez mieszania dopłaty BEV). REXBID znany subtotal standard to 11030 USD = **43144.95 PLN**, ale **nie jest ofertą końcową**. BidCars wartość celna/subtotal 1–4 = 12520 USD obejmuje już jego opłatę aukcyjną.

Kontrola arytmetyczna BidCars: `12520 USD × 3,9116 + (1117 + 2579 + 500) EUR × 4,3855 + 450 USD × 3,9116 × 1,23 = 69539.86 PLN`. Różnica względem UI 2.14 PLN. **23% VAT prowizji jest hipotezą rekonstrukcji**, a nie odczytaną osobną stawką: UI mówi tylko +VAT/Tax. Niewielka reszta może wynikać z zaokrąglonych EUR/kursów; nie dopisano jej do REXBID. Duże różnice subtotal vs suma konkurenta wynikają ze znanych dodatkowych fees/podatków i braku pełnego zakresu REXBID, nie z uzasadnienia arbitralnej korekty.

## BMW 330i 2026 — IAAI 45439613

VIN `3MW69CW09T8G26811`. [REXBID — rzeczywista karta](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=3MW69CW09T8G26811&lot=45439613&platform=iaai) · [BidCars](https://bid.cars/en/lot/0-45439613/2026-BMW-3-Series-3MW69CW09T8G26811) · [screen REXBID](qa/v4-live-2026-10-05/bmw-desktop.jpg) · [screen BidCars](qa/v4-live-2026-10-05/bidcars-bmw.jpg).

Założenia REXBID: Sedan ×1, ICE (dane źródłowe). Preferowany terminal **Los Angeles, CA**.

| Pozycja | REXBID standard | REXBID ostrożny | BidCars odczyt |
|---|---:|---:|---:|
| Zakup USD | 10000 | 10000 | 10000 |
| Opłaty aukcyjne USD | do potwierdzenia | do potwierdzenia | 1150 |
| Ląd USD | 220 | 220 | 320 |
| Morze USD | 1175 | 1515 | 1545 |
| Pakowanie BEV USD | nie dotyczy ICE | nie dotyczy ICE | brak osobnego odczytu; opcje additional niezaznaczone |
| Znany transport USD | 1395 | 1735 | 1865 |
| Znany zakup+transport USD | 11395 | 11735 | 11865 (bez fee) |
| Prowizja USD | unknown | unknown | 450 + VAT/Tax |
| Cło EUR | unknown | unknown | 1161 |
| VAT EUR | unknown | unknown | 2681 |
| Obsługa odprawy EUR | unknown | unknown | 500 |
| Akcyza / dostawa PL | unknown | unknown | brak osobnego odczytu |
| Pełna cena pod dom PLN | **incomplete — nie wyliczamy** | **incomplete — nie wyliczamy** | **72120**, szacowana suma konkurenta; zakres dostawy niezweryfikowany |

Różnica samych land+sea: **-470 USD / -1838.45 PLN** na kontrolnym FX (bez mieszania dopłaty BEV). REXBID znany subtotal standard to 11395 USD = **44572.68 PLN**, ale **nie jest ofertą końcową**. BidCars wartość celna/subtotal 1–4 = 13015 USD obejmuje już jego opłatę aukcyjną.

Kontrola arytmetyczna BidCars: `13015 USD × 3,9116 + (1161 + 2681 + 500) EUR × 4,3855 + 450 USD × 3,9116 × 1,23 = 72116.39 PLN`. Różnica względem UI 3.61 PLN. **23% VAT prowizji jest hipotezą rekonstrukcji**, a nie odczytaną osobną stawką: UI mówi tylko +VAT/Tax. Niewielka reszta może wynikać z zaokrąglonych EUR/kursów; nie dopisano jej do REXBID. Duże różnice subtotal vs suma konkurenta wynikają ze znanych dodatkowych fees/podatków i braku pełnego zakresu REXBID, nie z uzasadnienia arbitralnej korekty.

## Hyundai Elantra SEL 2023 — IAAI 45674212

VIN `5NPLS4AG3PH107017`. [REXBID — rzeczywista karta](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=5NPLS4AG3PH107017&lot=45674212&platform=iaai) · [BidCars](https://bid.cars/en/lot/0-45674212/2023-Hyundai-Elantra-5NPLS4AG3PH107017) · [screen REXBID](qa/v4-live-2026-10-05/elantra-desktop.jpg) · [screen BidCars](qa/v4-live-2026-10-05/bidcars-elantra.jpg).

Założenia REXBID: Sedan ×1, ICE (dane źródłowe). Preferowany terminal **Savannah, GA**.

| Pozycja | REXBID standard | REXBID ostrożny | BidCars odczyt |
|---|---:|---:|---:|
| Zakup USD | 10000 | 10000 | 10000 |
| Opłaty aukcyjne USD | do potwierdzenia | do potwierdzenia | 1150 |
| Ląd USD | 415 | 415 | 520 |
| Morze USD | 575 | 650 | 995 |
| Pakowanie BEV USD | nie dotyczy ICE | nie dotyczy ICE | brak osobnego odczytu; opcje additional niezaznaczone |
| Znany transport USD | 990 | 1065 | 1515 |
| Znany zakup+transport USD | 10990 | 11065 | 11515 (bez fee) |
| Prowizja USD | unknown | unknown | 450 + VAT/Tax |
| Cło EUR | unknown | unknown | 1130 |
| VAT EUR | unknown | unknown | 2609 |
| Obsługa odprawy EUR | unknown | unknown | 500 |
| Akcyza / dostawa PL | unknown | unknown | brak osobnego odczytu |
| Pełna cena pod dom PLN | **incomplete — nie wyliczamy** | **incomplete — nie wyliczamy** | **70297**, szacowana suma konkurenta; zakres dostawy niezweryfikowany |

Różnica samych land+sea: **-525 USD / -2053.59 PLN** na kontrolnym FX (bez mieszania dopłaty BEV). REXBID znany subtotal standard to 10990 USD = **42988.48 PLN**, ale **nie jest ofertą końcową**. BidCars wartość celna/subtotal 1–4 = 12665 USD obejmuje już jego opłatę aukcyjną.

Kontrola arytmetyczna BidCars: `12665 USD × 3,9116 + (1130 + 2609 + 500) EUR × 4,3855 + 450 USD × 3,9116 × 1,23 = 70295.62 PLN`. Różnica względem UI 1.38 PLN. **23% VAT prowizji jest hipotezą rekonstrukcji**, a nie odczytaną osobną stawką: UI mówi tylko +VAT/Tax. Niewielka reszta może wynikać z zaokrąglonych EUR/kursów; nie dopisano jej do REXBID. Duże różnice subtotal vs suma konkurenta wynikają ze znanych dodatkowych fees/podatków i braku pełnego zakresu REXBID, nie z uzasadnienia arbitralnej korekty.

## Toyota Prius L Eco 2021 — COPART 65595416

VIN `JTDKAMFU4M3135817`. [REXBID — rzeczywista karta](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=JTDKAMFU4M3135817&lot=65595416&platform=copart) · [BidCars](https://bid.cars/en/lot/1-65595416/2021-Toyota-Prius-JTDKAMFU4M3135817) · [screen REXBID](qa/v4-live-2026-10-05/prius-desktop.jpg) · [screen BidCars](qa/v4-live-2026-10-05/bidcars-prius.jpg).

Założenia REXBID: HEV; kontrolnie ręcznie Sedan ×1. Źródłowe Hatchback nie dowodzi klasy przewoźnika; dopłata HEV nadal unknown. Preferowany terminal **Los Angeles, CA**.

| Pozycja | REXBID standard | REXBID ostrożny | BidCars odczyt |
|---|---:|---:|---:|
| Zakup USD | 10000 | 10000 | 10000 |
| Opłaty aukcyjne USD | do potwierdzenia | do potwierdzenia | 1140 |
| Ląd USD | 270 | 270 | 340 |
| Morze USD | 1175 | 1515 | 1545 |
| Pakowanie BEV USD | unknown — HEV | unknown — HEV | brak osobnego odczytu; opcje additional niezaznaczone |
| Znany transport USD | 1445 + unknown | 1785 + unknown | 1885 |
| Znany zakup+transport USD | 11445 | 11785 | 11885 (bez fee) |
| Prowizja USD | unknown | unknown | 450 + VAT/Tax |
| Cło EUR | unknown | unknown | 1162 |
| VAT EUR | unknown | unknown | 2684 |
| Obsługa odprawy EUR | unknown | unknown | 500 |
| Akcyza / dostawa PL | unknown | unknown | brak osobnego odczytu |
| Pełna cena pod dom PLN | **incomplete — nie wyliczamy** | **incomplete — nie wyliczamy** | **72172**, szacowana suma konkurenta; zakres dostawy niezweryfikowany |

Różnica samych land+sea: **-440 USD / -1721.10 PLN** na kontrolnym FX (bez mieszania dopłaty BEV). REXBID znany subtotal standard to 11445 USD = **44768.26 PLN**, ale **nie jest ofertą końcową**. BidCars wartość celna/subtotal 1–4 = 13025 USD obejmuje już jego opłatę aukcyjną.

Kontrola arytmetyczna BidCars: `13025 USD × 3,9116 + (1162 + 2684 + 500) EUR × 4,3855 + 450 USD × 3,9116 × 1,23 = 72173.04 PLN`. Różnica względem UI -1.04 PLN. **23% VAT prowizji jest hipotezą rekonstrukcji**, a nie odczytaną osobną stawką: UI mówi tylko +VAT/Tax. Niewielka reszta może wynikać z zaokrąglonych EUR/kursów; nie dopisano jej do REXBID. Duże różnice subtotal vs suma konkurenta wynikają ze znanych dodatkowych fees/podatków i braku pełnego zakresu REXBID, nie z uzasadnienia arbitralnej korekty.

## Volkswagen Atlas SE 2021 — COPART 61699166

VIN `1V2KR2CA8MC555442`. [REXBID — rzeczywista karta](https://rexbid-auth-test.tedn828.workers.dev/car.html?vin=1V2KR2CA8MC555442&lot=61699166&platform=copart) · [BidCars](https://bid.cars/en/lot/1-61699166/2021-Volkswagen-Atlas-1V2KR2CA8MC555442) · [screen REXBID](qa/v4-live-2026-10-05/atlas-desktop.jpg) · [screen BidCars](qa/v4-live-2026-10-05/bidcars-atlas.jpg).

Założenia REXBID: ICE; kontrolnie ręcznie SUV Standard ×1. Samo SUV nie dowodzi klasy Standard vs Large. Preferowany terminal **Elizabeth, NJ**.

| Pozycja | REXBID standard | REXBID ostrożny | BidCars odczyt |
|---|---:|---:|---:|
| Zakup USD | 10000 | 10000 | 10000 |
| Opłaty aukcyjne USD | do potwierdzenia | do potwierdzenia | 1140 |
| Ląd USD | 405 | 405 | 470 |
| Morze USD | 575 | 650 | 995 |
| Pakowanie BEV USD | nie dotyczy ICE | nie dotyczy ICE | brak osobnego odczytu; opcje additional niezaznaczone |
| Znany transport USD | 980 | 1055 | 1465 |
| Znany zakup+transport USD | 10980 | 11055 | 11465 (bez fee) |
| Prowizja USD | unknown | unknown | 450 + VAT/Tax |
| Cło EUR | unknown | unknown | 1124 |
| VAT EUR | unknown | unknown | 2597 |
| Obsługa odprawy EUR | unknown | unknown | 500 |
| Akcyza / dostawa PL | unknown | unknown | brak osobnego odczytu |
| Pełna cena pod dom PLN | **incomplete — nie wyliczamy** | **incomplete — nie wyliczamy** | **69985**, szacowana suma konkurenta; zakres dostawy niezweryfikowany |

Różnica samych land+sea: **-485 USD / -1897.13 PLN** na kontrolnym FX (bez mieszania dopłaty BEV). REXBID znany subtotal standard to 10980 USD = **42949.37 PLN**, ale **nie jest ofertą końcową**. BidCars wartość celna/subtotal 1–4 = 12605 USD obejmuje już jego opłatę aukcyjną.

Kontrola arytmetyczna BidCars: `12605 USD × 3,9116 + (1124 + 2597 + 500) EUR × 4,3855 + 450 USD × 3,9116 × 1,23 = 69981.98 PLN`. Różnica względem UI 3.02 PLN. **23% VAT prowizji jest hipotezą rekonstrukcji**, a nie odczytaną osobną stawką: UI mówi tylko +VAT/Tax. Niewielka reszta może wynikać z zaokrąglonych EUR/kursów; nie dopisano jej do REXBID. Duże różnice subtotal vs suma konkurenta wynikają ze znanych dodatkowych fees/podatków i braku pełnego zakresu REXBID, nie z uzasadnienia arbitralnej korekty.

## Klasy / dodatki / alternatywy

- Tesla: 205 + 675 + 150 = **1030 USD**; ostrożny 205 + 850 +150 = **1205 USD**. BEV nie dzieli się przez 4 i nie mnoży przez klasę.
- Atlas przy **jawnej** klasie SUV Large ×1,5: land607,50, morze575/650, transport1182,50/1257,50. To wariant do potwierdzenia u partnera, nie automatyczna kwalifikacja.
- Prius przy manualnym Sedan: land270 + morze1175/1515, **dopłata HEV nieznana**. Brak podstaw do naliczenia BEV150 albo deklaracji potwierdzonego transportu all-in.
- Zakup jednego auta nie oznacza kontenera na jedno auto. Standard4/ostrożny3 są wariantami wspólnego załadunku wymagającymi możliwości fizycznego załadunku.

## Pomocniczy DreamBid — rzeczywista Tesla

[DreamBid](https://dreambid.pl/pl/calculator), to samo VIN/LOT, input10000USD. [Screen](qa/v4-live-2026-10-05/dreambid-tesla.jpg). Odczyt: land325, sea995, auction1150, zaznaczony EV/hybrid150, wartość celna12620USD; cło1126EUR, VAT2600EUR, agency550EUR, prowizja2460PLN brutto, NL→Mazowieckie2400PLN; wynik **72975PLN**. Tłumaczenia/opinia niezaznaczone. Jest to inny zakres usług i procedura niż niepełne REXBID. Nie przenosimy automatycznej reguły konkurenta dla hybryd na cennik partnera.

## Podatki — kontrola oficjalnych źródeł, stan 2026-10-05

- [Rozporządzenie UE 2026/1455](https://eur-lex.europa.eu/eli/reg/2026/1455/oj/eng): art.1/załącznik obejmujący dział87, warunki art.6 pochodzenia i bezpośredniego transportu oraz stosowanie od1.07.2026. Sama aukcja w USA/VIN nie dowodzi spełnienia warunków 0%. Przed odprawą sprawdzić obowiązującą klasyfikację i możliwe ograniczenia/zawieszenia.
- [Komisja — pochodzenie niepreferencyjne](https://taxation-customs.ec.europa.eu/customs/rules-origin-goods/non-preferential-rules-origin_en). Dokumentów pochodzenia pięciu aut nie uzyskano; nie nadano im automatycznie 0% ani10%.
- [TARIC](https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en): indywidualna klasyfikacja CN/procedura pięciu aut **NOT VERIFIED**. To blokuje automatyczną kwalifikację cła, nie działanie transportu.
- [MF — akcyza, stawki](https://www.podatki.gov.pl/akcyza/stawki-podatkowe): zależność od pojemności i właściwej kategorii napędu; standard3,1/18,6%, właściwe warianty HEV1,55/9,3%. [Zwolnienia](https://www.podatki.gov.pl/akcyza/zwolnienia-i-zwroty): BEV/PHEV mają warunki; nie wystarczy marketingowa etykieta hybrid. Dokumentów i kwalifikacji konkretnych aut nie potwierdzono.
- [MF — VAT](https://www.podatki.gov.pl/podatki-firmowe/vat/stawki-i-limity): nie kopiujemy NL21% do polskiej ścieżki. Kurs prezentacyjny nie zastępuje kursu podatkowo-celnego.

Diagnostycznie różnica10% vs0% przy samej podstawie10000USD to1000USD cła =3911,60PLN na kontrolnym kursie, przed wpływem na kolejne podstawy podatkowe. To nie kwota do automatycznego odjęcia w pięciu powyższych autach.

**Odbiór benchmarku:** pięć dynamicznych odczytów i pięć REXBID subtotal PASS. Równość pełnego zakresu/ceny końcowej **NOT VERIFIED — wymagane rzeczywiste warunki partnera i dokumenty, nie kolejny sztuczny współczynnik**. Żadnej kwoty konkurencji nie użyto jako taryfy partnera.
