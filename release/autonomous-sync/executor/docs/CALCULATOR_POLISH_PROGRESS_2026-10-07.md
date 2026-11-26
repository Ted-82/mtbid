# Calculator V4, karta auta i kontakt — 2026-10-07

Zmiany lokalne na zachowanej bazie checkpointu `364b1d7`. Bez commitu, deployu, migracji, wiadomości e-mail ani żądań Apibara.

## Zrobione

- V4 ma oddzielne etykiety wyboru ceny i kwoty, widoczną klasę transportową, napęd i wariant załadunku. Klasy transportowe mają polskie etykiety; źródłowe identyfikatory i wartości pozostały zachowane.
- Każda pozycja głównej rozpiski wskazuje status: w sumie, szacunek, brak danych lub suma częściowa. Brakująca kwota pozostaje poza sumą, bez podstawienia zera. Pełne uzupełnienie pól PLN nadal jest szacunkiem wpisanym przez użytkownika, wymagającym potwierdzenia zakresu usług. Dodano informację o jednokrotnym liczeniu opłat pakietu port/broker/dokumenty.
- `car.html` zachowuje główny render, obie ceny aukcji, galerię/wideo/lightbox, historię, dokumenty, dane sprzedawcy i informację o aktualności. Link powrotu oraz okruszek korzystają z walidowanego lokalnego `return_to`; pełne filtry katalogu zostają zachowane, cursor nie trafia do linku.
- Publiczny kontakt wyświetla `kontakt@rexbid.pl`, również przy braku konfiguracji API. Formularz nadal przygotowuje lokalny szkic; skopiowanie, TXT i otwarcie mailto są jawnymi akcjami użytkownika. Po przygotowaniu szkicu fokus trafia do tekstu.
- [Formularz partnera](CALCULATOR_PARTNER_FORM.html) zbiera pierwszą brakującą grupę: port/kraj odprawy, zakres frachtu, cena/reguła i zakres port/broker/dokumenty z walutą, jednostką, netto/brutto, źródłem i datą. Dodatkowe osobne opłaty są opcjonalne. Formularz lokalny nie wysyła ani nie utrwala odpowiedzi; ma kopiowanie i TXT, jawne braki i blokadę połączeń/form-action. Instrukcja: [CALCULATOR_PARTNER_FORM.md](CALCULATOR_PARTNER_FORM.md).
- Scoped CSS kalkulatora i kontaktu zapewnia fokus klawiatury, 44 px pola i układ jednej kolumny na małym ekranie. Globalny branding i arkusze wspólne nie były edytowane.

## Kontrole

- Pakiet ukierunkowanych regresji: **63/63 PASS** (`calculator-polish`, `calculator-v4`, `import-budget`, `inquiry`, `inquiry-dom`, `car-navigation`, `vehicle-experience`). Testy DOM potwierdzają missing≠0, BEV 150 USD raz na auto, brak automatycznej dopłaty/zera HEV/PHEV, lądowy mnożnik i jeden preferowany terminal.
- Generator V4 `--check`: **PASS**, 610 lokalizacji, 24 stawki morskie, wersja `rex-partner-v4-f0a67460b203286f` bez zmian.
- Kontrola parity: **125 663/125 663 PASS**; rate object i kod poza `bindCalculator` identyczne z baseline.
- Składnia czterech zmienionych modułów publicznych: **PASS**.
- Składnia inline `car.html`, formularza partnera i modułu cache: **PASS**. Końcowy wspólny pakiet regresji UX + cache: **72/72 PASS** (te same 63 testy UX i 9 cache, bez sumowania powtórzeń).
- Dwie regresje z pełnej suite naprawione bez zmiany zachowania: izolowany mock `buildPage` otrzymał nową stałą `CATALOG_RETURN`; assertion infrastruktury sprawdza aktualny tekst sumy częściowej oraz missing≠0. Powtórzenie obu testów: **2/2 PASS**.

Pełna suite i wizualne QA należą do głównego zadania. Ten raport nie potwierdza wdrożenia ani przeglądarkowego działania na publicznym/stagingowym hostingu po tych zmianach.

## Dodatkowy moduł publicznego stored-read cache

`sync/stored-read-cache.cjs` eksportuje `cachedStoredRead(request, cache, load, {namespace, maxAgeSeconds, maxAgeMs, context})`. Domyślny limit 30 s, maksymalnie 30 s. `maxAgeMs` może ograniczyć granicę świeżości poniżej domyślnych 24 h. Klucz izoluje namespace, host, dokładną ścieżkę/identyfikator oraz całą query. Tylko GET czterech publicznych kształtów ścieżek; tylko 200 JSON bez Set-Cookie i pól prywatnych. Authorization/Cookie/mutacje/Auth/portal/błędy/payload provider są BYPASS.

HIT/MISS/BYPASS to wyłącznie bezpieczny header `X-RexBid-Cache`; nie ma logów identyfikatorów ani query. Cache używa klonów, fail match/put nie blokuje loadera, a `waitUntil` dotyczy wyłącznie zapisu. TTL maleje przy świeżości zbliżonej do granicy; odczyt HIT nie restartuje okresu i nie zmienia `last_seen_at`, `last_synced_at` ani statusu danych. **9/9 testów behawioralnych PASS**. Integracja do kontrolowanych stored routes pozostaje zakresem głównego agenta; moduł nie edytował Workera, staging routes, core ani config.

## Poprawka po rzeczywistym QA ulubionych

Snapshot ulubionego pomijał metadane `read` i daty obserwacji. Stale IAAI LOT `44140937` z ofertą 75 USD po zapisie pokazywał „Aktualna oferta”. `rexbid-storage.js` zachowuje teraz tylko bezpieczny zestaw source/freshness/read_only/timestamps również po sanitizacji i ponownym odczycie. Metadane nie zawierają całego payloadu ani sekretów.

Guest renderer w `ulubione.html` opisuje niekońcowe ceny jako „Ostatnia zapisana oferta” lub „Kup teraz · zapis danych”. Otwarte/live wydarzenie ma „Status do potwierdzenia”; datę aukcji oznaczono „Termin z zapisu”. Notka używa rzeczywistej daty obserwacji, nie daty dodania ulubionego. Legacy bez metadanych pozostaje używalne, z „Data obserwacji nieustalona” i bez zapewnienia o aktualności. Potwierdzone ceny i wyniki historyczne zachowano.

Regresje storage/favorites: **14/14 PASS**. Łącznie z istniejącymi testami kont/identity-only merge i kartą auta: **35/35 PASS**. Bez zmiany Auth API, algorytmu merge, schematu klucza VIN/LOT/platform ani usuwania danych użytkownika. Ta poprawka jest lokalna; główny agent wykonuje końcowy bump asset hash, rzeczywiste QA i ewentualne zatwierdzone wdrożenie.
