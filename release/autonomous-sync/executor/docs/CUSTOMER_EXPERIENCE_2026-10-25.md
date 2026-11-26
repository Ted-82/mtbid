# REXBID — przewodnik, pomoc, kontakt, filtry i płynne przejścia

## Wydanie ukończone 25.10.2026

- Produkcja: https://rexbid.pl — **d2099ce5-a45c-4951-8ce7-ee98828c3934**.
- Staging: https://rexbid-auth-test.tedn828.workers.dev — **1e8672e3-7f55-414f-bcff-cd8086618f78**.
- Punkt wyjścia: `a36ffd115af29ceb85873026fd265274b67ba4bc`.
- Checkpoint: commit dodający ten raport; `git log -1 --format=%H -- docs/CUSTOMER_EXPERIENCE_2026-10-25.md`. Bez pusha.
- Dowody lokalne: `C:/Users/nowic/Documents/Codex/REXBID_CUSTOMER_EXPERIENCE_20261025`.

## Co wykonano

| Obszar | Wynik |
| --- | --- |
| `/jak-to-dziala` | Nowy autorski układ, cztery główne fazy, siedem rozwijanych etapów importu, wynik każdego etapu, lista danych do wyceny i trzy wejścia zależne od sytuacji klienta. |
| `/pomoc` | Nowe centrum pomocy: 28 odpowiedzi w pięciu kategoriach, lokalne wyszukiwanie wielu słów z obsługą polskich znaków, licznik, czyszczenie, pusty wynik i odpowiedzi dostępne także bez JavaScript. |
| `/o-nas` | Przebudowana prezentacja rzeczywistych narzędzi i operatora. Wykorzystano potwierdzone dane firmy; nie dodano fikcyjnych pracowników, referencji, statystyk, numerów telefonu ani terminów dostaw. |
| `/kontakt` | Trzy wejścia: nowe zapytanie, istniejąca realizacja, pomoc. Proces uzupełnij → sprawdź → wyślij. Trzy gotowe pytania dopisywane bez nadpisania treści, duplikatów i obcinania tekstu przy limicie. |
| Wiadomość kontaktowa | Temat zawiera platformę, LOT i rodzaj pytania. Zachowane VIN, link, planowana cena i powrót do filtrowanego katalogu. Wymagane imię/e-mail/wiadomość. Nadal lokalny szkic: użytkownik wysyła wiadomość w swoim programie pocztowym. |
| Home i nawigacja | Nowe wejścia do porównania, przewodnika i pomocy; Pomoc w menu całego serwisu i stopce. Nowa sekcja jest ukryta w trybie katalogu. |
| Pierwsze wyświetlenie stron | Docelowe menu i przycisk mobilny są w HTML 14 stron. JavaScript zachowuje te same węzły zamiast wymieniać stare menu. Menu prowadzi bezpośrednio do adresów bez `.html`, aktywna strona ma oznaczenie. Katalog otrzymuje docelowy widok z Workera przed wykonaniem JS. |
| Galeria dotykowa | Przesunięcie zmienia zdjęcie w widoku dopasowanym; pinch i podwójne stuknięcie powiększają; powiększony obraz można przesuwać w granicach kadru. Powiększenie 100–500%, reset, anulowanie gestu, utrata kontaktu i zmiana orientacji obsłużone. Osobna ścieżka Touch Events dla przeglądarek bez Pointer Events. |
| Filtry | Polskie opisy znanych paliw, skrzyń, uszkodzeń i nadwozi. Różne surowe wartości o tej samej etykiecie nie znikają; zachowano osobne zapytania backendu i sprawdzone grupowanie napędów D1. Nieznane/ucięte kody pozostały jawne. |
| Dokument sprzedaży | Wycofano mylące opcje `danger/success/other`: są kodem prezentacji/niedookreślonym typem, nie nazwą dokumentu. Gdy brak wiarygodnych opcji, filtr informuje, że dokument należy sprawdzić na karcie. Stary filtr z URL jest jawnie oznaczony i możliwy do usunięcia. |
| Metadane | Dodano pomoc do mapy witryny. Naprawiono mapowanie opisów i metadanych informacyjnych stron pod adresami bez `.html`; staging `/pomoc` zachowuje wrapper noindex i zabezpieczenia. Zmienione zasoby mają nowe wersje cache. |

Inspiracją były przekazane zrzuty konkurenta: łatwe wejścia do pomocy, proces zakupu i spójne sekcje. Nie kopiowano jego tekstów, zdjęć, ludzi, opinii, map zasięgu ani statystyk. Pozostał granatowo-czerwony styl REXBID.

## Wykryte i naprawione błędy

1. Filtry deduplikowały opcje po przetłumaczonej etykiecie, choć backend używał różnych wartości. Przykład: `Gas` i `Gasoline`. Zachowano obie wartości z rozróżnieniem nazwy źródłowej; nie zmieniano semantyki zapytań D1.
2. Metadane dokumentów zawierały techniczne `danger/other/success`. Rzeczywisty odczyt D1/cache karty IAAI 43806658 potwierdził `name: SALVAGE` i `type: success`. Koloru nie prezentuje się już jako typu prawnego dokumentu.
3. Informacyjne adresy bez rozszerzenia nie miały tego samego mapowania metadanych co pliki `.html`. Sprawdzono na produkcji canonical, opis i Open Graph pod czterema adresami.
4. Zgłoszone miganie: HTML zawierał inne menu niż późniejszy skrypt, który usuwał i tworzył jego elementy. Widok katalogu zaczynał jako Home, a dopiero klient zmieniał tryb. Usunięto oba źródła zmiany pierwszego widoku; testy porównują rzeczywiste węzły menu i surową odpowiedź HTML katalogu.
5. Zgłoszona galeria iPhone: wcześniejszy kod zaczynał przeciąganie tylko przy `zoom > 1`, nie miał pinch, swipe ani podwójnego stuknięcia. Dodano moduł gestów bez requestów, zachowano przyciski, klawiaturę, fokus i obsługę błędnych zdjęć. Podczas gestu aktualizowany jest tylko transform obrazu. Mobilny licznik zoomu ma szerszy przycisk, aby 250–500% się mieściło.

## Kontrole i dowody

- **1275/1275 testów repo PASS** (poprzedni checkpoint 1223). Końcowy `tests-full-navigation-gallery.log`; po ostatniej korekcie szerokości przycisku także **28/28 regresji galerii PASS**, `gallery-gestures-tests.log`. Pierwszy przebieg sandboxu Windows miał EPERM przy atomowym rename w plikach tymczasowych; pełny przebieg wykonano w normalnym kontekście użytkownika bez zmiany uprawnień systemowych.
- Nowe testy gestów **13/13** obejmują oba kierunki swipe, błędne/krótkie/pionowe gesty, pinch i punkt zaczepienia, 100–500%, panning, przejście z dwóch palców do jednego, podwójne stuknięcie, cancel/lostcapture/blur/resize i fallback Touch Events. To syntetyczne zdarzenia w testach DOM, nie dowód testu fizycznego urządzenia Apple.
- Pierwszy widok i nawigacja: **16 nowych testów**, docelowy HTML 14 stron i zachowanie węzłów po bootstrapie, wszystkie obsługiwane parametry katalogu, Home oraz brak odbicia niebezpiecznych wartości do HTML. Skrypt `node scripts/build-navigation-shell.cjs --check` potwierdza 14/14 stron. Testy JSDOM `outside-only` pomijają zawartość noscript w scenariuszu z JS, bo parser JSDOM w tym trybie traktuje ją jako aktywną.
- Dodatkowa końcowa regresja aliasu pomocy/noindex: **14/14 PASS**, `alias-final-tests.log`.
- **22/22 HTTP staging, 25/25 HTTP produkcja PASS**: osiem stron z docelowym menu, surowy HTML filtrowanego katalogu, dziewięć plików zgodnych SHA256 z repo, cztery rzeczywiste karty Copart/IAAI z D1. Produkcja dodatkowo `/ready` blocked, nowa pozycja sitemap, www308 z zachowaniem ścieżki i parametrów. Pliki `public-check-staging.json`, `public-check-production.json`.
- Stawki V4: generator check PASS, **610 lokalizacji / 24 stawki morskie**, `rex-partner-v4-f0a67460b203286f`. Bez zmian kwot i formuł. Składnia zmienionych JS oraz `git diff --check` PASS.
- Walidator istniejącego profilu produkcji PASS: `portal-no-files`. Nie zmieniono produkcyjnej konfiguracji, uprawnień lub sekretów.

### Rzeczywista przeglądarka

| Kontrola | Wynik |
| --- | --- |
| Przewodnik desktop 1366×1000, telefon 390×844 | Układ, siedem etapów, rozwijanie, kotwice i przejścia PASS. |
| O firmie 1024×900 | Nagłówek, menu, układ i brak poziomego przepełnienia PASS. |
| Pomoc desktop/mobile | 28/28 po reset; kategoria Konto + `hasla` → jedna odpowiedź; Enter rozwija; nieznane hasło → stan pusty; `transport` → cztery; na produkcji `cena pod dom` → jedna. |
| Menu mobilne | Pomoc dostępna, wejście do kontaktu poprawne. |
| Przejścia staging i produkcja | Karta → Kontakt, Kontakt → przewodnik/Pomoc, przewodnik → katalog. Jedno spójne menu, oznaczenie aktywnej strony, poprawny pierwszy widok katalogu. Szerokości 390 i 1366, bez poziomego przepełnienia. |
| Galeria po zgłoszeniu iPhone | Rzeczywista przeglądarka w 390×844: dwuklik powoduje 250%, przyciski 100→125→100%, reset, następne zdjęcie 2/12, zamknięcie i przejście do Kontakt PASS na stagingu/produkcji. Interakcje pointer/mouse w rozmiarze mobilnym; fizyczny iPhone oraz rzeczywisty wielodotyk nie były dostępne. |
| Filtr uszkodzeń | Wybór „Przód” → URL `damage=Front+end`, 20 kart; techniczny dokument nie jest opcją domyślną. Nowa sekcja Home niewidoczna w katalogu. |
| Pełna ścieżka IAAI staging | Katalog z filtrem → KIA LOT46042096 → kontakt → karta → katalog: właściwy VIN/platforma/LOT oraz filtr zachowane. |
| Szkic staging | Syntetyczne dane Test QA/qa@example.invalid, dopisanie pytania, powtórzenie bez duplikatu, treść podglądu, temat z IAAI LOT46042096 PASS. Nie wysyłano wiadomości. |
| Copart produkcja/mobile | Tesla LOT57660876, 12/12 miniatur i główne zdjęcie załadowane. Lightbox 1→2/12 i Escape PASS. Historia zachowuje sprzedaż 9100 USD; stara data obserwacji nie jest przedstawiana jako bieżący odczyt. |
| Kalkulator → kontakt produkcja | Własne9100USD + znany transport1055USD =10155USD, jawna suma częściowa. Planowana cena9100USD, VIN i LOT trafiły do lokalnego szkicu z poprawnym tematem. |
| Home/mobile produkcja | Trzy nowe sekcje wejścia widoczne, przejście do przewodnika działa, brak poziomego przepełnienia. |

Zrzuty przed/po i końcowe są w katalogu dowodowym, m.in. `guide-before.png`, `guide-staging-desktop.png`, `help-production-desktop.png`, `guide-production-mobile.png`, `home-tools-production-mobile.png`, `inquiry-production-mobile.png`, `gallery-zoom-production-mobile.png`, `contact-final-production-desktop.png`. Testy formularzy użyły wyłącznie syntetycznych danych; pola zostały wyczyszczone, nie utworzono zapytań na serwerze ani nie wysłano e-maili.

Nie jest to nowy pomiar Core Web Vitals ani pełny audyt dostępności. Nie powtarzano odłożonego testu dwóch kont klient–właściciel. Poprzednie wyniki audytów prywatnych danych pozostają w poprzednim raporcie; nie deklaruje się ich ponownego wykonania w tym etapie.

## Dane, bezpieczeństwo i koszty

- **Zero wywołań Apibara**, bez odczytu quota przy wygasłym planie. Końcowy SELECT 25.10 **22:24:56 UTC**: `OPERATOR_STOP`, lease=null, automatic attempts **3254**, licznik łączny **7293**, ręczna kampania **2262** — bez zmian. Dowody `provider-stop-before.json` i `provider-stop-after.json`.
- Cron ma zachowaną konfigurację, ale utrwalony STOP blokuje transport. Nie wykonywano resume, fallbacku ani wznowienia historycznej kampanii STOP56.
- Brak zapisów/migracji D1 w tym etapie; dotychczasowy katalog **4535 ofert / 8302 snapshoty / 20990 wydarzeń** pochodzi z zakończonego wcześniejszego audytu. Nie wykonywano nowego pełnego eksportu prywatnych danych przy samych zmianach interfejsu. Zweryfikowane wcześniejsze kopie pozostają zachowane.
- Konta, realizacje, rozmowy, stagingowe pliki, MFA i stawki pozostają zachowane. Na stronach kont/prawnych ujednolicono nagłówek i odnośniki do zasobów; logika uwierzytelniania, role i zasady danych nie były zmieniane.
- **Nowe usługi i abonamenty: 0.** Wykorzystano posiadany Workers Paid; odczyty kontrolne i wdrożenia podlegają jego istniejącym limitom. Bez DNS, zakupów, zmiany planów, pusha i modyfikacji starego mtbid.

## Pozostałe ograniczenia i następny punkt pracy

1. Apibara wygasła: katalog nadal prezentuje zachowane dane. Ceny/dostępność wymagają potwierdzenia; nowy interfejs nie czyni ich świeżymi. Dotychczasowe braki historii nie zostały uzupełnione.
2. Filtrowanie po rzeczywistej nazwie dokumentu wymaga osobnego mapowania `sale_document.name` w D1/API i testów. W tym wydaniu naprawiono błędną prezentację kodów; nie udaje się działającego filtra prawnego. Można wykonać ten następny etap na zapisanej bazie bez Apibara.
3. Nieznane lub skrócone nazwy nadwozi pozostają w oryginale. Scalanie kolejnych synonimów wymaga równoważnego predykatu backendu, a nie samej wspólnej polskiej etykiety.
4. Kontakt przygotowuje e-mail, nie jest serwerowym helpdeskiem ani czatem na żywo. Panelowe rozmowy działają odrębnie; automatyczne powiadomienia i produkcyjne załączniki nadal OFF.
5. Pełny koszt dostawy wymaga brakujących potwierdzonych składników partnera. Kalkulator nie dopasowuje wyniku do ceny konkurenta.
6. Test dwóch kont klient–właściciel pozostaje odłożony przez właściciela; nie blokuje powyższego wydania publicznego. Treści prawne nadal do przeglądu właściciela/prawnego.
7. Do potwierdzenia na fizycznym iPhonie po odświeżeniu karty: dwa palce, przesuwanie powiększonego zdjęcia, swipe po dopasowaniu i podwójne stuknięcie. Przy dalszym problemie potrzebne wersja iOS/przeglądarka i wskazanie zdjęcia. Nie deklarować już wykonanego testu tego urządzenia.

## Rollback wyłącznie tego wydania

Przypięty Wrangler4.149.0 i `XDG_CONFIG_HOME=C:/Users/nowic/AppData/Roaming/xdg.config`:

- Produkcja: `rollback 0857772d-98da-4f87-b804-c46395b799bc --config wrangler.production-publication.jsonc`.
- Staging: `rollback ff88207a-ee41-447a-b915-d7bb5f8d38dc --config wrangler.staging.jsonc`.

Najpierw potwierdzić obecny Worker i wdrożenie. Nie odtwarzać starszej D1 przy cofnięciu interfejsu; pozostawić dane, indeksy i OPERATOR_STOP. Po cofnięciu sprawdzić katalog/kartę/kontakt/konto oraz `/ready`. Rollbacku nie wykonano.
