# Calculator V3 — model kosztu pod dom

Data implementacji/źródeł: 2026-09-30. To model estymacyjny Rex.Bid, nie oferta transportowa, wiążące rozliczenie podatkowe ani gwarancja opłat aukcyjnych.

## Trzy poziomy wyniku

1. **Transport estimate** — partnerowy transport lądowy + morski w USD. Wariant standardowy zakłada 4 auta w kontenerze 40'HC, ostrożny 3 auta. Każdy wariant niezależnie wybiera najtańszą kompletną sumę ląd+morski spośród neutralnych tras.
2. **Import subtotal** — cena, jawne opłaty aukcyjne, transport i koszty importowe oraz cło/VAT/akcyza. Jest dostępny dopiero po podaniu wszystkich wymaganych komponentów i kursu UI; pokazuje kwotę PLN, nie zastępuje podstaw podatkowych.
3. **Door-to-door** — import subtotal plus jawna dostawa w Polsce. Wymaga również jawnych wartości kosztów portu, broker/odprawy, ubezpieczenia, rozładunku, dokumentacji, pozostałych opłat i dostawy PL. Brak pola nie jest zerem. Gdy coś jest nieznane, całkowita kwota pozostaje pusta, widoczny jest subtotal znanych pozycji i lista braków.

## Konfiguracja i źródła

- Partnerowe tabele lądowa/morska są źródłem roboczych stawek transportu Rex.Bid, waluta USD. Używany jest wersjonowany generated rate set i zachowany source row. `effective_from` jest pusty, bo źródło nie podaje daty wejścia w życie.
- Konfiguracja Calculator V3 znajduje się w `public/rexbid-calculator-v3-rates.js`. Trzyma wersję, daty, statusy i puste sloty dla Copart/IAA, FX, portu, brokera, obsługi kontenera/dokumentów, pozostałych opłat i dostawy PL. Algorytm nie zawiera tych stawek.
- Copart: publiczny fee schedule można wybrać jawnie i przeliczyć, ale kwoty mają status `configurable`; nie potwierdzono, który profil, payment method, bid mode i schedule dotyczy Rex.Bid. Opłaty warunkowe zależne od zdarzeń nie są automatycznie doliczane. Oficjalne źródło: [Copart Member Fees](https://www.copart.com/content/us/en/member-fees), sprawdzono 2026-09-30.
- IAA: struktura opłat jest przygotowana, lecz numeryczny profil właściwy dla Rex.Bid pozostaje `unknown`; nie wymyślamy tabeli.
- Podatki: cło wymaga jawnej wartości celnej oraz stawki TARIC dla kodu CN, pochodzenia i daty. Wartość celna nie jest utożsamiana z samą ofertą aukcyjną. Import VAT ma stawkę 23% z polskiej konfiguracji, lecz wymaga jawnej podstawy obejmującej elementy wymagane przepisami. Akcyza używa zachowanej logiki stawek i pojemności/klasy, ale prawna klasyfikacja, podstawa oraz kwalifikacja zwolnienia muszą być jawnie potwierdzone. Etykieta paliwa sama nie daje zwolnienia EV/PHEV.
- Urzędowa tabela MF podaje stawki akcyzy od 2026-01-01: 3,1% dla pozostałych samochodów osobowych, 18,6% powyżej 2000 cm³, 1,55% dla hybryd do 2000 cm³ oraz 9,3% dla wskazanych hybryd >2000 do 3500 cm³. Kod nie rozstrzyga automatycznie kategorii prawnej ani zwolnień. [MF — stawki akcyzy](https://podatki.gov.pl/akcyza/stawki-podatkowe), sprawdzono 2026-09-30.
- Podstawa import VAT obejmuje wartość celną oraz należności i koszty dodatkowe (m.in. transport/ubezpieczenie do pierwszego miejsca przeznaczenia), o ile nie zostały już ujęte. [Komisja Europejska — taxable amount](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/taxable-amount_en), sprawdzono 2026-09-30.
- Kurs prezentacyjny USD/PLN jest odrębny od kursu celnego i kursu używanego dla akcyzy. Kurs celny MF wskazuje miesięczne zastosowanie kursu opublikowanego przez NBP w przedostatnią środę poprzedniego miesiąca. Żaden kurs nie jest obecnie automatycznie pobierany ani podstawiany. [MF — kursy celne](https://www.podatki.gov.pl/informacje-o-cle/pozostale-informacje/kursy-walut-w-przepisach-celnych), sprawdzono 2026-09-30.
- Port handling, broker, rozładunek/kontener, dokumenty, inne koszty importowe i dostawa w Polsce pozostają `unknown`, dopóki nie zostanie podana datowana stawka/wycena. Publiczne benchmarki i dawne door-estimator ranges nie są automatycznym fallbackiem.

## Statusy i kompletność

`confirmed` oznacza potwierdzoną wartość wraz z dowodem i datą; `configurable` — wartość jawnie dostarczoną lub profil, którego zastosowanie wymaga potwierdzenia; `estimated` — oszacowanie ze źródłem i datą; `unknown` — brak liczby. Dla przejrzystości źródło stawki jest oddzielone od pewności jej zastosowania: publiczna tabela Copart może mieć oficjalne źródło, ale niepotwierdzone dopasowanie konta.

Wartość `0` jest prawidłowa wyłącznie wtedy, gdy została jawnie wprowadzona/ustalona. Puste pole, `null` i brak stawki pozostają `unknown`. Niepełny wynik nie udostępnia obiektu `total`.

## Przykłady obliczeń offline na stawkach źródłowych

To kontrolne scenariusze z rzeczywistych wierszy rate setu (bez requestów do providera i bez przypisania ich do konkretnego samochodu). Kwota `znany subtotal USD` to tylko cena + wybrany, nadal konfigurowalny fee profile Copart + partnerowy transport; nie obejmuje cła, VAT, akcyzy, portu, agenta ani dostawy w Polsce. Copart używa wybranego publicznego wariantu clean/secured/Pre-Bid wyłącznie jako przykładu; właściwy profil Rex.Bid pozostaje niepotwierdzony. Dla IAA fee jest unknown, więc subtotal wyklucza fee i wynik jest jeszcze bardziej niepełny.

| Przykład | Oferta | Fee profile / fee USD | Transport standard (4 auta) | Znany subtotal standard | Transport ostrożny (3 auta) | Znany subtotal ostrożny | Stan pełnego wyniku |
|---|---:|---:|---:|---:|---:|---:|---|
| Copart Houston 77073 | $1,000 | $473 configurable | $880 | $2,353 | $1,055 | $2,528 | incomplete |
| Copart Houston 77073 | $5,000 | $928 configurable | $880 | $6,808 | $1,055 | $6,983 | incomplete |
| Copart Houston 77073 | $10,000 | $1,058 configurable | $880 | $11,938 | $1,055 | $12,113 | incomplete |
| Copart Houston 77073 | $25,000 | $2,020.50 configurable | $880 | $27,900.50 | $1,055 | $28,075.50 | incomplete |
| Copart Houston 77073 | $50,000 | $3,833 configurable | $880 | $54,713 | $1,055 | $54,888 | incomplete |
| Copart Los Angeles 90001 | $1,000 | $473 configurable | $1,395 | $2,868 | $1,735 | $3,208 | incomplete |
| Copart Los Angeles 90001 | $5,000 | $928 configurable | $1,395 | $7,323 | $1,735 | $7,663 | incomplete |
| Copart Los Angeles 90001 | $10,000 | $1,058 configurable | $1,395 | $12,453 | $1,735 | $12,793 | incomplete |
| Copart Los Angeles 90001 | $25,000 | $2,020.50 configurable | $1,395 | $28,415.50 | $1,735 | $28,755.50 | incomplete |
| Copart Los Angeles 90001 | $50,000 | $3,833 configurable | $1,395 | $55,228 | $1,735 | $55,568 | incomplete |
| IAAI Chicago-North 60118 | $1,000 | unknown | $965 | $1,965* | $1,140 | $2,140* | incomplete |
| IAAI Chicago-North 60118 | $5,000 | unknown | $965 | $5,965* | $1,140 | $6,140* | incomplete |
| IAAI Chicago-North 60118 | $10,000 | unknown | $965 | $10,965* | $1,140 | $11,140* | incomplete |
| IAAI Chicago-North 60118 | $25,000 | unknown | $965 | $25,965* | $1,140 | $26,140* | incomplete |
| IAAI Chicago-North 60118 | $50,000 | unknown | $965 | $50,965* | $1,140 | $51,140* | incomplete |

`*` Cena + transport only; nie uwzględnia nieznanej opłaty aukcyjnej. Wszystkie wyniki są USD, przed podatkami i dalszymi kosztami. Nie ma obecnie kompletnego przykładu kosztu pod dom. W kompletnym, testowym zestawie wejściowym silnik potrafi wyliczyć subtotal i door-to-door jako `estimated`, ale nie stanowi to dowodu, że rzeczywiste cła/oferty/FX są już skonfigurowane.

## Konfiguracja pod administrację

Stawki są osobnymi danymi z wersją, `source`, walutą, `effective_from`, `checked_at`, aktywnością/notatkami i statusami. Proponowany późniejszy model D1 `transport_rate_sets` / profile opłat nie jest obecnie migracją ani panelem admina. Zmiana stawki ma wymieniać konfigurację/rate set, bez zmiany funkcji obliczeniowych. Do uzyskania tabeli od partnera: edycja źródła, `--audit`, `--write`, przegląd diffu, `--check`, pełne testy i osobna akceptacja nowej wersji.

## Granice wdrożenia

Kod V3 jest lokalnym rozszerzeniem V2. V3 włącza się wyłącznie przy jawnej fladze i dokładnym hoście `rexbid-auth-test.tedn828.workers.dev`; na każdym innym hoście, w tym production, Worker zachowuje poprzedni kalkulator i blokuje V3 rate asset. W tym etapie nie wykonano staging deployu ani real-browser testu auta, aby nie powodować provider calls. Bez wpisania niepotwierdzonych wartości V3 prawidłowo pokazuje `Kalkulacja niepełna`.

## QA Calculator V3 na stagingu — 2026-09-30

- Końcowa wersja: Worker `rexbid-auth-test`, D1 `rexbid-auth-test-db`, Version ID `c34f0aa5-eefb-43be-85ea-6cd4ee161868`. Staging deploy po dry-run; nie zmieniano produkcji ani produkcyjnego D1.
- Desktop/mobile QA PASS na istniejącej Copart karcie. Szczegóły auta, 12 zdjęć, 20 zdarzeń historii, title/seller/damage/Run & Drive/keys i guest favorite działały; konsola dostępna przez narzędzie QA bez błędów.
- Lokalizacja `Long Island (NY)`, ZIP match: 295 USD ląd. Standard 4 auta: 575 USD morze, suma 870 USD; ostrożnie 3 auta: 650 USD morze, suma 945 USD. Źródło Partner Rex.Bid; techniczne route IDs nie są renderowane.
- Pełny, jawnie uzupełniony zestaw syntetycznych wartości QA wyrenderował 48 706 PLN standard / 48 987,25 PLN ostrożnie jako szacunek. Po QA wartości wyczyszczono. Prawdziwe brakujące wartości nadal blokują total.
- Mobile: 390×844, document width 375 px, panel 355 px, brak poziomego scrolla i overflowu; rozwijanie szczegółów działa. Desktop: 1366×900, document width 1350 px.
- Naprawiono extensionless `/car`, widoczność panelu V3 oraz etykietę Copart: publiczna tabela nie potwierdza profilu konta Rex.Bid.
- Pełne testy: 268/268 PASS; partner rate generator `--check`, JS syntax i diff-check PASS.
- **NOT VERIFIED:** rzeczywisty IAAI UI; tax/legal inputs i właściwy kurs; port/broker i dostawa PL; pełny realny koszt pod dom; real login/cloud favorites podczas tego testu. Brak bezpośrednich requestów Apibara, ale browser detail/history może wywołać zwykłe provider reads — ich count nie był instrumentowany.
