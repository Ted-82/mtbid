# REXBID — następny etap produkcyjny

Data: 2026-10-06. Domena: **rexbid.pl**. Punkt wyjścia: profesjonalny V5, lokalny commit `c1e16dd03a0c3241bbd1e7156d2e699d8e3151c1`. Istniejące funkcje, dane partnera i działający staging V4 pozostają bazą dalszego rozwoju.

## Cel następnego dużego etapu

**Pojazd → wycena z jasno opisanym zakresem → zapytanie zapisane i rzeczywiście odebrane przez REXBID.** Ten etap obejmuje działający katalog produkcyjny z kontrolą świeżości, kalkulator oparty na potwierdzonym profilu usługi, backend zapytań oraz prostą obsługę zapytania przez zespół. Formularz nie może ogłaszać wysłania przed rzeczywistym przyjęciem wiadomości. Wycena zachowuje źródło stawek, kurs i datę oraz rozróżnia brak danych od potwierdzonego zera.

Nie zaliczamy do tego etapu własnego systemu aukcyjnego, depozytów, płatności ani śledzenia transportu. Te funkcje wymagają odrębnego zakresu i integracji operacyjnych.

## Stan modułów

| Moduł | Co już istnieje | Co pozostało przed produkcją |
| --- | --- | --- |
| Home, katalog i karta pojazdu | Nowy V5, działające filtry/LOT/VIN/paginacja, galeria, oddzielne ceny | Test rzeczywistego nowego wyglądu w przeglądarce na desktopie i telefonie |
| Dane katalogu | Repozytorium D1 i częściowy staging V4; 579 ofert to historyczny pomiar stagingu | Aktualny audyt schematu produkcji, kontrolowane zasilenie danych, odświeżanie z limitem i obserwacja świeżości |
| Transport | 610 lokalizacji, 24 stawki morskie, preferowane terminale, reguły gabarytu, BEV 150 USD | Port docelowy, zakres frachtu i usług EU, ważność cen i wyjątki |
| Pełna wycena | Ścisły silnik oraz ręczny arkusz budżetu PLN | Własne opłaty, profile aukcyjne, odprawa/dostawa i zweryfikowane podstawy podatkowe/kursy |
| Kontakt | Kontekst auta i budżetu, lokalny draft/TXT, opcjonalny link pocztowy | Trwałe przyjęcie zapytania, identyfikator, status i dostarczenie do zespołu |
| Konta | Istniejący moduł Accounts i wcześniejsze testy stagingowe | Produkcyjny Auth/limiter/mail oraz pełny scenariusz logowania, recovery, ulubionych i eksportu |
| Domena i wdrożenie | Przygotowany osobny preview; znana domena właściciela | Uwierzytelniona sesja Cloudflare, sprawdzenie routingu, test wydania i możliwość powrotu |

W tej sesji naprawiono routing eksportu danych konta `/api/me/export`. Nowe testy integracyjne uruchamiają rzeczywisty Worker i Accounts, sprawdzając izolację użytkowników oraz istniejące blokady. Przygotowano też osobny, domyślnie wyłączony kandydat produkcyjnego odczytu D1 i wersjonowany profil danych handlowych. Katalog, karta auta, kalkulator i eksport budżetu zachowują datę oraz status zapisanych cen. Nie oznacza to publikacji, migracji ani kompletnej wyceny.

## Konkretny kandydat do dalszej integracji

- `worker.production.js` / `wrangler.release.jsonc`: exact `https://rexbid.pl`, wyłącznie produkcyjna `rexbid-db`, odczyty bez providera, kontrola rzeczywistego schematu; osobne flagi aktywacji i indeksowania pozostają wyłączone.
- `config/rexbid-commercial-profile.json`: uporządkowany szkic brakujących danych, bez wymyślonych kwot. Validator sprawdza źródła, daty, zakresy i podwójne naliczenia; pierwsza niegotowa grupa to port/odprawa/fracht. Pakiet portowy może być sumą rozpiski albo osobnymi pozycjami z własnymi źródłami.
- `npm run check:production`: sprawdzenie **wyłączonego kandydata**, nie zgoda na publikację.
- `npm run check:commercial`: poprawny szkic daje `review_required`. `node scripts/validate-commercial-profile.cjs --require-ready` ma obecnie odrzucić gotowość kodem 1. Nawet pełny profil ma `complete_offer: false` i `production_ready: false`, bo jest wejściem do implementacji modelu kosztów.

Nie wdrażać nieaktywnego `wrangler.release.jsonc` na działający Worker `mtbid`: wszystkie żądania otrzymają 503. Aktywacja wymaga osobno sprawdzonej konfiguracji i spełnienia kryteriów wydania. Nie zmieniono dotychczasowego `wrangler.jsonc`, konfiguracji stagingu/preview ani schematów zdalnych baz.

## Dane od właściciela — krok 1

Dotychczasowy cennik transportowy został odczytany. **Nie potrzeba przesyłać go w całości ponownie.** Na zdjęciu `data/partner/RexBid_Calculator_V4_2026-10-04/sources/IMG_20261002_120158716.jpg` widać zakładkę CargoLoop **Additional Services**, ale jej treści nie ma w dostarczonych plikach. Jej zrzut/eksport może uzupełnić kilka braków.

1. Do jakiego portu w Europie odnoszą się przekazane stawki morskie i w jakim kraju standardowo odbywa się odprawa?
2. Co dokładnie obejmuje fracht: załadunek, eksport/dokumenty, ubezpieczenie i opłaty po dopłynięciu? Które pozycje są dodatkowo płatne?
3. Jakie są opłaty portu, rozładunku i agencji/odprawy: kwota lub reguła, waluta, netto/brutto i zakres pakietu? Jeśli są osobne, podać je osobno; nie wymagać jednego fikcyjnego pakietu.

Jeśli tych odpowiedzi nie ma w zakładce, wystarczy potwierdzona rozpiska wspólnika lub partnera. Brak informacji pozostaje brakiem, a nie zerem. Kontaktu partnera nie publikujemy jako adresu REXBID.

## Kolejne grupy — po pierwszej odpowiedzi

1. Prowizja REXBID: kwota/reguła, waluta, netto/brutto, zakres; dostawa Europa → Polska: cennik strefowy/odległościowy albo indywidualna wycena.
2. Copart i IAAI: właściwy profil konta, płatności i sposobu licytacji oraz aktualna tabela lub zanonimizowana rzeczywista rozpiska opłat. Bez loginów i haseł.
3. Wyjątki logistyczne i ważność: progi gabarytów i dopuszczalny załadunek, HEV/PHEV, uszkodzona bateria/niesprawne auto, konflikt Albany oraz okres obowiązywania cen.

Po ustaleniu portu i kraju odprawy po naszej stronie pozostaje weryfikacja źródeł podatkowych i kursów. Nie oczekujemy, że właściciel sam opracuje przepisy. Kompletność profilu handlowego umożliwia budowę modelu kosztów; nie jest jeszcze potwierdzeniem prawidłowości pełnej oferty dla konkretnego samochodu.

## Kolejność wdrożenia

1. Uruchomić nowy wygląd na odizolowanym `preview.rexbid.pl`, wykonać browser QA i skorygować rzeczywiste usterki. Stagingowa D1 służy tylko do review.
2. W uwierzytelnionym środowisku odczytać aktualny schemat i migracje **produkcyjnej** `rexbid-db`, przygotować backup/punkt odzyskiwania i plan przywrócenia. Raport z 3 października nie zastępuje nowego audytu.
3. Przygotować addytywny schemat i kontrolowane zasilenie produkcji, z potwierdzonym budżetem providera. Samo wejście klienta na stronę nie uruchamia synchronizacji. Nie przedstawiać danych stagingu jako produkcyjnego katalogu.
4. Dodać trwałą obsługę zapytań oraz zweryfikować odbiór przez zespół. Uzupełniać profil wyceny po jednej potwierdzonej grupie, z regresjami dla nakładających się opłat i nieznanych wartości.
5. Przejść pięć porównywalnych scenariuszy auta od ceny zakupu do dostawy; osobno sprawdzić logowanie, recovery, ulubione, eksport i mobile. Funkcje wymagające niewdrożonego Auth pozostają jawnie niedostępne.
6. Dopiero po spełnieniu kryteriów wydania przełączyć `rexbid.pl` na zatwierdzony build. Obserwować błędy, odbiór zapytań, świeżość danych i budżet API; zachować działający poprzedni wariant.

Cloudflare nie jest uwierzytelniony w tej sesji. Nie wykonano deployu, zmiany DNS, migracji, zasilenia zdalnej D1, uruchomienia Cron ani pushowania. Jednorazowy odczyt `https://rexbid.pl/` zwrócił tutaj HTTP 502; nie jest to diagnoza globalnej awarii ani potwierdzenie DNS. Dotychczasowy staging zwrócił 200 i nie zawiera nowego arkusza `rexbid-portal.css`.

## Szacunek czasu

To szacunek zakresu pracy, nie obietnica terminu ani deklaracja pracy w tle.

| Wynik | Warunkowy nakład |
| --- | --- |
| Nowy wygląd pod własną subdomeną i rzeczywiste QA | Około 1–2 dni roboczych po udostępnieniu działającej sesji Cloudflare i strefy domeny |
| Pierwsza wersja produkcyjna: katalog, wycena w potwierdzonym zakresie, odbierane zapytania, podstawowa obsługa | Około 7–12 dni roboczych aktywnej pracy po uzyskaniu dostępu i podstawowych danych; integracja Auth/mail lub nowe problemy mogą wydłużyć ten zakres |
| Własna licytacja, depozyty/płatności i panel logistyki | Osobny projekt na kolejne tygodnie, do oszacowania po ustaleniu modelu operacyjnego i integracji |

Czekanie na partnera, poprawne profile opłat i dostęp do usług jest poza tym nakładem. Największe ryzyko terminu to kompletność danych wyceny, integracja produkcyjnego schematu oraz rzeczywista dostarczalność maili, nie dalsze poprawki koloru lub układu.

## Źródła techniczne sprawdzone w tej sesji

- Cloudflare Custom Domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Cloudflare D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- Cloudflare Workers rollback: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/

Procedura odzyskiwania bazy jest odrębna od powrotu do wersji Workera; zgodność schematu i starego kodu musi być sprawdzona przed wydaniem.
