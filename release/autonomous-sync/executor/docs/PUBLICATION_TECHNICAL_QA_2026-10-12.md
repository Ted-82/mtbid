# Przygotowanie publikacji bez danych wspólnika — 12.10.2026

## Wykonany rezultat

Zachowano checkpoint d106c2f210271d911e4313fb714aa4adb323e478 i czysty stan początkowy. Domknięto techniczne przygotowanie pierwszego wydania na osobnym Workerze, bez publicznego uploadu, zmian DNS/produkcji, migracji, kont lub MFA.

1. **Robots i sitemap:** worker.publication.js generuje pliki dla https://rexbid.pl; nie podaje starego mtbid.workers.dev. Mapa zawiera sześć dostępnych stron informacyjnych, bez kont/panelu i fikcyjnego lastmod. Roboty nie indeksują API, kont, lokalnych ulubionych i diagnostyki. Staging zachowuje noindex i Disallow:/.
2. **Gotowość:** /ready w fazie catalog sprawdza rzeczywistą parę oferta/obserwacja i poprawny HTML assets, zamiast samego SELECT1 i wymagania klucza providera. Pusta baza/brak obserwacji/błąd assets dają503. Żadnego pobierania providera. Odpowiedź prywatna,no-store; szczegóły SQL/wierszy/sekretów nie są ujawniane. Zachowano CSP,HSTS,frameDENY,nosniff.
3. **Pakiet:** C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_PREP_20261012/candidate;53 pliki, zbudowany Worker + assets + dokładny profil + manifestSHA256 + instrukcja. Pakiet nie zawiera SQL, sekretów, kont ani testowych realizacji. Lokalny build z repo i niezależny dry-run z katalogu pakietu PASS. Nie używać starego wrangler.release.jsonc ani profilu mtbid.

## Rzeczywiste odczyty i ich ograniczenia

- Cloudflare metadata200: binding D1 **c8a30088-70af-43a6-9a7f-c4018279d37d**, dokładnie0 custom domains. Nazwy sześciu sekretów obecne: APIBARA_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, REXBID_AUTH_COOKIE_SECRET, REXBID_PORTAL_DATA_KEYS, REXBID_PORTAL_ACTIVE_KEY_ID. Wartości nie odczytane ani pokazane.
- Publikacyjna D1: **1817 ofert (945 Copart /872 IAAI),3253 snapshots,19044events,1638stanów historii**. FK0, duplikaty platforma/LOT0. Users/user_favorites/orders/events/messages/reads/files0. Zero zapisów operatora.
- Ostatnia obserwacja **2026-10-09T12:54:25.992Z**; nie odświeżono danych, nadal częściowy katalog.179 nowych ofert bez historii i167 wcześniejszych nierozstrzygniętych są wcześniejszym, zachowanym ograniczeniem; odczyt całości nie oznacza pełnego rynku.
- Nowy handler /ready z rzeczywistą odseparowaną D1 i lokalnym index.html: HTTP200, katalog/assetok, providerdisabled. To test lokalnego handlera z realną bazą; NIE publiczny domenowy E2E ani test nowego Workera na Cloudflare.
- Kopia publikacyjna z10.10: zweryfikowano ciphertext/plaintextSHA, odszyfrowanie i pełny restore w SQLite w pamięci: integrityok/FK0/counts zgodne, prywatne0. Backup nie nadpisany. To obecny komputer/DPAPI; drugi komputer nadal nietestowany. Odczyt countów nie dowodzi bajtowej identyczności obecnej bazy z kopią. Nowa kopia przed przyszłymi zapisami lub cutoverem, jeśli stan się zmieni.
- Account D1 Analytics17:31:38UTC:93625reads,0writes dnia12.10, przed końcowym odczytem operatora; metryki są opóźnione, nie końcowy rachunek. Dzisiejszy operator wykonywał SELECT/PRAGMA, nie zmieniał baz.
- /subscriptions API403; oddzielny zalogowany dashboard **potwierdził Free jako Current plan**. Paid pokazuje **5 USD/mies. +usage**. Nie kliknięto Upgrade i nie zakupiono abonamentu. Koszt tego etapu0USD.

## Testy

- Pełny node--test: **912/912PASS** po robots/sitemap/readiness. Po końcowym dodaniu spójnych nagłówków /ready ponowiono adekwatny suite publikacji: **20/20PASS**. Poprzedni partner14/14 z12.10 zachowany; stawki nie zmienione.
- Regresje obejmują dokładny apex/sitemap,HEAD,405 dla mutacji, www308 zpath/query, brak kontaktu zD1/providerem dla sitemap, brak dostępu do Auth/portalu w fazie catalog, odrzucenie błędnego targetu/origin, gotowość przy pustej/błędnej bazie/HTML, prywatne nagłówki.
- prepare-production-publication --check, oba lokalne dry-runs i gitdiff--checkPASS. Nie powtarzano bez powodu ręcznego QA galerii/MFA/maili; wcześniejszy aktualny staging z12.10 pozostaje **5079f5f9-75ed-4231-869e-292157d0167e**.
- Nowe Apibara0, nowe maile0, abonamenty0. Kampanie/liczniki zachowane. Brak publicznego deployu; zmiany dotyczą wyłącznie entrypointu przyszłej publikacji, więc nie wykonywano pozornego redeployu stagingu.

## Do uruchomienia pozostaje

1. Akceptacja końcowych dokumentów i proponowanej retencji oraz osobna zgoda na konkretną publikację/delegację w FINAL_PUBLICATION_APPROVAL.md. Dane firmy/adres/wariantA i wybór Zimbra są potwierdzone; nie pytać o nie ponownie.
2. Przed publicznym ruchem rekomendowana aktywacja WorkersPaid5USD/mies.+usage przez właściciela, z kontrolą checkoutu. Free ma dzienne limity; alert nie jest twardym limitem kosztów. Auth/portal/plikiOFF, zatem SupabasePro i produkcyjne koszty plików nie są potrzebne do pierwszego katalogu.
3. W zatwierdzonym oknie: ponowny DS bezpośrednio przed delegacją, aktualna kopia/DNSsnapshot, podłączenie nowego Workera/apex/www i TLS, własny smoke oraz kontrola poczty. DNSSEC Cloudflare/nowyDS dopiero po stabilizacji i osobnej zgodzie.

Braki wspólnika dotyczą pełnej wyceny i obsługi płatnego importu. Nie blokują przygotowania i przeglądu pierwszego katalogu z jawnie niepełnym V4. Dane z8–9.10 przed prezentacją odświeżyć kontrolowanie po ponownym wznowieniu13.10, zquota/backupem; nie działa żaden harmonogram w tle.

## Rollback i dowody

Kod: nowy Worker ma własne wersje; nie używać mtbid jako fallbacku. Przed pierwszym uruchomieniem nie istnieje poprzedni działający publiczny katalog tego Workera — w razie błędu wycofać jego routing, zachowując pocztę. Dane: freeze+backup incydentu, restore do nowej D1, schema/FK/count/readback i dopiero zatwierdzony rebind; żadnego destrukcyjnego dumpu do działającej bazy. Delegacja/DS/TTL według obecnego runbooku.

Dowody poza Git: C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_PREP_20261012/resource-audit.json,backup-restore.json,billing-ui.json,billing-ui.png,full-tests.log,final-publication-tests.log,final-dryrun.log,package-dryrun.log oraz candidate/MANIFEST.json. Katalog i ZIP pakietu nie zawierają prywatnych danych.
