# Dane i retencja — zatwierdzone zasady kont, 14.10.2026

## 15.10.2026 — zatwierdzone zasady panelu

Właściciel zatwierdził 15.10.2026 zakres portal-no-files oraz następujące zasady: profil do zmiany/usunięcia lub zamknięcia konta; dane przypisanych realizacji i rozmów do zakończenia obsługi +12miesięcy, następnie comiesięczny ręczny przegląd i usunięcie. Otwarte sprawy oraz minimum konkretnego obowiązku lub roszczenia wymagają odrębnej uzasadnionej daty przeglądu. Kopie30/90dni jak zatwierdzone wcześniej. Brak automatycznego cleanupu; niczego nie usunięto. Potwierdzenie przyjęcia zasad i faktyczny stan wdrożenia w ACCOUNTS_RELEASE_2026-10-14.md.

Poniższe sekcje opisują wcześniejszy auth-setup. Nie odnoszą jego wyłączonego portalu do aktualnej fazy portal-no-files.

**Zakres auth-setup: konto, dostęp i ulubione; portal i pliki OFF. Właściciel zatwierdził 14.10.2026 kryteria kont i ich kopii.** Pozostałe propozycje oznaczono oddzielnie. Akceptacja nie jest opinią prawną, automatycznym usuwaniem ani dowodem wykonania przeglądu. Nie usuwano danych ani nie zmieniano retencji usług przez edycję tego dokumentu.

## Historyczny stan auth-setup z 14.10.2026

Publiczny katalog rexbid.pl działa, Workers Paid zostało wcześniej aktywowane, a od 14.10 działa ograniczony Cron odświeżania katalogu. Zwykłe wejścia nadal korzystają z D1/cache i nie uruchamiają providera. Pięć tabel automatic_refresh_* przechowuje budżety, próby, stan i kolejkę automatu; nie są dziennikiem wizyt klienta i nie zawierają pól formularza kontaktowego. Nie ma ich czasowego cleanupu; wiek danych i limity pobrań nie są retencją.

Supabase production przywrócono do Healthy; **Free pozostaje**, bez nowego zakupu. Konta obejmują identity, sesje i ulubione, a nie portalowe profile, rozmowy lub pliki. Bieżącą pocztą kontaktową jest Zimbra OVH; Gmail zawiera wcześniejsze archiwum, bez automatycznego nowego przekierowania. Faktyczne wdrożenie oraz produkcyjne testy confirmation/recovery potwierdza osobny raport, nie sam opis retencji.

Własny przegląd kodu i oficjalnych stron nie jest nowym odczytem Cloudflare observability ani dowodem wykonania usunięcia przez dostawcę. Historyczne ustawienia i stany poniżej należy czytać z ich datą. Przy otwieraniu kont potwierdzić bieżącą konfigurację logów, nie kopiować dawnego 403 jako dzisiejszego wyniku.

## Tabela dla auth-setup

| Dane i cel | Faktyczne przechowywanie/usuwanie kodu | Zatwierdzone kryterium lub wymagane działanie |
| --- | --- | --- |
| Supabase identity i D1 users — konto | Konto nie ma aplikacyjnego TTL. D1 zawiera identity/UUID/status/datę, bez hasła i e-maila. Brak endpointu zamknięcia konta | Zatwierdzone: do zamknięcia na zweryfikowany wniosek, ręczna obsługa przez właściciela w imieniu LLC, kontakt@rexbid.pl. Oddzielić minimum konkretnego obowiązku/sporu. |
| Niepotwierdzona rejestracja | Wygaśnięcie wiadomości lub flow cookie nie usuwa automatycznie konta Supabase | Zatwierdzone: comiesięczny ręczny przegląd i usunięcie niepotwierdzonych rejestracji starszych niż 30 dni. Między przeglądami mogą pozostać dłużej. Nie wdrożono automatycznego cleanupu. |
| Ulubione w chmurze — lista klienta | D1 user_favorites, usuwanie pojedynczych pozycji, FK cascade do users; bez TTL | Do usunięcia pozycji lub zamknięcia konta. Ręczna procedura wymaga zgodnego usunięcia identity Supabase i D1. |
| Cookies i cache konta — dostęp | Cookie sesji 30 dni od ostatniego ustawienia, odnawiane; flow 10 min/1 h/24 h zależnie od operacji; recovery10min. Cache ulubionych bez TTL, czyszczony przez logout/401/switch | Opisać te fakty; nie nazywać Max-Age końcowym terminem sesji dostawcy. Usunięcie danych witryny jest dostępne użytkownikowi. |
| Eksport własny użytkownika | JSON konta+ulubionych; pobrany plik pozostaje na jego urządzeniu | Jasny zakres; pełny wniosek może wymagać uzupełnienia danych Supabase. Nie eksportować sekretów. |
| Minimalny rejestr zamknięć — korekty backupów | Procedura przygotowana, rejestr wykonanych usunięć nie jest jeszcze wynikiem testu | Zatwierdzone: pod kontrolą dostępu, poza Git, do usunięcia ostatniej kopii mogącej przywrócić konto. Dalszy konkretny obowiązek lub potrzebę dowodową uzasadnić osobno. Ponownie stosować usunięcia przed udostępnieniem odtworzonych danych. |
| Supabase Auth Audit Logs i API/DB logs | Oficjalne okna Free: odpowiednio1godzina i1dzień; nie sprawdzano zawartości ani fizycznego usunięcia | To osobne zbiory od kont i sesji; nie przypisywać im retencji users. Szczegóły źródłowe poniżej. |
| Resend — wiadomości dostępowe i logi | Dokumentacja Free:30dni, backupy7dni; region wysyłki nie ustala miejsca przechowania | Uwzględnić oddzielne zasady dostawcy i możliwość wcześniejszego wniosku; nie obiecywać usunięcia kopii odbiorcy. |
| D1 Time Travel i ręczne eksporty | Dokumentowane okno Paid30dni; ręczne szyfrowane eksporty mają własne przechowywanie | Usunięcie aktywnego rekordu nie czyści natychmiast obu rodzajów kopii. Przy restore zastosować rejestr usunięć. |
| Własne ręczne kopie prywatnych danych kont | Szyfrowane kopie, brak automatycznego wygaszania | Zatwierdzone: zwykłe do 30 dni, przed istotną migracją do 90 dni, ręczny przegląd co miesiąc. Zastąpić ostatnią sprawdzoną kopię nowszą sprawdzoną; ewentualne przedłużenie musi mieć odnotowane uzasadnienie. |

Podstawy, dokładne cookies, mapa danych i procedura zamknięcia: [ACCOUNT_DATA_PRIVACY.md](ACCOUNT_DATA_PRIVACY.md). Za ręczne przeglądy odpowiada właściciel działający w imieniu LLC; pierwszy przegląd najpóźniej 14.11.2026. Zatwierdzenie zasad nie jest wdrożeniem automatycznego harmonogramu ani dowodem wykonania usunięcia.

## Oficjalne źródła sprawdzone 14.10.2026

- [Supabase — cennik](https://supabase.com/pricing): rozróżnia Free Auth Audit Logs1h i API/Database logs1dzień. Brak automatycznych backupów w Free; to nie stwierdzenie braku wszelkich wewnętrznych kopii operacyjnych. Nie kupiono Pro.
- [Supabase — DPA](https://supabase.com/legal/customer-resources/data-processing-addendum): okres umowy i wcześniejsze usunięcie przez funkcje usługi; osobna zasada zwrotu/usunięcia po zakończeniu umowy nie jest TTL klienta REXBID. Właściwą stronę umowy i zakres działania w imieniu LLC trzeba potwierdzić.
- [Resend — GDPR](https://resend.com/security/gdpr):30dni dla maili/logów,7dni backupu,do90dni po zamknięciu konta; standardowy DPA obowiązuje od rejestracji na każdym planie. Dane przechowywane w USA, również dla domeny z wysyłką eu-west-1. Pobrać istniejący dokument ze Settings → Documents; nie ma potrzeby nowego abonamentu tylko z tego powodu.
- [Cloudflare — Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/):Paid30dni,Free7dni; restore nadpisuje bazę i nie usuwa wcześniejszych punktów. Własny eksport odtwarzać najpierw w izolacji. Nie wykonywać Time Travel jako rutynowej procedury zamknięcia jednego konta.
- [Cloudflare — Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/): przechowywanie logów wymaga sprawdzenia rzeczywistej konfiguracji. Stan cennika lub same wywołania console nie dowodzą konkretnego trwałego zapisu w naszym projekcie.

Źródła dokumentują zasady dostawców; nie są potwierdzeniem daty usunięcia konkretnej wiadomości, konta, tokenu lub kopii. Żaden plik danych klientów, token ani hasło nie został zapisany w tym raporcie.

## Zapis decyzji właściciela — 14.10.2026

Właściciel zaakceptował pakiet z [karty uruchomienia kont](ACCOUNTS_RELEASE_2026-10-14.md): konto do zamknięcia na zweryfikowany wniosek, ulubione do usunięcia pozycji lub konta, comiesięczny przegląd niepotwierdzonych rejestracji starszych niż 30 dni, ręczne kopie zwykłe do 30 dni i przed istotną migracją do 90 dni. Wnioski i przeglądy obsługuje ręcznie w imieniu LLC. Rejestr wykonanych usunięć pozostaje do zniknięcia ostatniej kopii mogącej przywrócić konto. Odpowiedź właściciela: „zatwierdzam […] działaj dalej”. Nie wykonano kasowania na podstawie samego zapisu decyzji.

## Co pozostaje odrębne lub nieweryfikowane

Ta zgoda nie obejmuje propozycji 12 miesięcy dla zamkniętej korespondencji ani 30 dni dla własnych rutynowych logów. Właściwe warunki i strony istniejących usług wymagają odrębnej kontroli; przyjęcie zasad operacyjnych nie jest opinią prawną. Należy rzeczywiście sprawdzić procedurę zamknięcia na koncie testowym oraz produkcyjne confirmation/recovery. Dostęp wspólnika, retencja realizacji i plików pozostają odrębnym zakresem. Wcześniej potwierdzonej nazwy/adresu firmy i wariantu A nie trzeba potwierdzać ponownie.

## Historyczne przeglądy — zachowane z ich pierwotnymi datami

Poniższe zapisy dokumentują wcześniejszy zakres katalogu, stan usług i proponowane okresy. Stwierdzenia o AuthOFF/CronOFF, nieaktywnej Zimbra, dawnym przekierowaniu, nieznanym planie Workers lub nieudanym API nie są automatycznie aktualnym stanem. Propozycje 12 miesięcy dla korespondencji i 30 dni dla własnych logów pozostają niezatwierdzone. Zasady 30/90 dni dla kopii kont rozstrzygnięto powyżej 14.10.2026; nie rozszerza to automatycznie okresów na wszystkie archiwa projektu ani nie dowodzi wykonanego usuwania.

---

# Przegląd danych i retencji — wariant A, PUBLICATION

Status: **przegląd faktycznego kodu i metadanych; propozycja okresów wymaga zatwierdzenia. Nie wdrożono automatycznego usuwania.** Data aktualizacji: 2026-10-10. Historyczny odczyt 8.10 zachowano poniżej; aktualny odczyt Cloudflare 10.10 o 15:53:47 UTC / 17:53:47 CEST opisuje sekcja aktualizacji.

Wariant A: właściciel obsługuje wiadomości i klientów w imieniu **REX AUTO CARGOLOOP L.L.C**. Operatorem serwisu i administratorem danych jest firma; użytkownik pozostaje administratorem technicznym. Potwierdzone dane firmy: **1209 Mountain Road Pl NE, Ste N, Albuquerque NM 87110, United States**; kontakt: **kontakt@rexbid.pl**. Te dane nie rozstrzygają jurysdykcji, roli prawnej poszczególnych dostawców ani okresów ustawowych dla przyszłej sprzedaży/importu.

## 1. Zakres potwierdzony w kodzie

Przygotowany pierwszy zakres PUBLICATION to zapisany katalog D1, karta auta, filtry, historia publicznych obserwacji, media przez zewnętrzne URL, kalkulator V4, lokalne ulubione i przygotowanie zapytania. `wrangler.production-publication.jsonc:15,27–36` wyłącza Auth, portal, pliki i legacy Sync oraz wybiera fazę `catalog` i odczyt `stored`. Wrapper `worker.publication.js:56–68` odrzuca niespójną konfigurację, w tym obecność bindingu `REXBID_PRIVATE_FILES`. Konfiguracja publikacji nie ma `r2_buckets` ani Cron Triggers; wrapper nie eksportuje handlera `scheduled`.

`worker.publication.js:105–118` przekazuje katalog do `handleStoredRead`. `staging/d1-primary-reads.cjs:156–163` uruchamia go z `storedOnly=true` i bez delegata providera. Niedostępna albo brakująca D1 daje błąd zamiast połączenia z providerem (`:181–188`). `sync/d1-read-repository.js:133–324` wykonuje odczyty SELECT. Wyłączone API Auth zatrzymuje żądanie przed obsługą sesji (`auth/routes.js:34,423–425`); portal jest blokowany przed handlerem (`worker.js:2447–2455`), a zapis Sync przed wykonaniem synchronizacji (`worker.js:2558–2560`).

To zakres przygotowanego wydania. Opis aktualnego prywatnego wdrożenia poniżej nie jest dowodem publicznego wdrożenia tego wrappera. Funkcje i dane testowe stagingu oraz prywatne R2 nie zostały włączone do pierwszego zakresu PUBLICATION.

## 2. Bieżące metadane Cloudflare — odczyt, bez zmian

Użyto istniejącego, lokalnego Wranglera i istniejącego profilu OAuth. Token obsługiwano wyłącznie w pamięci; wynik i lokalny log redagowano. Nie pobierano wartości bindingów sekretów, rekordów klientów ani treści logów. Wywołania API były GET metadanych; nie wykonano żądań Apibara ani zapisu zdalnego.

| Odczyt | Rzeczywisty wynik | Granica wniosku |
| --- | --- | --- |
| Ustawienia `rexbid-production-preflight` | HTTP 200; `observability=null`, `logpush=false`, `usage_model=standard`, 0 `tail_consumers` | API nie zwróciło konfiguracji aktywnego przechowywania Workers Logs. `standard` nie potwierdza planu Free/Paid ani czasu retencji. |
| Harmonogramy tego Workera | HTTP 200; `schedules=[]` | Brak bieżących Cron Triggers dla tego Workera. |
| Aktualne wdrożenie | HTTP 200; wersja `0a876baa-7b80-44ce-9d85-602ff8c82314`, 100%, wdrożona 2026-10-07 15:24:21 UTC | Nadal istnieje prywatny preflight. Nie jest to wersja nowego PUBLICATION wrappera. |
| Flagi prywatnego preflightu | Auth `false`, portal/pliki `disabled`, legacy Sync i D1 primary reads `false` | Prywatny preflight nadal ma binding R2; przygotowany wrapper publikacji wymaga jego braku. Wyłączone pliki nie oznaczają usunięcia osobnego zasobu R2. |
| Metadane publikacyjnej D1 | HTTP 200; `version=production`, 23 tabele, 8 220 672 B, read replication `disabled` | Potwierdzono backend obsługujący Time Travel. Nie odczytywano danych ani aktualnego planu konta. |
| Lista Logpush na koncie | HTTP 403, kod 10000 | Zewnętrzne eksporty na poziomie konta, ich miejsca docelowe i retencja pozostają **NOT VERIFIED**. `logpush=false` dotyczy odczytanego Workera. |

Wcześniejszy receipt `.codex-wrangler-cache/mfa-log-availability.json` dotyczy stagingu z 6.10: settings 200, `observability=null`, historyczne telemetry query 403. Nie użyto go jako potwierdzenia dzisiejszej publikacji. Wstępne nieudane próby bieżącego odczytu były związane ze ścieżką profilu/poziomem logowania CLI oraz dostępem do sieci; rozstrzygające są powyższe udane odczyty.

## 3. Przepływy danych i faktyczne przechowywanie

**Żądania i logi.** Cloudflare otrzymuje techniczne dane połączenia potrzebne do obsługi żądania, w tym adres IP, URL i nagłówki. Własny logger `worker.js:1735–1737,2786–2797` emituje request ID, metodę, trasę, status, czas i oznaczenia operacji. Nie przekazuje query, body ani nagłówków. `staging/d1-primary-reads.cjs:38–47` emituje losowy request ID, szablon trasy, źródło, trafienie D1, platformę, świeżość, powód fallbacku, czas i status. Ten logger działa także w publikacyjnym odczycie `stored`, mimo etykiety „staging public read”. Cache HIT omija loader i nie tworzy nowego wpisu `logRead`. Samo `console.info` nie potwierdza trwałego przechowywania logów u dostawcy.

Podczas audytu wykryto, że `safeRoute` zwracał surowy pathname dla nieznanych tras (`worker.js:1562`). Poprawiono fallback do stałych szablonów: /:unmatched, /:asset i ograniczonych prefiksów API. Regresja wykonuje rzeczywisty handler z fikcyjnym e-mailem, VIN i tokenem w nieznanej ścieżce oraz sprawdza, że własny log nie zawiera tych danych. Test PASS; nie jest to zmiana konfiguracji logów platformy. Normalizacja własnego logu nie zastępuje sprawdzenia ustawień logów wywołań Cloudflare.

**Przeglądarka.** `public/rexbid-storage.js:4–5,152–183` zapisuje `rex_bid_local_v1`: ulubione z VIN albo platformą/LOT, metadanymi pojazdu, URL miniatury i datą zapisu. Nie ma TTL ani terminu wygaśnięcia. Jest usunięcie pojedynczego ulubionego i funkcja czyszczenia ulubionych (`:230,237`). Import `mtbid_favorites` nie usuwa starego klucza. `public/car.html:3606–3665` zapisuje `rex_bid_auction_history_v1`: klucze platforma/LOT/VIN oraz obserwacje czasu, fazy, statusu, ceny i dat aukcji. Limit to **500 obserwacji na pojazd**, bez TTL, limitu łącznej liczby pojazdów i automatycznego usuwania starych kluczy. Usunięcie ulubionego nie usuwa tej historii. Odwiedzający może wyczyścić oba zbiory przez ustawienia danych witryny w przeglądarce.

Kod publicznych stron nie zawiera zapisu cookies przez `document.cookie`, service workera, IndexedDB ani podłączonego skryptu analityki marketingowej. W fazie catalog aplikacja nie tworzy sesji Auth. Nie jest to dowód, że platforma nigdy nie ustawi technicznego cookie bezpieczeństwa: konfiguracji strefy i rzeczywistych cookies przyszłej publicznej domeny nie potwierdzono. Klucze cloud favorites i cookies Auth należą do osobnego zakresu Auth/staging; nie należy deklarować ich aktywności w PUBLICATION.

**Cache.** `sync/stored-read-cache.cjs:3,13–22,66–82,90–133` dopuszcza cache wyłącznie publicznych odpowiedzi JSON z D1, dla GET, bez Cookie/Authorization/Range i wybranych parametrów wrażliwych. TTL wynosi maksymalnie **30 s**, a niekiedy mniej. Klucz zachowuje pełną ścieżkę i query; nie jest historią użytkownika. Odmowa cache daje `private, no-store`. HTML `.html` ma `no-cache`, czyli ponowne sprawdzenie przed użyciem, a nie obietnicę fizycznego usunięcia (`worker.js:1708–1711`). Prywatne ścieżki mają `private, no-store`. Zasoby statyczne mogą pozostać w cache przeglądarki; ich usunięcie/eviction zależy także od przeglądarki i platformy.

**Formularz i korespondencja.** `public/kontakt.html:5–9` wymaga imienia, e-maila do odpowiedzi i wiadomości; temat jest wybierany, budżet opcjonalny. `public/rexbid-inquiry.js:93–120` zatrzymuje submit, tworzy szkic w pamięci strony, pozwala kopiować, pobrać TXT i otworzyć mailto. Jedyny fetch pobiera publiczne `/api/contact/config` z `credentials=omit`; nie wysyła wpisanych pól. Odwołanie `blob:` jest zwalniane po sekundzie; pobrany plik i schowek pozostają pod kontrolą urządzenia użytkownika. Autouzupełnianie imienia/e-maila to funkcja przeglądarki, nie baza formularzy REXBID.

Przejście z karty do kontaktu umieszcza kontekst pojazdu i opcjonalną kwotę kalkulatora/budżetu w URL (`public/car.html:2683,3088–3097`). Taki URL dociera do serwera i może podlegać logom platformy; stwierdzenie „treść formularza nie jest wysyłana” nie obejmuje tych parametrów nawigacji.

Dopiero samodzielne wysłanie e-maila tworzy korespondencję administratora: adres nadawcy, treść, kontekst auta/budżetu, nagłówki i ewentualne załączniki. Aktualizacja 10.10 wieczorem: po zatwierdzonym zastąpieniu przekierowania działa skrzynka Zimbra OVH kontakt@rexbid.pl (Starter 15 GiB); wcześniejsze wiadomości pozostają w Gmailu projektu. Nowych wiadomości nie przekierowuje się automatycznie do Gmaila. Odbiór w Zimbra potwierdzono własnym odczytem, dostarczenie odpowiedzi do Gmaila — ręcznym potwierdzeniem właściciela. Reguł archiwizacji i kosza obu skrzynek oraz kolejek, logów lub kopii operacyjnych dostawców nie odczytano; obecna retencja pozostaje **nieustalona**. Usunięcie w skrzynce nie dowodzi usunięcia kopii operacyjnych dostawców.

**Media i D1.** Miniatury/galerie łączą przeglądarkę z hostami wskazanymi przez zewnętrzne URL (`public/car.html:2945–2964`); dostawca otrzymuje dane połączenia, a nagłówek `strict-origin-when-cross-origin` ogranicza Referer przy obrazie do originu (`worker.js:1636`). REXBID zachowuje URL/metadane i publiczne obserwacje D1, nie archiwum binarnych oryginałów. Retencja u hostów mediów nie została potwierdzona. W D1 istnieją także metadane ręcznej synchronizacji: scopes, runs, checkpoints i budżety/rezerwacje providera (`docs/proposals/0004_d1_sync_2.sql:175–267`, `sync/d1-repository.js:341,571–630`). To dane operacji katalogu, nie baza wizyt lub treści formularzy. W odczytach publikacji nie ma ich zapisu ani czasowego cleanupu; skasowanie krótkich `sync_batch_guards` po operacji nie usuwa historii runs/budżetów/snapshotów.

## 4. Retencja: stan obecny i proponowane kryteria

W poniższej tabeli okresy propozycji nie są opisem istniejącej automatyzacji ani potwierdzonej retencji dostawcy.

| Zbiór | Obecny okres i usuwanie | Proponowane kryterium / działanie |
| --- | --- | --- |
| Bieżąca korespondencja Zimbra OVH i historyczne archiwum Gmail | **Nieustalone**; brak potwierdzonej reguły czyszczenia lub autoarchiwizacji | Dla zamkniętego zapytania bez zawartej umowy: **12 miesięcy od zamknięcia**, potem ręczne usunięcie podczas **kwartalnego przeglądu** Zimbra oraz historycznego archiwum Gmail. Sprawy otwarte zachować do zakończenia; umowy, rozliczenia i roszczenia otrzymują osobno uzasadnione okresy, po ustaleniu prawa i obowiązków. Odnotować datę zamknięcia i przeglądu. |
| Własne trwałe pliki telemetrii/receipts operatora, jeśli faktycznie zapisane | Lokalne logi/receipts istnieją; brak wspólnego TTL i automatycznego cleanupu. Nie potwierdzono aktywnej trwałej telemetrii Workers Logs dla preflightu | Propozycja **30 dni od zapisu** dla rutynowej telemetrii technicznej rzeczywiście zachowanej przez administratora, z ręcznym okresowym przeglądem. Minimalny wyciąg dotyczący konkretnego incydentu można zachować do jego zamknięcia i zakończenia uzasadnionej potrzeby dowodowej. Nie przenosić tego okresu na logi Cloudflare. |
| Workers Logs / invocation logs Cloudflare | Runtime `observability=null`; rzeczywiste utrwalanie i retencja dla przyszłej publikacji **NOT VERIFIED** | Odczytać po faktycznym wdrożeniu `enabled`, `persist`, sampling, invocation logs, redakcję query i destinations. Stosować najkrótsze dostępne okno wystarczające do diagnozy; oddzielić celowe wyciągi incydentów. Brak obietnicy „30 dni” dla zarządzanego magazynu Workers Logs. |
| Zagregowane metryki Cloudflare / pozostałe logi platformy | Dane dostawcy; ustawień projektu nie potwierdzono. Metryki nie są własnym plikiem request logs | Wskazać odrębnie metryki zagregowane oraz dzienniki zdarzeń; potwierdzić plan i dostępne mechanizmy ograniczenia. Nie obiecywać indywidualnego usuwania metryk z interfejsu projektu. |
| Lokalna watchlista `rex_bid_local_v1` i legacy `mtbid_favorites` | Bez TTL; do usunięcia pozycji lub danych witryny przez odwiedzającego. Stary legacy klucz nie jest automatycznie usuwany | Opisać obecny stan. Ewentualne przyszłe wygaśnięcie wymaga decyzji i implementacji; nie zapowiadać istniejącego autocleanupu. |
| Lokalna historia `rex_bid_auction_history_v1` | Max 500 obserwacji na pojazd; bez czasu wygaśnięcia i łącznego limitu pojazdów | Opisać czyszczenie danych witryny. Osobny przyszły zakres: limit zbioru, okres lub przycisk usuwania historii; obecnie brak wdrożenia. |
| Cache publicznych odpowiedzi D1 | TTL do 30 s, kontrola wieku w kodzie; nie jest trwałą bazą wizyt | Zachować rozróżnienie czasu ważności cache i fizycznego przechowywania/eviction. |
| Publiczny katalog, snapshots, URL mediów i metadane sync D1 | Brak czasowego cleanupu; historyczne dane pozostają po wyłączeniu synchronizacji | Propozycja: zachowanie dla udokumentowanego celu historii aukcyjnej, z corocznym ręcznym przeglądem niezbędności, praw do źródła i wniosków o wycofanie; brak bezwarunkowej obietnicy wieczystego przechowywania. Nie ustawiać TTL na bazie progów „fresh/stale”: to oznaczenia aktualności, nie retencja. |
| D1 Time Travel | Backend production potwierdzony; dokładny plan konta **NOT VERIFIED** | Oddzielić retencję aktywnych danych od automatycznego okna odtworzenia dostawcy. Po usunięciu aktywnego rekordu historyczna kopia może nadal istnieć do zakończenia okna. |
| Ręczne szyfrowane kopie eksportów | Kopie opisane w `docs/BACKUP_RECOVERY.md:27–40`; brak potwierdzonego automatycznego wygaszania | Propozycja do akceptacji: zwykłe eksporty 30 dni, kopie przed zatwierdzonym wdrożeniem do 90 dni; ręczny przegląd co miesiąc, zawsze zachować ostatnią sprawdzoną kopię do czasu sprawdzenia nowszej. Uzasadniony incident/legal hold wstrzymuje usunięcie tylko potrzebnej kopii. Rejestr usunięcia i lista korekt muszą zapobiegać przywróceniu danych usuniętych na żądanie. Nie utożsamiać tego z D1 Time Travel. |
| Zewnętrzni dostawcy mediów oraz ich cache/logi | Okresy **NOT VERIFIED**, poza kodem REXBID | Wskazać odbiorców połączeń; potwierdzić ich właściwe informacje o przechowywaniu. |
| Auth, portal, prywatne R2 | Poza pierwszym PUBLICATION; ich dane i retencja stagingu są osobne | Przed uruchomieniem oddzielnie ustalić konta, sesje, wiadomości, receipts odczytu, pliki, Supabase/R2/D1 i backupy. Nie traktować obecnego off jako kasowania istniejącego stagingu. |

## 5. Dokumentacja dostawcy — nie jest readbackiem ustawień projektu

- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/): dokumentowany magazyn obejmuje własne logi oraz logi wywołań, które mogą opisywać metodę i URL. Na dzień przeglądu dokumentacja podaje **3 dni Free / 7 dni Paid**. Domyślne zachowanie nowo tworzonego Workera nie potwierdza aktywacji konkretnego wydania. Nie utożsamiać tego z wszystkimi dziennikami IP/security Cloudflare.
- [Get Worker Script Settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/): API pozwala sprawdzić m.in. utrwalanie, invocation logs, `redact_query_string` i miejsca eksportu. Trzeba sprawdzić faktyczny runtime po publikacji.
- [Workers metrics and analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/): zagregowane metryki Workera można przeglądać do **3 miesięcy** wstecz; analityka strefy opisuje okno **30 dni**. Są to odrębne dane od rekordów Workers Logs.
- [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/): cache API jest lokalny dla centrum danych i respektuje Cache-Control przy zapisie. Limit ważności odpowiedzi nie zastępuje polityki przechowywania pozostałych zbiorów.
- [Static Assets headers](https://developers.cloudflare.com/workers/static-assets/headers/): domyślne `public, max-age=0, must-revalidate` dopuszcza zachowanie kopii z ponownym sprawdzeniem przed użyciem. Kod Workera może nadpisać nagłówki.
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/): dla backendu production jest automatycznie włączony; dokumentowane okno wynosi **7 dni Free / 30 dni Paid**. Aktywna baza i ręczne eksporty mają osobną retencję.

## 6. Warunki zamknięcia przeglądu

1. Zatwierdzić kryterium 12 miesięcy dla zamkniętych zapytań i kwartalny ręczny przegląd; ustalić obsługę kosza Zimbra i historycznego archiwum Gmail oraz ograniczenia usuwania kopii operacyjnych dostawców.
2. Zatwierdzić proponowane 30 dni dla faktycznie zachowanych przez administratora rutynowych plików telemetrii; wskazać odpowiedzialnego za ręczny przegląd. Obecnie nie ma takiej automatyzacji.
3. Po właściwym wydaniu ponownie odczytać obserwowalność oraz zakres logów. Potwierdzić plan, pozostałe eksporty i metryki; obecne 403 nie dowodzi ich braku.
4. Normalizacja nieznanych ścieżek w loggerze i regresja PASS. Nie włączać telemetrii z pełnym URL/body/headers w ramach tego przeglądu.
5. Opisać istniejące lokalne storage bez obietnicy TTL; oddzielnie uzgodnić ewentualne przyszłe usuwanie.
6. Zachować osobny proces retencji kopii, danych katalogu i przyszłych Auth/portal/R2. Brak autocleanupu musi pozostać jawny aż do rzeczywistego wdrożenia i sprawdzenia procedury.

Sam przegląd metadanych nie zmienił usług ani retencji. W dalszej części tego samego sprintu poprawiono safeRoute i UI oraz wdrożono staging; opisuje to FINAL_ACCEPTANCE_QA_2026-10-08.md. Nie wykonano migracji, żądań providera, odczytu skrzynek ani usuwania danych. Propozycja nie jest wdrożeniem retencji ani finalną akceptacją prawną.

## Krótka karta retencji do końcowej akceptacji

| Dane i cel | Stan obecny | Propozycja |
| --- | --- | --- |
| Zwykła korespondencja — odpowiedź na zapytanie | Brak potwierdzonego TTL OVH/Gmail | 12 miesięcy od zamknięcia, ręczne usunięcie w kwartalnym przeglądzie; otwarte sprawy i uzasadnione roszczenia osobno |
| Własne rutynowe logi/receipts — diagnoza | Brak wspólnego automatycznego cleanupu | 30 dni, ręczny przegląd; minimalny wyciąg incydentu do zamknięcia jego celu |
| Lokalna watchlista i historia — wygoda odwiedzającego | Bez TTL; użytkownik czyści dane witryny, historia max500/pojazd | Zachować obecne kryterium kontroli użytkownika i jawny opis |
| Publiczny katalog — historia informacji aukcyjnych | Trwałe obserwacje i URL-e, brak TTL | Zachować podczas uzasadnionej potrzeby historii; coroczny przegląd celu i praw |
| Ręczne szyfrowane kopie — odtworzenie | Istniejące kopie, brak automatycznego wygaszania | 30 dni zwykłe / 90 dni przed wdrożeniem; miesięczny przegląd, nie usuwać ostatniej sprawdzonej kopii przed zastąpieniem |
| Logi/metryki/Time Travel dostawcy — infrastruktura | Dokładny plan/eksporty częściowo niezweryfikowane | Kontrola metadanych w oknie publikacji i najkrótszego dostępnego okna; bez obietnicy własnego TTL na logi dostawcy |

Za ręczne przeglądy odpowiada upoważniona osoba działająca w imieniu LLC; techniczny administrator wykonuje uzgodnione czynności. Ta akceptacja nie zezwala teraz na kasowanie danych, zmianę usług lub rotację kluczy. Weryfikacja umów poczty i transferów: [LEGAL_SCOPE_REVIEW.md](LEGAL_SCOPE_REVIEW.md).

## Historyczny odczyt 10.10.2026 przed zastąpieniem przekierowania przez Zimbra

Metadane Cloudflare o 15:53:47 UTC / 17:53:47 CEST: oba Workery mają observability=null, logpush=false, zero tail consumers i pustą listę Cron. Logpush konta: HTTP403, nadal niezweryfikowany. Nie pobierano treści logów. Aktualna D1 publikacyjna jest opisana w PUBLICATION_COMPLETION_QA_2026-10-10.md; wcześniejsze 8,2 MB w tabeli powyżej to historyczny odczyt, nie bieżący rozmiar. Źródło nowych metadanych: lokalny receipt REXBID_MAIL_DOCUMENTS_20261010/metadata-dns.json, poza Git.

Zalogowany OVH potwierdził usługę MX Plan typu redirect, 0/0 skrzynek, jedno przekierowanie kontakt@rexbid.pl → rexbid.kontakt@gmail.com. Nie ma dodatkowej skrzynki odbiorczej w tej usłudze; nie wyklucza to kolejek, logów i kopii operacyjnych dostawcy. Nie otwierano korespondencji ani kosza Gmaila, nie usuwano danych i nie testowano ich fizycznego usunięcia.

OVH pokazuje także istniejącą Zimbra Starter. Zamówienie zawiera Free starter account with domain, instalację i roczną usługę Starter; nie zamówiono nowej licencji. Obecna usługa ma odnowienie 5.10.2027, a domena 5.10.2028. Dokładnej ceny przyszłego odnowienia nie potwierdzono. Przygotowano jedynie logiczną organizację REXBID; nie zarejestrowano domeny w Zimbra, nie utworzono skrzynki lub hasła, nie zmieniono routingu ani DNS. Kreator proponuje automatyczne rekordy DNS i domenę autorytatywną, więc nie należy zatwierdzać domyślnego kroku bez planu zachowania obecnego przekierowania.

Na koncie technicznym są już zaakceptowane 5.10.2026 o 15:42 warunki Zimbra oraz DPA OVH. Odczytano wersje: Zimbra 20.01.2025 i DPA 17.10.2025. Nie akceptowano nowej umowy. DPA odnosi się do OVH sp. z o.o. i klienta konta; nie dowodzi, że LLC jest bezpośrednią stroną umowy. Obsługa przez upoważnionego administratora technicznego musi pozostawać w udokumentowanym zakresie wariantu A. Nie ustalono regionu przechowywania tej nieaktywowanej skrzynki.

Warunki Zimbra opisują kopie operacyjne bez gwarancji archiwum klienta, możliwe przechowanie do 15 dni po zakończeniu usługi oraz osobne okresy bezpieczeństwa dla wychodzącego spamu/złośliwych wiadomości. Nie są to terminy rutynowego usuwania całej korespondencji ani dowód retencji obecnej usługi redirect.

### Ręczna procedura po zaakceptowaniu retencji

1. Upoważniona osoba oznacza datę zamknięcia zapytania. Otwarta sprawa lub wymagane rozliczenia/roszczenia nie podlegają automatycznie regule zwykłego zapytania.
2. Co kwartał wybiera zamknięte zapytania bez umowy starsze niż 12 miesięcy, sprawdza powody dalszego zachowania i usuwa zatwierdzone pozycje w faktycznie używanej skrzynce. Nie wykonywać tego przeglądu przed akceptacją.
3. Osobno sprawdza kosz, własne eksporty i załączniki; nie obiecuje usunięcia kopii operatora poczty. Gdy kanał zostanie zmieniony, wcześniejsze wiadomości Gmail pozostają osobnym zbiorem do przeglądu, bez masowego kasowania lub przenoszenia.
4. Zapisuje wyłącznie datę przeglądu, zakres i wynik, bez treści wiadomości. Dla kopii technicznych stosuje osobny miesięczny przegląd i zachowuje ostatnią sprawdzoną kopię do zastąpienia.

Powyższa procedura jest propozycją, nie wdrożonym harmonogramem ani wykonanym usunięciem.

## Aktualizacja wieczorna 10.10.2026 — stan obowiązujący

Skrzynka kontakt@rexbid.pl jest aktywna w Zimbra, Starter 15 GiB, 1/1. Stare przekierowanie usunięto za zgodą właściciela; Gmail zachowuje wcześniejsze wiadomości, bez migracji lub kasowania. Test obu kierunków zakończony, z rozdzieleniem własnego odczytu i potwierdzenia właściciela w MAIL_DOCUMENTS_QA_2026-10-10.md. Nie zmieniono retencji i nie włączono automatycznego usuwania. Region przechowywania oraz rutynowa retencja kopii dostawcy pozostają niepotwierdzone. Wcześniejszy opis organizacji bez skrzynki jest historyczny.
