# Rex.Bid — model stawek transportowych Calculator V2

**Status:** źródła zaimportowane i zweryfikowane automatycznie; kod oraz UI są lokalne. Staging **NOT DEPLOYED / NOT VERIFIED**, produkcja nietknięta. Pełny koszt door-to-door pozostaje niekompletny z powodu brakujących kosztów aukcyjnych i importowych.

## Źródła prawdy i waluta

Autorytatywnym roboczym źródłem stawek Rex.Bid są cenniki przekazane przez partnera: `data/partner/land_transport_rates.md` i `data/partner/sea_transport_rates.md`. Są to źródła danych, nie ręcznie wpisane tabele w kodzie.

Oba źródła oznaczają wszystkie niepuste kwoty znakiem `$`; zgodnie z decyzją właściciela rate set ma `currency=USD`. Route IDs są neutralne `route_1`…`route_6`; nazwy portów ani mappingu nie dostarczono. `effective_from` jest `null`, ponieważ źródła nie podają daty obowiązywania. Stawki mają status `configurable` do potwierdzenia daty i zakresu.

## Import i audyt danych

Pipeline: źródłowe pliki → `scripts/partner-transport-rates.cjs` → normalizacja/audyt → wygenerowany `public/rexbid-transport-rates.js` → `public/rexbid-transport-engine.js`. Generator nie poprawia ani nie usuwa wierszy źródłowych. Każdy land rate zachowuje oryginalną nazwę lokalizacji i reference `{file,line}`; rate set przechowuje SHA-256 obu źródeł. Wersja jest deterministycznie wyprowadzona z hashy źródeł.

Polecenia:

```powershell
node scripts/partner-transport-rates.cjs --audit
node scripts/partner-transport-rates.cjs --write
node scripts/partner-transport-rates.cjs --check
```

`--write` parsuje ponownie oba źródła i regeneruje moduł; `--check` kończy błędem, jeśli wygenerowany moduł nie odpowiada plikom źródłowym. Lądowy plik jest tab-delimited bez nagłówka: 5 kolumn danych lokalizacji/platformy i dokładnie 6 route columns (łącznie 11). Morski plik to tabela Markdown z czterema rekordami 40'HC (1–4 auta) oraz sześcioma stawkami na pojazd.

### Audyt importu (610 wierszy lądowych)

| Kontrola | Wynik |
|---|---:|
| Rekordy | 610 |
| Platformy | Copart 252; IAAI 202; Manheim 90; Adesa 66 |
| Region | USA 585; Kanada 25 |
| Brak ZIP / brak miasta | 14 / 14 |
| Brak wszystkich 6 stawek | 0 |
| Puste route cells | 718 z 3660 |
| Niepuste wartości z `$` | 2942 z 2942 |
| Kolizje znormalizowanego platforma+lokalizacja | 0 |
| Kolizje platforma+ZIP / platforma+miasto+stan | 14 / 21 kluczy |
| Kolizje ZIP bez platformy / miasto+stan bez platformy | 61 / 84 klucze |

Ostatnie cztery wyniki są potencjalnie niejednoznacznymi kluczami fallbacku, a nie automatycznie błędnymi danymi. Matcher zwraca `ambiguous` na pierwszym poziomie, który ma wiele wyników; nie wybiera arbitralnie i nie przechodzi do słabszego klucza. Braki w mieście/ZIP i puste trasy pozostają null. Parser zatrzymuje się na nieoczekiwanej liczbie kolumn, nieobsługiwanej platformie/stanie lub kwocie bez `$` zamiast po cichu przerabiać źródło.

## Model danych

Każdy rekord lądowy zawiera `location_name`/`location_name_original`, `location_name_normalized`, `platform`, oryginalne i znormalizowane miasto/stan/ZIP, `route_1`…`route_6`, `currency=USD`, `source=partner`, `source_row`, `rate_set_version`, `effective_from=null`, `status=configurable` i notes. Brak komórki trasy jest `null`, nigdy 0. Jawna źródłowa kwota `$0` pozostałaby zerem.

Sea rate set zawiera osobne stawki dla 1, 2, 3 i 4 aut w 40'HC, per vehicle, w USD oraz referencję do pliku i wiersza źródłowego. Każda trasa zachowuje ten sam neutralny ID co land table.

## Normalizacja i dopasowanie

Normalizacja obsługuje wielkość liter, znaki diakrytyczne, przecinki/nawiasy, wielokrotne spacje, ZIP+4 i skróty/nazwy stanów USA. Kanadyjskie kody pocztowe pozostają alfanumeryczne po usunięciu separatorów. Nie ma fuzzy matchingu.

Priorytet:

1. platforma + dokładna znormalizowana nazwa lokalizacji aukcji → `exact`;
2. platforma + ZIP → `fallback_zip`;
3. platforma + miasto + stan → `fallback_city_state`;
4. ZIP bez platformy → `fallback_zip` z niską pewnością;
5. miasto + stan bez platformy → `fallback_city_state` z niską pewnością.

Wielokrotne wyniki na danym poziomie zwracają `ambiguous`; brak wyniku to `unmatched`. Oryginalnych nazw partnera nie nadpisujemy normalizacją.

## Wybór trasy i transport łączny

Dla każdej trasy liczymy osobno `land_rate + sea_rate` w USD. Trasy bez którejkolwiek składowej są pomijane; null nie oznacza zera. **Standardowy/expected** korzysta z tabeli 4 auta / 40'HC; **ostrożny/conservative** z 3 aut / 40'HC. Każdy wariant niezależnie wybiera najmniejszą kompletną sumę ląd + morze; tie-break jest deterministyczny po route ID. Nie wybieramy wyłącznie najtańszego land rate. Wynik wewnętrzny zachowuje selected route, land, sea, combined amount, USD, partner source i match status; ID trasy nie jest pokazywane zwykłemu klientowi.

### Przykłady z zaimportowanej tabeli

Kwoty USD per vehicle; route ID podano wyłącznie do audytu. Przykłady używają exact platform+location records, a matcher w razie braku branch może zastosować udokumentowany fallback.

| Lokalizacja źródłowa / platforma | Match | Trasa standard / ostrożna | Land | Sea standard (4 auta) | Suma standard | Sea ostrożny (3 auta) | Suma ostrożna |
|---|---|---|---:|---:|---:|---:|---:|
| Houston / Copart | exact | route_3 / route_3 | 205 | 675 | **880** | 850 | **1055** |
| Chicago North / Copart | exact | route_5 / route_5 | 295 | 675 | **970** | 850 | **1145** |
| Los Angeles / Copart | exact | route_4 / route_4 | 220 | 1175 | **1395** | 1515 | **1735** |
| Miami Central / Copart | exact | route_1 / route_1 | 415 | 575 | **990** | 650 | **1065** |
| New Jersey / Manheim | exact | route_2 / route_2 | 230 | 575 | **805** | 650 | **880** |
| Texas / Copart | exact | route_3 / route_3 | 205 | 675 | **880** | 850 | **1055** |
| California / Manheim | exact | route_4 / route_4 | 250 | 1175 | **1425** | 1515 | **1765** |
| Anchorage / IAAI | exact | route_5 / route_5 | 3150 | 675 | **3825** | 850 | **4000** |
| Hawaii (Honolulu) / Manheim | exact | route_3 / route_3 | 2850 | 675 | **3525** | 850 | **3700** |
| Abbotsford / Copart (Canada) | exact | route_6 / route_6 | 2575 | 1050 | **3625** | 1485 | **4060** |

Są to sumy wyłącznie dwóch pozycji partnera ląd+morskie — nie koszt pod dom ani gwarantowana oferta. Route ID nie identyfikuje znanego portu.

## Integracja kalkulatora i brakujące koszty

Przepływ docelowy: `auction location → partner land rate → neutral route → partner sea rate → remaining import costs → estimate`. Nowy transport engine wybiera standard/conservative i przekazuje wariant standardowy jako linie `partner` do istniejącego strict calculator tylko wtedy, gdy użytkownik nie podał ręcznej wartości. Ręczny override zachowuje pierwszeństwo. Strict fee, cło, VAT, akcyza i zasady kwalifikacji podatkowej nie są zmieniane.

Strict wynik pokazuje znane subtotal USD/PLN oddzielnie, nie przelicza walut bez jawnego kursu, a pełny total pozostaje null/incomplete, jeśli brakuje wymaganego kosztu, podstawy, waluty lub kursu. UI karty auta pokazuje cenę pojazdu, opłaty aukcyjne, transport lądowy, morski i łączny, podatki/odprawę oraz dostawę w Polsce. Stawki transportu oznacza jako źródło Partner Rex.Bid. Kwoty transportowe są w USD, status `configurable`; ogólny koszt pozostaje częściowy.

Wersje i confidence to statusy danych, a nie gwarancja oferty. Brak dopasowania nie uruchamia poprzednich publicznych market estimates.

## Fallbacki, retencja konfiguracji i aktualizacja

- Brak land match albo complete route → transport unknown / wymaga wyceny; nie używać poprzednich publicznych estymacji.
- Nieznany port mapping nie blokuje matematycznego łączenia wspólnych route columns, ale musi być jawnie udokumentowany jako brak nazwy portu.
- Wersja rate set jest content-addressed hashami źródeł. Historyczny zestaw pozostaje odtwarzalny przez Git i `source_row`; `effective_from` zostaje null dopóki partner nie poda daty.
- Aktualizacja: podmień źródłowe pliki wyłącznie na podstawie nowej tabeli partnera; uruchom `--audit`, `--write`, obejrzyj zmianę liczby rekordów, platform, braków, kolizji i przykładów; uruchom `--check`, pełne testy parsera/matchera/kalkulatora i staging review. Nie poprawiaj źródła automatycznie. Zatwierdź zmiany cennika w osobnym checkpointcie. D1 `transport_rate_sets`/panel admina pozostają przyszłym etapem.

## Bezpieczeństwo wdrożenia

Komponent i assety są dostępne tylko z jawną flagą `REXBID_TRANSPORT_CALCULATOR_ENABLED`; staging config ją ustawia, production config nie. Po weryfikacji staging deploy ma Version ID `00b55a4e-9389-453b-8153-5621f3bc4c7b`; produkcja nie została wdrożona. Public-market door-to-door prototype pozostaje odłączony od karty auta i nie jest źródłem cen.

## Weryfikacja realnej karty auta — 2026-09-30

**CODE VERIFIED / AUTOMATED VERIFIED:** pełny suite 259/259 PASS. **STAGING VERIFIED / REAL BROWSER VERIFIED:** na stagingowej karcie Copart LOT 97885965 lokalizacja `Long Island (NY)` wraz z ZIP rozpoznana przez `fallback_zip`; wynik transportu: land $295, sea $575 standard (4 auta) / $650 ostrożny (3 auta), łącznie $870 / $945 USD. Brak pełnych kosztów aukcyjnych/importowych i dostawy PL nadal blokuje koszt pod dom.

W tej weryfikacji znaleziono przypadek, w którym frontend przekazywał lokalizację jako obiekt, co dawało tekst `[object Object]` i wyłączało match. Engine pobiera teraz jawne pola tekstowe oraz ustrukturyzowane city/state/ZIP; pole statusu aukcji (np. `open`) nie jest traktowane jako stan geograficzny. Regression fixture obejmuje ten kształt danych.

**NOT VERIFIED:** mobilny viewport w prawdziwej przeglądarce, exact/unmatched/ambiguous bezpośrednio w UI oraz konsola JS. Matchery exact/fallback/unmatched/ambiguous i brak fałszywych kwot są objęte testami/offline.


## Użycie w Calculator V3

Calculator V3 zachowuje ten sam generated partner rate set i matcher. Dla standardowego wariantu (4 cars / 40'HC) i ostrożnego (3 cars / 40'HC) route selection minimalizuje kompletną sumę land + sea niezależnie dla każdego wariantu. Wybrane land/sea values niosą wersję rate setu; route IDs są wewnętrzne. Niekompletna trasa daje unknown.

Wyniki przykładowe i model importu są w `docs/DOOR_TO_DOOR_COST_MODEL.md`. Aktualizacja źródeł i generatora nadal przebiega przez `scripts/partner-transport-rates.cjs --audit/--write/--check`; algorytm nie wymaga edycji przy zmianie rate data.
