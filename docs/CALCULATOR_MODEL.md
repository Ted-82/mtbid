# Rex.Bid — model kalkulatora importu USA → Polska

**Stan researchu: 2026-09-26**  
**Zakres:** model i źródła; żadna stawka ani formuła produkcyjnego kalkulatora nie została zmieniona.

## Decyzja na tę fazę

Można przejść do projektowania warstwy kalkulacji i konfiguracji stawek, ale **nie do publikacji kompletnego „kosztu całkowitego” jako wiarygodnej liczby**. Do tego brakuje aktualnego amerykańskiego harmonogramu opłat IAA dla konkretnego rodzaju konta, ofert przewozowych i decyzji agenta celnego dotyczących klasyfikacji, pochodzenia oraz podstawy. Kalkulator powinien umieć zwrócić stan niekompletny i pokazać jawne pozycje konfigurowalne, zamiast dopisywać domyślne ceny.

Obecny kalkulator w public/car.html pozostaje bez zmian. Jego domyślne USD→PLN, prowizja, transport, fracht, cło i akcyza są założeniami edytowalnymi, nie aktualnymi stawkami urzędowymi ani ofertą przewoźnika. Obecna matematyka nie jest w tym dokumencie zatwierdzona jako podstawa prawna.

## Stany danych kalkulatora

Każdy wiersz wyliczenia ma posiadać co najmniej:

- id, label, amount, currency, source_kind
- source_url_or_quote_id, checked_at, effective_from, effective_to
- status, assumptions, included_in_customs_value?, included_in_vat_base?

Dozwolone statusy: confirmed (potwierdzone dla danych wejściowych i zakresu), configurable (wymaga profilu/wyboru lub oferty), estimated (jawny szacunek, którego nie wolno przedstawiać jako opłaty potwierdzonej). Brak danych to null/stan niekompletny, nie zero. effective_from jest wymagane dla stawek; data sprawdzenia sama w sobie nie oznacza daty wejścia w życie.

## 1. Copart USA — potwierdzone opłaty i ograniczenia

Źródło główne: [Copart US Member Fees](https://www.copart.com/content/us/en/member-fees), sprawdzone **2026-09-26**. Strona publikuje kilka tabel Standard Pricing; widoczna kwota zależy od grupy tytułu (clean/non-clean), secure/unsecure payment oraz właściwego cennika. Copart wskazuje też standard/heavy vehicle i możliwe dodatkowe reguły. Nie wolno wybrać jednej tabeli dla wszystkich klientów i samochodów.

### Przykładowy profil opłat: standard vehicle, clean title, secured payment

To jawnie wybrany wariant z aktualnej strony opłat Copart, a nie uniwersalna obietnica ceny. Opłata bidding fee jest tiered. Dla cen testowych, przy Pre-Bid online:

| Cena wygranej oferty | Bidding fee: clean/secured | Pre-Bid virtual fee | Gate fee | Environmental fee w tej tabeli | Suma tych czterech pozycji |
|---:|---:|---:|---:|---:|---:|
| $1,000 | $325 | $69 | $79 | $0 | **$473** |
| $5,000 | $750 | $99 | $79 | $0 | **$928** |
| $10,000 | $850 | $129 | $79 | $0 | **$1,058** |
| $25,000 | 7.25% = $1,812.50 | $129 | $79 | $0 | **$2,020.50** |
| $50,000 | 7.25% = $3,625 | $129 | $79 | $0 | **$3,833** |

Wartości wyliczono ręcznie z aktualnych progów Copart, niezależnie od funkcji Rex.Bid. Virtual bid fee zależy również od Pre-Bid vs Live Bid. Secure methods wymienione przez Copart obejmują m.in. debit card, wire transfer i MoneyGram; credit card, Apple Pay, Google Pay i PayPal są wymienione jako unsecured i mają osobną, wyższą tabelę.

### Przykładowy profil: standard vehicle, non-clean title, secured payment

Copart publikuje osobną tabelę non-clean. W jej widocznym wariancie opłata gate wynosi $95, a environmental $15. Przykłady poniżej używają secured bidding fee i Pre-Bid virtual fee z tej części tabeli:

| Cena oferty | Bidding fee: non-clean/secured | Pre-Bid virtual fee | Gate | Environmental | Suma |
|---:|---:|---:|---:|---:|---:|
| $1,000 | $375 | $75 | $95 | $15 | **$560** |
| $5,000 | $775 | $110 | $95 | $15 | **$995** |
| $10,000 | $1,000 | $140 | $95 | $15 | **$1,250** |
| $25,000 | 7.50% = $1,875 | $140 | $95 | $15 | **$2,125** |
| $50,000 | 7.50% = $3,750 | $140 | $95 | $15 | **$4,000** |

Non-clean nie powinno być wywnioskowane z samego słowa Salvage w Rex.Bid bez mapowania dokładnego Copart title group dla konkretnego lotu. Cennik trzeba wybierać według źródłowego title code/profile.

### Pozostałe pozycje Copart

- Copart pokazuje opłatę za dokument/title delivery: m.in. $15 USPS do 10 dokumentów, $20 FedEx (limit i wariant różnią się na stronie), $20 za osobisty odbiór tytułu. To pozycja warunkowa, nie stały koszt każdego auta.
- Opłata za opóźnioną płatność w opublikowanym wariancie: $50, jeśli kwota i opłaty nie zostaną zapłacone w ciągu 3 dni roboczych.
- Storage jest zależne od lokalizacji; należy pobierać cennik konkretnego yardu.
- Relist fee: 10% ceny końcowej, minimum $600, jeśli lot nie zostanie opłacony w 8 dni kalendarzowych.
- Third-party finance/flooring fee: $69 w przypadku wskazanego finansowania przez partnera Copart.
- Są również inne odmiany cennika; publiczna strona zawiera kilka bloków tabel. Składka członkowska/depozyt, broker, wymagania licencyjne i podatek sprzedażowy stanu mogą zależeć od profilu kupującego i lotu. Depozyt nie jest automatycznie kosztem pojazdu; należy oddzielić koszt bezzwrotny od blokady/refundable cash.
- W aktualnej oficjalnej tabeli clean/secured zbadanej wyżej nie ma osobnej stałej document fee naliczanej każdemu lotowi; są natomiast warunkowe opłaty za dostarczenie dokumentów. Nie należy ich łączyć.

**Brak do ustalenia przed wdrożeniem stawek Copart:** jaki dokładny profil kupującego Rex.Bid będzie modelował (własne konto licencjonowane/public, buyer przez broker, kraj kupującego), które metody płatności przyjmuje, jakie title groups można rozpoznać z API, czy i jak doliczać US sales tax, oraz czy w fee schedule zaszła zmiana effective_from (publiczna strona nie daje wersjonowanego pliku historycznego w prostym kontrakcie).

## 2. IAA / IAAI USA — brak potwierdzonej tabeli liczbowej

Źródła oficjalne sprawdzone **2026-09-26**:

- [IAA AuctionNow](https://www.iaai.com/US/marketing/auctionnow) mówi, że zakupy online podlegają Buyer Fee Schedule; przy If Bid najwyższa oferta może być zaakceptowana, odrzucona, przeniesiona albo negocjowana, więc bid nie jest automatycznie ceną sprzedaży.
- [IAA Buying Services / Cost Calculator](https://www.iaai.com/US/marketing/Buying-services) potwierdza, że zalogowany kupujący ma IAA Cost Calculator dla każdego pojazdu, uwzględniający opłaty oraz opcjonalny transport.
- [IAA US registration](https://www.iaai.com/us/Marketing/how-to-register) opisuje public/business account eligibility, podatkowe/stanowe ograniczenia i opłatę rejestracyjną $225 dla ścieżki rejestracji opisanej na tej stronie. Nie wolno traktować jej jako uniwersalnego kosztu każdego międzynarodowego kupującego lub każdej transakcji.
- [IAA US Buyer Fees URL](https://www.iaai.com/Marketing/buyer-fees) jest podlinkowany przez oficjalną stronę AuctionNow, ale podczas sprawdzenia nie udostępnił czytelnej tabeli stawek bezpośrednio w publicznym odczycie.

**Nie znaleziono publicznej, oficjalnej i czytelnej liczbowej tabeli IAA USA do zweryfikowania wszystkich tierów, internet fee, pull/gate, payment fee, account type i location fees.** Dostępna tabela [IAA Canada](https://ca.iaai.com/Content/Documents/IAA_AuctionFees_EN.pdf) jest dla Kanady (CAD i kanadyjskie warunki); została wykluczona jako nieadekwatna do aukcji USA. Nie używam kalkulatorów brokerów/blogów jako zamiennika. Do kompletnego modelu potrzebny jest aktualny invoice/cost-calculator breakdown z konta USA dla konkretnych przykładów i buyer type, potwierdzony przez IAA.

Do czasu pozyskania tych danych pozycje IAA: buyer fee, internet/online fee, pull/loading, storage, payment processing, registration, local taxes i transport = configurable/incomplete, nigdy zero przez domyślne pominięcie.

## 3. Transport lądowy USA: aukcja/facility → port

Obecny Rex.Bid/Apibara normalizuje lokalizację w ograniczonym zakresie: listing ma czytelną lokalizację (locationDisplay/kanoniczne location) oraz może mieć send_from/shipping origin. To nie jest gwarancja dokładnego adresu yardu, ZIP, współrzędnych, portu eksportowego ani ceny. Przed kalkulacją należy sprawdzić faktyczne dostępne pola per rekord; jeżeli mamy tylko display string, nie geokoduj go po cichu jako pewny adres.

Model wymagany:

1. facility_id/address/ZIP i warunki odbioru
2. wybrany port eksportowy/terminal
3. stawka transportera i dodatki

Nie znaleziono publicznego, stabilnego, uniwersalnego cennika yard→port dla wszystkich lokalizacji/pojazdów. Usługa aukcji i przewoźników jest wyceniana według trasy i warunków. Przygotować wersjonowaną tabelę wewnętrzną Rex.Bid albo zapis ofert spedytorów. Przykładowe pola: origin facility/ZIP, port, distance/route, standard vs non-runner, dimensions/weight, winch/oversize, storage/yard waiting, pickup window, included loading, currency, quote ID, validity, effective_from/to.

## 4. Transport morski USA → UE/Polska

Kalkulator powinien rozdzielić co najmniej:

1. eksport/document/AES/handling po stronie USA, jeśli jest naliczany;
2. terminal/port of origin;
3. ocean freight, z trybem RoRo / shared container / dedicated container i portem docelowym;
4. cargo insurance (wartość, zakres, deductible) jako osobną opcję;
5. port destination/terminal, unloading, release, documentation;
6. agent celny i port → adres w Polsce.

Publiczne strony przewoźników/forwarderów zwykle prowadzą do quote request, zależnego od miasta/portu, auta, sprawności i typu przesyłki; znalezione rate sheets mają ograniczony kierunek, objętość i okres ważności. Nie ma jednej publicznej stawki, którą można uczciwie zastosować do dowolnego auta Copart/IAA. Każda kwota ma pochodzić z quote/configuration z datą ważności. Przykłady: [RORO Europe — formularz wyceny](https://roroeurope.com/en/request-shipping-quote/), [RORO from USA — rates/quotes](https://www.rorofromusa.com/rates-quotations/). Nie traktować formularza lub przykładowego rate sheet jako ogólnego cennika Rex.Bid.

## 5. Cło, VAT i akcyza — Polska/UE

### Cło

- Stawka zależy od **kodu CN/TARIC, kraju pochodzenia celnego i warunków preferencji**, nie od miejsca aukcji ani samego VIN. „Kupiono w USA” nie oznacza automatycznie „pochodzenie USA”.
- [TARIC — Komisja Europejska](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en) jest codziennie aktualizowaną bazą stawek i środków; nie zawiera krajowych stawek VAT ani akcyzy.
- Dla przykładowego CN/HS 8703.50, US origin → Austria, [Access2Markets](https://trade.ec.europa.eu/access-to-markets/mt/results?destination=AT&origin=US&product=870350) (odświeżenie wyniku 2026-09-05) pokazuje 10% erga omnes oraz preferencję USA 0% pod warunkami dokumentu pochodzenia/reguł, zgodnie z Rozporządzeniem (UE) 2026/1455. To **nie jest automatyczna stawka dla wszystkich samochodów z aukcji USA**. Preferencja wymaga spełnienia pochodzenia oraz dokumentu; TARIC sprawdza się dla dokładnego kodu i dnia importu.
- W modelu stawka cła jest configurable z TARIC dla CN/TARIC + origin + date; jeśli system nie ma potwierdzonego kodu/pochodzenia/dokumentu, wynik pokazuje scenariusz/niepewność, a nie 0% lub 10% jako pewnik.

### Podstawa celna i import VAT

- Customs value należy ustalać na podstawie dokumentów transakcji i reguł wartości celnej, w tym transportu/ubezpieczenia do granicy UE i właściwych korekt; nie utożsamiać jej bezwarunkowo z samym winning bid.
- [VAT Directive, taxable amount — Komisja Europejska](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/taxable-amount_en) wyjaśnia, że podstawa import VAT obejmuje customs value oraz cła/podatki/opłaty i nieuwzględnione koszty dodatkowe, m.in. prowizję, transport i ubezpieczenie do pierwszego miejsca przeznaczenia w kraju importu; także znany dalszy cel w UE może mieć znaczenie. Niedozwolone jest podwójne doliczanie składników już zawartych.
- Polski podstawowy VAT wynosi **23%** według [podatki.gov.pl — stawki VAT](https://www.podatki.gov.pl/podatki-firmowe/vat/stawki-i-limity), sprawdzone 2026-09-26. Konkretne zastosowanie/import i podstawa wymagają oceny trybu importu oraz dokumentów.

### Akcyza od samochodu osobowego

Oficjalne źródła: [podatki.gov.pl — stawki akcyzy](https://www.podatki.gov.pl/akcyza/stawki-podatkowe), [zwolnienia i zwroty](https://podatki.gov.pl/akcyza/zwolnienia-i-zwroty) i aktualny tekst ustawy w [ELI, Dz.U. 2026 poz. 412](https://eli.gov.pl/api/acts/DU/2026/412/text/T/D20260412L.pdf). Sprawdzone 2026-09-26.

| Kategoria samochodu osobowego | Stawka/zwolnienie potwierdzone w źródle | Warunek krytyczny |
|---|---:|---|
| Pozostały samochód osobowy, silnik do 2000 cm³ włącznie | 3.1% podstawy | Klasyfikacja pojazdu jako osobowy, właściwa podstawa i brak szczególnego zwolnienia |
| Pozostały samochód osobowy, silnik powyżej 2000 cm³ | 18.6% podstawy | Jak wyżej |
| HEV bez ładowania z zewnętrznego źródła, do 2000 cm³ | Stawka ustawowa 1.55%; odrębnie sprawdzić czasowe zwolnienie kwalifikowanych hybryd ≤2000 cm³ do 31.12.2029 | Nie wystarczy etykieta „hybrid” z API; sprawdzić ustawową definicję i dokumenty |
| HEV bez ładowania z zewnętrznego źródła, >2000 cm³ do 3500 cm³ | 9.3% podstawy | Pojemność i prawna definicja HEV |
| Hybryda/PHEV objęta ustawową definicją, >2000 cm³ do 3500 cm³ | 9.3% podstawy | Pojemność silnika spalinowego i dokładna definicja prawna |
| Hybryda objęta ustawową definicją, do 2000 cm³ | Zwolnienie do 31.12.2029, jeśli spełnia warunki MF/ustawy | Zwolnienie nie może być wywnioskowane z samej etykiety paliwa/API |
| Pojazd elektryczny / napędzany wodorem | Zwolnienie na podstawie wskazanej przez MF | Sprawdzenie definicji prawnej i dokumentów |

Art. 104 ustawy wskazuje dla importu podstawę akcyzy jako wartość celną powiększoną o należne cło; przy imporcie dolicza się także określone prowizje oraz transport/ubezpieczenie poniesione do pierwszego miejsca przeznaczenia w kraju, jeśli nie zostały już uwzględnione. Nie utożsamiać jej z samą ceną auta ani bezwarunkowo z VAT base. Silnik, rodzaj hybrydy i kwalifikacja osobowy/inny muszą być znane. fuel_type z Apibara sam w sobie nie potwierdza prawnej kategorii napędu, pojemności ani zwolnienia. Właściwe elementy i korekty powinny być zatwierdzone z agentem celnym.

To informacja modelowa, nie porada prawna ani gwarancja kwoty/zwolnienia.

## 6. Waluty

Należy rozdzielić trzy kursy/role, ponieważ źródła prawne nie stosują jednego „aktualnego USD/PLN” do wszystkiego:

- **Orientacyjny kurs interfejsu:** bieżący średni NBP Table A dla USD/PLN i EUR/PLN, przez oficjalne [NBP Web API](https://api.nbp.pl/) (np. GET /api/exchangerates/rates/a/usd/ i analogicznie eur). Zapisujemy datę kursu, tabelę, fetched_at, źródło i oznaczenie indicative; można cache’ować do następnej publikacji tabeli.
- **Kurs do wartości celnej:** miesięczna tabela kursów celnych oparta o NBP publikowana przez [Ministerstwo Finansów](https://www.podatki.gov.pl/informacje-o-cle/pozostale-informacje/kursy-walut-w-przepisach-celnych). Zgodnie z informacją MF kurs publikuje się w przedostatnią środę miesiąca i obowiązuje przez następny miesiąc kalendarzowy. Przechowujemy valid_from, valid_to, walutę, kurs i identyfikator urzędowej tabeli. Nie zastępować go aktualnym kursem NBP w UI.
- **Akcyza:** tekst ustawy o podatku akcyzowym, art. 104 ust. 12–13, wskazuje bieżący średni kurs NBP z dnia powstania obowiązku podatkowego, a gdy nie został tego dnia opublikowany — ostatni wcześniejszy kurs bieżący. To odrębna reguła od miesięcznego kursu celnego. Dokładne zastosowanie daty obowiązku i relacji z procedurą importu musi być potwierdzone przez agenta celnego.

Jeśli nie wiadomo, który kurs prawny stosuje się do danego dokumentu/cła lub daty zgłoszenia, pozycja nie może mieć statusu confirmed.

## 7. Docelowy rachunek (do walidacji przez agenta celnego)

Niech:

- P = potwierdzona cena zakupu/sprzedaży z faktury/rozliczenia (nie bieżący bid ani estymowana wartość);
- A = opłaty aukcyjne i obowiązkowe dla wybranego profilu;
- U = pickup USA/facility→port;
- F = ocean freight;
- I = kwalifikujące się ubezpieczenie;
- H = pozostałe jawne opłaty eksportowe/portowe/handling.

W uproszczeniu projektowym, przed zatwierdzeniem podstaw prawnych:

    customs_value = P + customs-includable(A, U, F, I, H)
    duty_PLN = customs_value_in_customs_currency × current_TARIC_rate
    excise_base = customs_value + duty + legally includable excise adjustments
    excise_PLN = excise_base × rate_or_exemption(vehicle legal classification)
    VAT_base = customs_value + duty + excise + other eligible charges
               through first EU destination (only if not included already)
    VAT_PLN = VAT_base × applicable_PL_VAT_rate
    landed_total = P + A + U + F + I + H + duty + excise + VAT
                   + destination port/agent + port→Poland + explicit other costs

customs-includable/eligible charges to jawne flagi na liniach kosztowych i reguła potwierdzona w danym scenariuszu; nie sumować ponownie tych samych pozycji. Cena auta, aukcyjne opłaty, transport, freight, insurance, cło, VAT i akcyza pozostają osobnymi wierszami UI. UI powinien zwracać brak wyniku całościowego albo zakres, jeśli krytyczny składnik jest null.

### Przykładowe niezależne testy (golden cases)

Testy poniżej mają oczekiwane wartości wyliczone ręcznie z opublikowanych progów/prawa, niezależnie od przyszłej funkcji. Nie są ofertą importu i nie sumują transportu, IAA ani podatków w jedną liczbę.

1. **Copart fee tiers:** tabela clean/secured i non-clean/secured powyżej dla $1,000, $5,000, $10,000, $25,000, $50,000, jako test tier selection, Pre-Bid fee, gate/environmental i sum.
2. **Akcyza, baza kontrolna 10,000 PLN** (wyłącznie sprawdzenie procentu): pozostały osobowy ≤2000 cm³ → 310 PLN; pozostały osobowy >2000 cm³ → 1,860 PLN; HEV bez plug-in 1.55% → 155 PLN, jeśli brak/nie stosuje się zwolnienia; kwalifikowana hybryda >2000–3500 cm³ 9.3% → 930 PLN; kwalifikujący się EV/wodór lub hybryda ≤2000 cm³ w okresie zwolnienia → 0 akcyzy. To nie rozstrzyga kwalifikowalności pojazdu ani podstawy.
3. **Import VAT controlled example:** wyłącznie kontrola formuły dla założonych PLN: customs value 10,000 + duty 1,000 + excise 310 + nieuwzględnione eligible expenses do pierwszego destination 1,500 = VAT base 12,810 PLN; 23% = 2,946.30 PLN. Zmiana kwalifikacji opłat/destynacji zmienia podstawę.
4. **Przykładowe ceny $1k/$5k/$10k/$25k/$50k poza Copart fees:** każdy pojazd należy przeliczyć scenariuszami napędu (ICE 1.5L, ICE 2.5L, HEV 1.8L, PHEV 2.5L, EV), ale bez hard-coded customs rate i FX fixture w produkcji. Jednostkowy test podatku musi podać kontrolowaną customs_value_PLN, kod/pochodzenie, dokładną datę, taryfę i potwierdzony kurs. Cena bid sama nie jest kompletną podstawą.

## 8. Wersjonowanie konfiguracji stawek

Nie umieszczać tabel w car.html. Docelowe źródło to wersjonowany, walidowany dokument danych (np. JSON przy Workerze albo tabele konfiguracji/D1 po osobnej decyzji), którego rekord ma:

    profile_id, provider/auction, country, buyer_type, license_class,
    vehicle_class, title_group, payment_method, bid_mode,
    fee_component, calculation_kind (flat/tier/percent/formula),
    currency, thresholds/value, effective_from, effective_to,
    source_url, checked_at, source_version, status, notes

Transport przechowywać jako oddzielne quote/rate card, z kierunkiem, portami, typem przesyłki, gabarytem/condition, included/excluded charges, walutą, datą oferty i terminem ważności. Prawo/taryfa to niezależny provider aktualizujący TARIC, VAT, akcyzę i kurs celny z datą obowiązywania. Każde wyliczenie zapisuje model_version, fee_profile_version, tax_source_version, fx_rate_ids, wejścia, wyjścia i ostrzeżenia; późniejsza zmiana stawki nie przelicza po cichu poprzedniego estimate.

Konfiguracje muszą wykrywać nakładające się zakresy effective dates i brakujący bracket. Jeśli żaden bracket nie pasuje — wynik jest niekompletny, nie zero.

## 9. Dane i pytania do spedytorów / agenta celnego

### Od spedytora/forwardera

- dokładna facility/address/ZIP oraz wymagany numer/zgoda release;
- pickup, standard vs non-runner, uszkodzone koło/układ kierowniczy, wymiary, masa, EV/battery handling, forklift/winch;
- które porty pochodzenia są obsługiwane, trasa do portu i okres ważności quote;
- osobno inland pickup, yard/storage, export documents/AES, terminal receiving/loading/handling;
- RoRo vs shared container vs dedicated 20'/40', warunki kwalifikacji auta do RoRo;
- freight do portu UE, porty docelowe (np. Gdynia/Gdańsk/Bremerhaven/Rotterdam), harmonogram i dopłaty;
- cargo insurance: wartość ubezpieczona, zakres, deductible, wyłączenia uszkodzeń przed transportem;
- destination terminal/unloading/release/document/THC, storage/free days;
- agent celny, opłaty administracyjne, port→miejsce w Polsce, VAT na usługi, dopłaty, co jest już w freight;
- potwierdzenie, czy kwoty są netto/brutto i czy opłaty są per vehicle, per container lub shipment.

### Od IAA i Copart / operatora konta

- właściwa buyer fee schedule dla kupującego zagranicznego i wybranego buyer type/licencji;
- buyer fee exact bracket, online/virtual/live bid fee, gate/pull/loading/document fee, environmental/service fee;
- secure/unsecure/payment processor fees i limit/kanał płatności;
- account/membership, depozyt/refundowalność, broker fee, storage deadline/location fees, late/relist/tax;
- sample itemized invoice/Cost Calculator breakdown dla $1k, $5k, $10k, $25k, $50k, clean i salvage/non-clean, online pre-bid/live, buyer profile;
- daty wejścia w życie każdego cennika oraz czy IAA fee zależy od public/licensed/high-volume, vehicle group, branch.

### Od agenta celnego/doradcy podatkowego

- sposób ustalenia customs value dla uszkodzonego samochodu, waluty, prowizji aukcyjnych, inland/freight/insurance;
- kod CN/TARIC dla modelu/napędu/klasyfikacji auta i kraj pochodzenia, dowód pochodzenia dla ewentualnej preferencji z 2026/1455;
- podstawa i moment kursu dla import duty, VAT i akcyzy; gdzie odprawa (pierwszy kraj UE) i jakie opłaty trafiają do VAT base;
- akcyza: podstawa importowa, typ osobowy, HEV/PHEV definicja, silnik, kwalifikacja do zwolnień EV/hybrid i wymagane dokumenty;
- import/registration complications dla salvage/parts-only oraz czy są niezależne od podatku.

## 10. Źródła i zakres obowiązywania (sprawdzone 2026-09-26)

| Źródło | Co potwierdza | Ograniczenie |
|---|---|---|
| [Copart US Member Fees](https://www.copart.com/content/us/en/member-fees) | Aktualne widoczne fee brackets, clean/non-clean, secured/unsecured, bid mode, gate/environmental i inne warunkowe pozycje | Wiele profili; trzeba dopasować typ klienta/lot/payment; bez jednej daty effective-from dla każdej tabeli |
| [IAA US AuctionNow](https://www.iaai.com/US/marketing/auctionnow) | Online purchases podlegają Buyer Fee Schedule; If Bid nie gwarantuje sprzedaży po wysokim bidzie | Nie publikuje czytelnych kwot fee schedule w tym odczycie |
| [IAA Cost Calculator / Buying Services](https://www.iaai.com/US/marketing/Buying-services) | Zalogowany kupujący widzi fee i optional transport dla konkretnego auta | Wymaga konta i konkretnego profilu; wynik trzeba zebrać z realnego konta |
| [IAA US registration](https://www.iaai.com/us/Marketing/how-to-register) | Rodzaje kont/ograniczenia stanowe i wskazana opłata rejestracyjna $225 na opisanej ścieżce | Nie utożsamiać z uniwersalną opłatą międzynarodowego klienta |
| [TARIC](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en) | Oficjalne, codziennie przekazywane stawki/środki EU; preferencje, cła third-country | Wymaga CN/TARIC, pochodzenia, daty i warunków; VAT/akcyza krajowe poza TARIC |
| [Access2Markets 8703.50 US→AT](https://trade.ec.europa.eu/access-to-markets/mt/results?destination=AT&origin=US&product=870350) | Dla przykładowego kodu: 10% erga omnes i warunkowa 0% preferencja US na podstawie Reg 2026/1455 | Przykład nie jest uniwersalny; pochodzenie i dowód są krytyczne |
| [Rozporządzenie UE 2026/1455](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32026R1455) | Preferencyjne duty 0% dla wymienionych CN kodów i US-origin goods na określonych zasadach | Trzeba zweryfikować, czy konkretny CN code jest w załączniku i czy origin proof spełnia warunki |
| [Komisja Europejska — import VAT base](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/taxable-amount_en) | Customs value, duties/taxes i kwalifikujące się incidental expenses do pierwszego miejsca destination/znanego dalszego celu | Faktyczne przypisanie pozycji i miejsce odprawy wymagają dokumentów/porady |
| [MF — VAT rates](https://www.podatki.gov.pl/podatki-firmowe/vat/stawki-i-limity) | Podstawowa stawka VAT 23% | Konkretne zastosowanie może wymagać oceny sposobu importu |
| [MF — excise rates](https://www.podatki.gov.pl/akcyza/stawki-podatkowe) i [exemptions](https://podatki.gov.pl/akcyza/zwolnienia-i-zwroty) | Stawki 3.1%, 18.6%, 1.55%, 9.3% oraz wskazane zwolnienia EV/hydrogen/hybrid ≤2L do końca 2029 | Prawna kwalifikacja kategorii, podstawy i warunków nie wynika pewnie z samego rekordu aukcyjnego |
| [NBP Web API](https://api.nbp.pl/) | Oficjalny endpoint bieżących/historycznych średnich kursów tabeli A/B i kupna/sprzedaży C | UI rate nie jest automatycznie kursem celnym |
| [MF — kursy celne](https://www.podatki.gov.pl/informacje-o-cle/pozostale-informacje/kursy-walut-w-przepisach-celnych) | Kurs NBP z przedostatniej środy miesiąca, ważny na następny miesiąc do wartości celnej | Należy wybrać tabelę obowiązującą na dzień właściwego zdarzenia |
| [IAA Canada PDF — odrzucony dla USA](https://ca.iaai.com/Content/Documents/IAA_AuctionFees_EN.pdf) | Dowód, że istnieje odmienny fee schedule zależny od segmentu i wolumenu | Kanada; nie używać jako stawki US |

## Otwarte pytania / blokery

1. Pisemny/uzyskany z konta aktualny IAA US fee breakdown dla konkretnego profilu zagranicznego kupującego.
2. Aktualne ofertowe stawki transportowe z datą, trasą, metodą, autem sprawnym/niesprawnym i kompletną listą wyłączeń.
3. Walidacja kalkulacji celnej/akcyzowej przez polskiego agenta celnego: CN/origin/preference proof, customs value, akcyza/import VAT base i kursy.
4. Uzgodniony profil klienta Rex.Bid. Bez tego Copart też nie ma jednego właściwego cennika.
5. Polityka odświeżania/versioningu: monitorowanie zmian Copart/TARIC/stawek podatkowych/FX i przechowywanie wersji użytej do historycznego estimate.

**Wniosek:** rozpoczęcie technicznej implementacji modelu/adapterów stawek jest możliwe. Włączenie stałych domyślnych opłat IAA, transportu, cła i całkowitej ceny jako „potwierdzonej” nie jest jeszcze bezpieczne. Produkcyjny kalkulator powinien najpierw pokazywać zakres/opcjonalne pozycje i status niekompletności, dopóki nie wpłyną wymagane profile/quotes i walidacja ekspercka.
