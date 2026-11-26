# Instrukcja integracji dla Codexa — pakiet partnera 2026-10-04

Ten pakiet doprecyzowuje źródła kalkulatora. Nie zastępuje istniejącego repozytorium ani całego car.html.
Najpierw przeczytaj ANALIZA_I_AKTUALIZACJA_PL.md oraz data/metadata.json i audit/rate_conflicts.csv.

## Nowa dopłata EV
Właściciel potwierdził 150 USD za pakowanie każdego auta elektrycznego. Odczytaj data/surcharges.csv i sources/OWNER_EV_PACKING_2026-10-04.md. Stosuj raz do BEV, bez mnożnika lądowego ani dzielenia przez kontener. Hybrydy/nieznany napęd: zakres wymaga potwierdzenia.

## Wymagane korekty względem dotychczasowego silnika
- route_1 Savannah; route_2 Elizabeth; route_3 Houston; route_4 Los Angeles; route_5 Indianapolis; route_6 Montreal. Zachować aliasy.
- Domyślnie używać preferred_terminal_id odczytanego z kolorów. Nie wybierać automatycznie minimum land+sea.
- Dla 3 i 4 aut utrzymywać ten sam terminal preferowany, chyba że partner/admin jawnie wskaże alternatywę.
- Mnożnik gabarytowy stosować tylko do stawki lądowej.
- Nie wybierać klasy Large/Oversized po domyśle; źródło nie daje progów rozmiaru. Nie stosować 4-autowego frachtu do dowolnego pojazdu.
- Brak stawki = null. Konflikt Albany/Elizabeth = wymaga rozstrzygnięcia, nie cichej podmiany.
- Datę reguł lądowych 2026-10-01 zachować osobno od niepotwierdzonej daty wcześniejszych kwot i frachtu.
- Nie dopisywać portu docelowego, podatków ani usług końcowych nieobecnych w źródłach.
- Dodatkowe nieopisane wiersze morskie nie mogą wejść do obliczeń.
- Existing partner rates remain the numeric source; do not replace with BidCars prices or tune a grand total to a benchmark.
- Zachować gallery, history, favorites, Auth, strict engine i wszystkie dotychczasowe funkcje.
- Na tym etapie brak zgody na deploy produkcji, zmianę D1, commity lub push.

## Aktualizacja plików
Pakiet można umieścić w data/partner/RexBid_Calculator_V4_2026-10-04/ — bez nadpisania historycznych źródeł.
Źródłem generatora są CSV z podfolderu data/. XLSX jest edytowalnym przeglądem; jego zmiany trzeba jawnie wyeksportować.
Uruchom:
  node tools/build-partner-rates.cjs
  node tools/build-partner-rates.cjs --check
  node --test tools/validate-package.test.cjs

Generator niczego nie publikuje ani nie pobiera z sieci.
Wygenerowany JSON ma release_status=review_required_before_production. Integrator ma respektować status source_conflict dla dwóch wierszy.

## Granica weryfikacji
610 kwotowych wierszy z MD zachowano bez zmian. Preferred routing odczytano z kolorowych obramowań wszystkich 610 pozycji.
To nie jest nowa pełna transkrypcja tysięcy kwot z obrazów. Pełny nowy eksport partnera z datą ma pierwszeństwo po jawnej weryfikacji różnic.
Dostarczone fotografie zawierają potwierdzone różnice w dwóch kwotach Albany. Oryginały, hashe i zakresy pikseli są w pakiecie.

## Kontekst następnego sprintu
Właściciel nie wysłał jeszcze wcześniejszego dużego promptu UX. Ten pakiet trzeba uwzględnić w jednym skonsolidowanym zleceniu:
Home/sekcja EV, Buy Now vs oferta, TITLE/sprzedawca, globalna semantyka Upcoming bez fałszywego countdownu, jeden kompaktowy kalkulator.
Nie zaczynaj niezależnego wdrożenia na podstawie samego tego dokumentu.

Główne skonsolidowane zadanie: CODEX_SPRINT_CALCULATOR_V4_UX.md. Wykonaj je zamiast starszych, sprzecznych promptów o najtańszej trasie.
