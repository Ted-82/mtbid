## 26.10.2026 — bieżące wydanie: odnowiona Apibara, aktualny katalog i sortowanie

Produkcja `rexbid-production-preflight` **58e64963-056a-46c7-8620-95cc86d77d53**, staging **f9a257da-f412-4786-acd9-1fbc3591d0af**. [Raport](LIVE_CATALOG_AND_ORDERING_2026-10-26.md). 1303 testy PASS; HTTP staging 34/34, produkcja 37/37; rzeczywisty readback i desktop/mobile. Profil portal-no-files bez zmian, DNS/sekrety/role/MFA bez zmian.

Apibara ponownie opłacona i wznowiona na wyraźne zlecenie właściciela. Automatyczny Cron co 15 min działa; ostatni kontrolny przebieg 09:45 UTC5/5 zapisów. 09:47 UTC:4575 ofert,224 unikalne odczytane w tym etapie, aktualne 198/198 z dzisiejszym odczytem. Licznik 7483, automat 3442; dostawca 187/30000. Dane publiczne czytane zD1, bez wywołań providera przy wejściu. Starsze instrukcje OPERATOR_STOP poniżej opisują poprzednie etapy. Nie zatrzymywać automatu przy zamknięciu pracy i nie wznawiać ręcznej kampanii 2262/STOP56.

Rollback kodu sprzed etapu: prod **ed11f566-ff4b-4786-8491-745fe1da2ceb**, stage **83b69ba5-e88e-4aa3-9f7f-477876a1ac1b**. Przypięty Wrangler 4.149.0 i wspólny XDG_CONFIG_HOME; zachować aktualnąD1. Przy incydencie automatu najpierw STOP z AUTOMATIC_REFRESH_RUNBOOK.md — cofnięcie kodu nie usuwa harmonogramu. Kopia przed zapisami: `private-backups/rexbid/live-before-20261026`, restore/integralność i pełne porównanie wcześniejszych wydarzeń/snapshotów PASS. Bez migracji.

---

## 26.10.2026 — poprzednie wydanie: nazwy dokumentów i metadane platform

Produkcja `rexbid-production-preflight` **ed11f566-ff4b-4786-8491-745fe1da2ceb**, staging **83b69ba5-e88e-4aa3-9f7f-477876a1ac1b**. [Raport](DOCUMENT_FILTERS_2026-10-26.md). 1286 testów PASS, staging 32/32 i produkcja 35/35 kontroli HTTP; przeglądarka desktop/mobile. Nazwy dokumentów z D1, stary parametr typu zachowany, cache metadanych według platformy. Bez migracji/zapisów D1.

Profil portal-no-files zachowany. STOP potwierdzony 26.10 07:33:40 UTC: OPERATOR_STOP, lease=null, automat3254, ledger7293. Zero Apibara; plan wygasły, nie wykonywać resume/quota. Rollback kodu do prod **d2099ce5-a45c-4951-8ce7-ee98828c3934**, staging **1e8672e3-7f55-414f-bcff-cd8086618f78**. Użyć przypiętego Wranglera i właściwego profilu. Zachować aktualną bazę i STOP; cofnięty kod nie obsługuje nowych linków sale_document_name, uwzględnić to w kontroli po rollbacku.

---

## 25.10.2026 — poprzednie wydanie: obsługa klienta, stabilna nawigacja i gesty galerii

Produkcja `rexbid-production-preflight` **d2099ce5-a45c-4951-8ce7-ee98828c3934**, staging `rexbid-auth-test` **1e8672e3-7f55-414f-bcff-cd8086618f78**. [Raport wydania](CUSTOMER_EXPERIENCE_2026-10-25.md). 1275 testów, 22 staging HTTP i 25 produkcja HTTP PASS; desktop/mobile. Fizyczny iPhone nadal wymaga potwierdzenia wielodotyku.

Profil `portal-no-files` i dane zachowane. Bez migracji, zmiany uprawnień, DNS, nowych usług i requestów Apibara. Końcowy SELECT 25.10 22:24:56 UTC: `OPERATOR_STOP`, lease=null, automat3254, ledger7293. Konfiguracja harmonogramu pozostaje, STOP blokuje transport. Przy wygasłym planie **nie wykonywać resume/quota/odczytów providera**.

Rollback interfejsu do początku etapu: prod `0857772d-98da-4f87-b804-c46395b799bc`, staging `ff88207a-ee41-447a-b915-d7bb5f8d38dc`. Przypięty Wrangler4.149.0 i wspólny XDG_CONFIG_HOME; komenda `rollback <VersionID> --config <właściwy profil>`. Pozostawić najnowszą D1 i OPERATOR_STOP. Po cofnięciu sprawdzić katalog, galerie, kontakt, konto i ready(blocked). Nie przywracać starej bazy dla cofnięcia UI.

Generowanie menu: `node scripts/build-navigation-shell.cjs --check`; zmiany linków trzeba utrzymywać zgodnie z `public/rexbid-mobile-nav.js`. Po zmianie JS/CSS odświeżyć wersje zasobów w HTML. Walidator aktywnego profilu: `node scripts/prepare-production-publication.cjs --check --evidence config/rexbid-accounts-readiness-20261014.json`; nie używać starego profilu mtbid jako opisu bieżącej produkcji.

---

## 25.10.2026 — poprzednie wydanie: katalog, indeksy i ulubione

Produkcja `rexbid-production-preflight` **0857772d-98da-4f87-b804-c46395b799bc**; staging `rexbid-auth-test` **ff88207a-ee41-447a-b915-d7bb5f8d38dc**. Profil `portal-no-files`, konta/portal/MFA zachowane, załączniki i auto-e-maile OFF. DNS i mtbid bez zmian. [Raport, dowody, liczby i ograniczenia](RELIABILITY_AND_SAVED_VEHICLES_2026-10-25.md).

Ostatni zapis 20.10 rozliczony z cache i readback PASS. Transfer publicznego katalogu 320/320; oba D1: 4535 ofert / 8302 snapshoty / 20990 wydarzeń. Prywatne dane pozostają odrębne, osiem tabel każdej bazy bez zmian. Wszystkie wcześniejsze snapshoty i wydarzenia zachowane; 195 korekt treści ma pełny audyt ze źródłem. Audyt FK/duplikatów/tożsamości PASS. Siedem indeksów zastosowano i sprawdzono w każdym środowisku, bez zmian 13 kontrolowanych tabel.

**Apibara nadal OPERATOR_STOP, lease=null, 0 requestów tego etapu.** Ledger 7293, automat 3254, ręczna kampania 2262; żadnego resume. Stan potwierdzony 25.10 20:08:37 UTC, HTTP `/ready` blocked. Zatrzymana kampania jest rozliczona w zakresie ostatniego zapisu, ale nadal nieukończona. Odczyt wszystkich historii i świeżość całego katalogu nie są deklarowane. 1223 testy / 22 HTTP PASS, rzeczywiste desktop/mobile; E2E dwóch kont nadal odłożony.

### Wycofanie tego wydania

1. Odczytać aktualne wdrożenie i potwierdzić właściwy Worker. Przypięty Wrangler 4.149.0, wspólny `XDG_CONFIG_HOME=C:/Users/nowic/AppData/Roaming/xdg.config`.
2. Przy regresji UI: `rollback 2eef63a9-32d3-4bb7-92de-8b43db92d933 --config wrangler.production-publication.jsonc`; staging osobno `rollback f0034777-cfca-48ed-aee5-b4afb0e7f26b --config wrangler.staging.jsonc`. Użyć przypiętego pliku `wrangler.js`, nie zmieniać sekretów/bindingów. Pozostawić najnowszą D1, ulubione i OPERATOR_STOP.
3. Kontrola po rollbacku: `/ready` blocked, katalog, właściwy LOT, historia, ulubione, kontakt, konto i www 308 ze ścieżką/parametrami.
4. Indeksy cofać tylko przy wykazanej regresji: sprawdzić definicje i journal właściwego targetu; plan `Documents/Codex/REXBID_RELIABILITY_20261025/index-rollback-plan.json` zawiera wyłącznie siedem nowo utworzonych nazw. Brak automatycznego wykonania. Zachować zatrzymane writery, po DDL porównać odciski tabel i EXPLAIN; nie usuwać wcześniejszych indeksów.
5. Kopia końcowych danych przed indeksami: `private-backups/rexbid/reliability-after-20261025`, manifest 25.10 19:32:24 UTC, DPAPI/ACL/restore/SHA PASS. Przy incydencie danych zabezpieczyć także obecny stan, odtworzyć kopię w izolacji i przygotować selektywną naprawę CAS z audytem. Nie odtwarzać pełnej starej D1 nad aktualnymi kontami dla cofnięcia interfejsu lub indeksów.

Wznowienie providera wymaga potwierdzonego aktywnego planu i bieżącego odczytu uprawnień/zużycia. Nie korzystać z historycznej quota jako aktualnego budżetu. Koszt nowych usług tego etapu: 0; wykorzystano istniejący Workers Paid. Następna praca bez API: etykiety i semantyka filtrów. Starsze instrukcje poniżej są zapisem historycznym.

---

## 25.10.2026 — porównywarka i sprawdzony audyt

Aktualna produkcja **2eef63a9-32d3-4bb7-92de-8b43db92d933**, staging **f0034777-cfca-48ed-aee5-b4afb0e7f26b**. Porównanie3aut, poprawne LOT ulubionych,1190testów/22HTTP PASS, desktop/mobile. [Raport](VEHICLE_COMPARISON_2026-10-25.md). Odczytowy audyt obuD1 PASS po poprawie indeksowalnego JOIN; wcześniejszy429byłCPUtime, nie dowodem braku pakietu. Bez migracji, zmian danych/stawek/MFA/DNS.

**Apibara OPERATOR_STOP i brak lease** potwierdzone SELECT; /ready po deployu blocked. Harmonogram/flagę zachowano, ale nabycie lease zatrzymuje transport przed odczytem quota. Nie wywoływać resume ani providera przy wygasłym abonamencie. Regresja nowej instancji potwierdza0requestów. Kampania20.10 nadal nieukończona; pełne preservation i ostatni niepewny zapis nadal do rozliczenia. Nie traktować poprawnego audytu integralności jako zakończenia kampanii.

Rollback UI: produkcja **a9872685-d467-4d40-9e26-89e5acf85c2b**, staging **d837146e-35d9-42fb-948d-54c7ba8ded00**. Przypięty Wrangler4.149.0, profile wrangler.production-publication.jsonc / wrangler.staging.jsonc; `rollback <VersionID> --config <właściwy profil>`. Po rollbacku sprawdzić ready(blocked), katalog, kartę, kontakt, konto iwww308. Zachować OPERATOR_STOP oraz najnowsząD1; nie przywracać starszej bazy dla cofnięcia interfejsu. Nowy wybór sessionStorage jest niezależny od ulubionych.

---

## 25.10.2026 — bieżące wydanie i pauza providera

Produkcja **a9872685-d467-4d40-9e26-89e5acf85c2b** (rexbid-production-preflight), staging **d837146e-35d9-42fb-948d-54c7ba8ded00** (rexbid-auth-test). Uproszczony kalkulator, bez migracji, zmian bindingów, DNS, kont, MFA ani stawek. Profil portal-no-files zachowany. Pełny suite1171/1171 i HTTP14/14PASS. [Raport, dowody oraz ograniczenia](CALCULATOR_SIMPLIFICATION_2026-10-25.md).

Apibara wygasła — **nie uruchamiać odczytów ani resume**. Stan produkcyjnyOPERATOR_STOP/lease=null; /ready refresh=blocked. Harmonogram jest zachowany, zatrzymanie wynika z bramkiD1. Odczyty publiczne korzystają zD1/cache. Zbiorczy audyt managementAPI zatrzymanyHTTP429; nie oznaczać jakoPASS. Kampania20.10 zatrzymana naHTTP500batch,7293próbłącznie; nie ukończona.

Rollback samegoUI do produkcji **1a42548b-efec-4e0f-912a-b76a8a114df9** lub stagingu **c61c0bec-ef0a-44f0-b282-2abb0229aa6b**, przez przypiętegoWrangler i właściwyprofil. Przykład: wrangler rollback <VersionID> --config wrangler.production-publication.jsonc; dla stagingu użyć wrangler.staging.jsonc. Najpierw sprawdzić aktualne wdrożenie i target. ZachowaćOPERATOR_STOP, konta, dane iMFA. Po rollbacku ready/karta/kontakt/konto, www308 i refreshblocked. Nie odtwarzać starszejD1 dla tej zmiany assetów.

Wznowienie danych dopiero po rozliczeniu niepewnego zapisu20.10, końcowym audycie i potwierdzeniu aktywnego planu. Stare instrukcje resume poniżej nie mają pierwszeństwa przed tą pauzą. Dodatkowe koszty0; bezpusha.

---

## 15.10.2026 — aktywny portal-no-files

Produkcja **bfd91ee3-654a-423f-ac19-04196f965b65**; staging **c5ea5457-e9dd-497f-8634-5930eaa8ed07**. MFA potwierdzone przez świeży widok właściciela i serwerową bramkę AAL2. Właściciel zatwierdził wdrożenie oraz retencję panelu15.10; nie prosić o ponowienie tej zgody. Aktywne profile, realizacje, etapy, rozmowy i eksport; załączniki/automatyczne e-maile OFF. Ten sam Worker/D1/Supabase, Cron i budżety. [Wyniki i rzeczywiste ograniczenia](ACCOUNTS_RELEASE_2026-10-14.md).

**Rollback panelu:** przy błędzie uprawnień, izolacji lub zapisów zatrzymać pracę w panelu; odczytać bieżące wdrożenie i wrócić do sprawdzonego owner-setup **9dc22414-5c2d-470a-8c46-0893834f3554** albo wygenerować owner-setup z bieżącego kodu, zachowując `--automatic-refresh` i właściwy niezależny Worker. Sprawdzić portalOFF, uploadsOFF, konto/katalog, owner binding, D1, limiter i Cron. Zachować aktualne dane, wiadomości, tożsamości i MFA. Bez resetu TOTP, cofania sekretów i przywracania całej starszej D1 dla samego wyłączenia panelu. Nie używać starego generatora targetującego mtbid.

Schemat w tym etapie nie był zmieniany. Przy rzeczywistym uszkodzeniu danych: najpierw kopia stanu po incydencie, izolowane odtworzenie zweryfikowanej kopii, porównanie i zachowanie nowszych prawidłowych wpisów oraz rejestru zamknięć; dopiero zatwierdzona naprawa odpowiednich danych. Kopia przed etapem i wynik restore w BACKUP_RECOVERY.md oraz raporcie. Kopia D1 nie odtwarza tożsamości/czynników Supabase. Powrót kodu sam nie naprawia uszkodzonych danych.

Kolejne sprawdzenie: rzeczywisty przepływ dwóch kont testowych, bez zgadywania identyfikatorów i bez wysyłki automatycznych e-maili. Nie uruchamiać plików ani kupować Pro w ramach tej zgody. Poniżej historyczne fazy.

---

## 15.10.2026 — aktywny owner-setup

Produkcja **9dc22414-5c2d-470a-8c46-0893834f3554**; staging bez zmian **c8436db5-d49e-47ab-8ccd-6c94e7c01606**. Owner binding ustawiony po ponownym dopasowaniu wcześniejszej dokładnej tożsamości i wyraźnej zgodzie właściciela. Wdrożenie MFA również osobno zatwierdzone. Podstawowy produkcyjny recovery testowego klienta ręcznie PASS; MFA nadal false. Dostępny tylko ekran zabezpieczenia właściciela; portal/orders/messages/files/reset TOTP zamknięte. Katalog/Auth/Cron co15min i budżety bez zmian.

Następny krok: właściciel osobiście „Skonfiguruj ochronę konta” na https://rexbid.pl/administracja, nowe produkcyjneTOTP i weryfikacja. Dopiero techniczny readback verified+AAL2 uprawnia do bramki MFA i fazy portal-no-files. Nie odczytywać sekretu QR, nie kopiować stagingu. Backup/restorePASS,967repo/24HTTPPASS,8chronionych tabel każdego środowiska zachowane. [Pełne dowody i rollback](ACCOUNTS_RELEASE_2026-10-14.md).

Rollback do auth-setup **9de3ce41-5479-4c48-86d0-1a6339e3c140** lub bieżącego wygenerowanego auth-setup z `--automatic-refresh`; zachować aktualne dane, owner binding i MFA. Zweryfikować Cron/bindingi/ready/portalOFF. Bez przywracania starejD1 dla cofnięcia flagi. Nie wykonywać ponownej delegacji/migracji, zakupów ani pusha.

---

## 15.10.2026 — produkcyjne recovery klienta potwierdzone

Ręczny test właściciela na osobnym koncie „REXBID-konto testowe”: potwierdzony e-mail, nowe hasło zapisane, stare odrzucone, nowe loguje. `smtp_confirmation_recovery_verified=true`. Nie resetowano hasła właściciela; jego dokładna tożsamość pozostaje oparta na wcześniejszym /api/me i dowodzie SHA. MFA nadal wymaga osobistego ustanowienia. Użyty/wygasły link i inna przeglądarka nie mają nowego rzeczywistego potwierdzenia.

Następna faza owner-setup zachowuje `--automatic-refresh`, ten sam Worker/D1, limity i Cron; udostępnia wyłącznie zabezpieczenie właściciela, nadal blokując realizacje, wiadomości, pliki i reset TOTP. Nie kopiować stagingowego MFA. [Aktualne dowody i wdrożenie](ACCOUNTS_RELEASE_2026-10-14.md).

---

## 15.10.2026 — dokładna tożsamość właściciela potwierdzona

Rejestracja, e-mail i logowanie potwierdzone przez właściciela; bieżąca sesja Codex i dokładne mapowanie D1issuer/subject zweryfikowane o12:22UTC. Bramka production_owner_subject_confirmed=true, dowód zSHA pozaGit wREXBID_OWNER_CONFIRMATION_20261015/identity-proof.json. Nie nadano roli ani nie ustawionoownersecretu. W kolejnym kroku sprawdzić recovery osobnego konta testowego, następnie właściciel ustanawia własne produkcyjneTOTP. Nadal nie wykonywać recovery na koncie właściciela. EmailE2E/MFAfalse; nie omijać tych bramek. Przy późniejszym przypisaniu ponownie porównać dokładną tożsamość ze skrótami, nigdy nie wybierać pierwszego lub najnowszego użytkownika.

Wdrożenia i fazaAuth-setup poniżej zachowane;30/30celowanych testówPASS. [Dowody i zakres](ACCOUNTS_RELEASE_2026-10-14.md).

---

## 14.10.2026 — aktualna faza auth-setup

Podstawowe konta aktywne na rexbid.pl, wersja **9de3ce41-5479-4c48-86d0-1a6339e3c140**. Staging **c8436db5-d49e-47ab-8ccd-6c94e7c01606**. Brak nowego cutoveru DNS i migracji; ta sama odseparowana D1. Portal/pliki produkcji OFF, brak R2bindingu; katalog i Cron ON. [Bieżący raport, zgoda i wyniki](ACCOUNTS_RELEASE_2026-10-14.md).

Zgoda właściciela na retencję kont i kopii14.10 zapisana; nie wymaga ponawiania. Pozostaje osobista rejestracja/potwierdzenie produkcyjnego właściciela, osobny testowy klient do rzeczywistego e-mailE2E, następnie owner-setup/TOTP i portal-no-files. Żadnego ownerID z domysłu. Nie testować resetu hasła ownera i nie kopiować MFA stagingu. SupabaseFreebeznowegozakupu. Gotowość/967testów/70HTTP nie zastępują testu poczty.

Aktualna kontrola generatora:

```powershell
node scripts/prepare-production-publication.cjs --check --evidence config/rexbid-accounts-readiness-20261014.json
```

Przy następnych fazach zawsze dodawać `--automatic-refresh`; ten sam przypięty Wrangler4.149.0 i XDG. Dalsze bramki owneridentity/e-mailE2E/MFA pozostająfalse do rzeczywistego sprawdzenia. Nie używać dawnych dowodów jako nowych wyników.

Rollback aktywacji: poprzedni sprawdzony **catalog+automatic-refresh ce112a51-fbd5-45d6-beaf-c5f4bab3853d** albo bieżący kod z wygenerowaną fazącatalog i tym samymCron. Najpierw odczytać deployment, potem sprawdzić `/ready`, AuthOFF, harmonogram i bindingi. Zachować bieżącą D1, kontaSupabase, sekrety i rosnące liczniki. **Nie odtwarzać całej starszejD1 tylko dla wyłączeniaAuth.** Backup17:36UTC/restorePASS w BACKUP_RECOVERY.md; gdy rzeczywiste uszkodzenie danych, izolowanyrestore i rejestr zamknięć przedruchem. Stagingrollback56b36e73-743d-421c-b9bc-01ac5998ca31.

---

## 14.10.2026 — historia: przygotowanie kont przed zgodą

Obowiązuje [ACCOUNTS_RELEASE_2026-10-14.md](ACCOUNTS_RELEASE_2026-10-14.md). Produkcja **ce112a51-fbd5-45d6-beaf-c5f4bab3853d**, staging **56b36e73-743d-421c-b9bc-01ac5998ca31**. Katalog i ograniczony Cron ON; produkcyjne Auth, portal i pliki OFF. Nie wykonywać ponownie delegacji.

Schemat 0003/0006/0007 już istnieje. Lokalna próba zastosowania migracji nie zmieniła danych ani schematu. Właściwy generator to prepare-production-publication.cjs z opcją --automatic-refresh także w fazach auth-setup, owner-setup i portal-no-files. **Dawny prepare-production-portal.cjs i wrangler.rexbid-production.jsonc targetują mtbid — nie używać ich dla obecnej domeny.**

Ogólne upoważnienie właściciela z 14.10 obejmuje rutynowe wdrożenia. Pozostają konkretne ustalenia danych oraz rzeczywiste testy e-mail, identity i MFA. Nie kupować Pro ani nie ustawiać fałszywych dowodów. Aktualny plik bramek: config/rexbid-accounts-readiness-20261014.json. Rollback tego etapu: produkcyjna wersja aaa709e1-24eb-4985-aa73-851c2baa0a05 ze zgodnym Cron; zachować bieżącą D1 i liczniki.

---

## 14.10.2026 — działająca produkcja z kontrolowanym odświeżaniem

Nie powtarzać cutoveru DNS. Obecny Worker `rexbid-production-preflight` **aaa709e1-24eb-4985-aa73-851c2baa0a05**, ta sama odseparowana D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`, apex oraz www308 zachowane. Staging **0db16a3d-d7d9-4c05-95e4-1041f799cd1b**. Auth/portal/pliki/legacy Sync/fallbackOFF, **nowy produkcyjny Cron ON** zgodnie ze zleceniem14.10. Sam staging nie ma Cron. Nie zmieniono starego mtbid, DNS ani poczty.

Nowe bramki i limit8/przebieg,500/dzień,12000/miesiąc,40nowych/dzień opisuje [runbook automatu](AUTOMATIC_REFRESH_RUNBOOK.md); [raport etapu](DEVELOPMENT_STAGE_2026-10-14.md) ma rzeczywiste wyniki i stan pierwszego Cron. Rollback: STOP w D1 unieważniający dzierżawę, jawne usunięcie harmonogramu, następnie zgodny kod. Sam rollback wersji nie wystarcza do wyłączenia schedules. Schemat0008 addytywny, dane odtwarzać do osobnej bazy, nie przez kasowanie tabel. Punkt sprzed etapu **1cd69740-fda8-495a-a895-587f135cf077**.

Supabase produkcyjny wznowiony za zgodą właściciela iHealthy; **Free pozostaje, Pro odłożone**. Nowy zakup0USD. Obecny katalog nie zależy od Auth. Produkcyjny owner/TOTP i e-mailE2E nadal przed uruchomieniem kont. [Rozbieżności arkusza i gotowość kont](PARTNER_AUTH_READINESS_2026-10-14.md).

Starsze pozycje poniżej to historia. Stwierdzenia CronOFF i stare VersionID nie opisują już aktualnego wydania.

---

## 12.10.2026 — rexbid.pl uruchomione za zgodą właściciela

Publiczne https://rexbid.pl; www308 zachowuje path/query, HTTP301 doHTTPS. Worker rexbid-production-preflight **1cd69740-fda8-495a-a895-587f135cf077**, odseparowana D1c8a30088. Auth/portal/files/Cron/Sync/fallbackOFF. Staging **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**, zachowane dane/MFA; mtbid351ac4e7 nietknięty. Delegacja blair/titan potwierdzona w OVH i pięciu odpowiedziach parent; DS0 na b/d/f/h/j, a timeout. Cloudflare active,13 wpisów (11 zachowanych zwykłych +2 managedWorker), poczta32/32PASS. Workers Paid aktywowany samodzielnie przez właściciela:5USD/mies.+usage, nie hard cap.

Naprawiono ujawniony w rzeczywistym QA błąd mobilnego menu (stara reguła ukrywała Jak to działa/Ulubione). **913/913 repo,47/47 celowane,31/31 final-domainHTTP/API PASS**; desktop/mobile, VIN/LOT, karty obu platform, galerie, częściowyV4, lokalne ulubione i kontakt sprawdzone. Fresh backup+readback; dane1817/3253/19044/1638/private0 zachowane,0 migracji i nowychApibara. Daty8–9.10 nadal wymagają kontrolowanego odświeżenia; nie udają danych live.

[Raport uruchomienia i konkretny rollback](PUBLIC_LAUNCH_QA_2026-10-12.md). Starsze wpisy poniżej są historią, w tym dawne „brak zgody/Free/pending”; nie wykonywać ponownie delegacji, tworzenia zasobów ani transferu danych. DNSSEC i produkcyjne konta/portal pozostają osobnym etapem. Treści prawne zachowały oznaczenie wersji do przeglądu, nie przypisano im prawnej akceptacji. Bez pusha.

---

## Aktualny stan12.10.2026 — techniczny pakiet publikacji ukończony

Odseparowany Worker/D1 gotowy w lokalnym pakiecie C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_PREP_20261012/candidate. Naprawiono produkcyjne robots/sitemap i /ready; katalog ma1817ofert/19044events/1638stanów, prywatne tabele0, FK/duplikaty0. Ponowny restore istniejącej kopiiPASS na obecnym komputerze. 912testówPASS +końcowy suite publikacji20PASS, dry-run repo/pakietPASS. Dashboard potwierdza WorkersFree; Paid5USD/mies.+usage, bez zakupu. Staging5079f5f9 zachowany, nie wdrażano zmian publikacyjnego entrypointu na staging. Apibara0, DNS/produkcja bez zmian. [Aktualny raport](PUBLICATION_TECHNICAL_QA_2026-10-12.md).

Zimbra i dane firmy są potwierdzone. Braki wspólnika nie blokują pierwszego częściowego katalogu. Pozostaje akceptacja dokumentów/retencji i konkretnego cutoveru, rekomendowany Paid przed ruchem oraz DS/TLS/smoke w zatwierdzonym oknie. Auth/portal/pliki/Cron/Sync/fallbackOFF. Starsze wpisy poniżej są historią; nie wykonywać ich ponownie.

---

## 12.10.2026 — pakiet wspólnika na 13.10 wieczorem i poprawka kontaktu

Spotkanie potwierdzone: **wtorek 13.10.2026 wieczorem**. Zachowano HEAD bazowy 6e7478605602ca192bcf62965d7d5dcba649a537 i istniejące funkcje. Excel poza Git: C:\Users\nowic\Documents\Codex\REXBID_PARTNER_MEETING_20261013\outputs\REXBID_Pakiet_wspolnika_2026-10-13.xlsx. 10 arkuszy, 171 punktów przeglądu (zawierają także potwierdzone), 42 pozycje źródłowe V4. Wpisano firmę, adres, kontakt, wariant A, aktualną pocztę Zimbra i stawki. Puste opłaty nie są zerami. Prywatna część rachunków jest pusta, numery przechowywać jako tekst; pliku wypełnionego bankami/kontaktami nie dodawać do Git.

Staging **5079f5f9-75ed-4231-869e-292157d0167e**: naprawiono link w treści zapytania (wskazuje zatwierdzone środowisko bieżącej strony) i zachowanie jawnej kwoty 0 USD. Parametr użytkownika nie może ustawić dowolnej domeny. Asset cache 2b3a41908abd. **909/909 repo, 14/14 partner, 25/25 celowane inquiry PASS**, konfiguracja i generator V4 PASS. Rzeczywisty browser: Honda IAAI44593083 → kontakt → draft ze stagingowym linkiem i oryginalną datą obserwacji; desktop1280/mobile390 bez poziomego overflow. Nic nie wysłano. Zero/null sprawdzone w regresjach syntetycznych, nie udają nowego odczytu aukcji.

**0 nowych requestów Apibara, bez zmian D1/MFA/sekretów, DNS/produkcji, płatnych planów i pusha.** Dane aukcyjne nadal z8–9.10; nie odświeżano ich na zapas. Przed jutrzejszym pokazem po wznowieniu przez właściciela: kontrola quota D1/Apibara, backup przed zapisem, oszczędne odświeżenie przykładów i aktualizacja czasu danych/scenariusza. Nie uruchomiono harmonogramu. Panel wspólnika nie otrzymał uprawnień. [Raport](PARTNER_MEETING_QA_2026-10-12.md), istniejący scenariusz zachowany pod nazwą PARTNER_DEMO_2026-10-12.md.

---

## Stan aktualny — Zimbra i DKIM zamknięte technicznie, 10.10.2026 wieczorem

- Skrzynka kontakt@rexbid.pl działa w OVH Zimbra Starter 15 GiB. Stare przekierowanie do Gmaila usunięto za zgodą właściciela. Gmail przechowuje wcześniejsze wiadomości; archiwum nie migrowano ani nie kasowano. Brak nowego automatycznego przekierowania.
- Odbiór Gmail → Zimbra: własny odczyt wiadomości 19:28 CEST PASS. Odpowiedź Zimbra → Gmail: właściciel potwierdził folder Odebrane; bez odczytu nagłówków przez agenta. Te dowody nie oznaczają osobnego PASS DKIM dla otrzymanej wiadomości.
- Właściciel zatwierdził przygotowany mały zakres. Dodano dokładnie dwa CNAME DKIM OVH do OVH i kopii Cloudflare, tam DNS only. Nie zmieniono MX/SPF/Resend, A, FTP, NS, DS, delegacji ani routingu strony. Cloudflare pending.
- Odczyt 19:45:20 CEST: 8/8 zgodnych odpowiedzi CNAME na dns111/ns111.ovh.net i blair/titan.ns.cloudflare.com. Porównanie dotychczasowych MX/SPF i trzech rekordów Resend na obu OVH: 10/10 PASS. TTL OVH domyślny, Cloudflare Auto. To bezpośrednie zapytania DNS; biblioteka nie raportuje flagi AA.
- Po dodaniu rekordów OVH wymagało osobnego włączenia podpisu. Dyspozycja włączenia przyjęta; panel pokazuje DKIM **Konfiguracja OK** i przycisk „Wyłącz podpis DKIM”. Dostawca zapowiada wykonanie w ciągu kilku minut. Test nowej wiadomości z kontrolą nagłówków Authentication-Results/DKIM pozostaje niewykonany. SRV autodiscover i DMARC bez zmian, poza tym zakresem.
- Zaktualizowano publiczną prywatność HTML/Markdown i opis retencji. Dokumenty nadal DRAFT; nie zmieniano retencji usług i nie kasowano danych. Test celowany **12/12 PASS**, HTTP **5/5 PASS**, prywatność desktop1280/mobile390: 9 sekcji, prawidłowy tekst Zimbra, brak poziomego overflow. Pełnego suite nie powtarzano (poprzedni wynik 905/905 +14/14 historyczny).
- Staging **49453c6c-71a5-4303-b428-8a97320ec8b9**: https://rexbid-auth-test.tedn828.workers.dev/prywatnosc . Zmiana jednego publicznego dokumentu; bez migracji D1, zmian kont/MFA/plików i sekretów. Poprzednia wersja f673688f-7b7d-45f1-a812-a42a927bb190 to punkt rollbacku kodu, lecz zawiera już nieaktualny opis kanału poczty.
- **0 requestów Apibara, 0 nowych płatnych usług, 0 maili wysłanych przez agenta.** Brak publicznej publikacji, zmiany delegacji i pusha. Oszczędny zakres z uwagi na zgłoszony przez właściciela pozostały limit Pro.
- Dowody poza Git: REXBID_MAIL_DOCUMENTS_20261010/zimbra-dkim-postcheck.json, zimbra-dns-after-dkim.json, zimbra-http-qa.json, zimbra-dkim-enabled.png, cloudflare-dkim-added.png, ovh-dkim-added.png, zimbra-privacy-desktop.png, zimbra-privacy-mobile.png oraz zimbra-privacy-deploy.log. Poprzednie receipty i cache zachowane.

### Dwa rekordy obowiązujące również przy przyszłej delegacji

| Typ / nazwa względna | Cel |
| --- | --- |
| CNAME ovhmo-selector-1._domainkey | ovhmo-selector-1._domainkey.4988509.qm.dkim.mail.ovh.net. |
| CNAME ovhmo-selector-2._domainkey | ovhmo-selector-2._domainkey.4988510.qm.dkim.mail.ovh.net. |

Kopia Cloudflare ma teraz **14 rekordów**, OVH 16 łącznie z własnymi 2 NS. Zachowane historyczne porównanie 12/12 plus 2 nowe identyczne CNAME; nie powtarzano pełnego eksportu wszystkich rekordów. Przyszły plan apex/www/308 usuwa jedynie zatwierdzone rekordy parkingowe/FTP i musi zachować również oba CNAME Zimbra.

Rollback tej zmiany: przy potwierdzonej regresji podpisu najpierw diagnoza nagłówków/OVH; można wyłączyć sam podpis i wycofać tylko te dwa nowe CNAME w obu strefach po uzgodnieniu. Nie przywracać starego redirect kosztem aktywnej skrzynki, nie usuwać skrzynki ani wiadomości. Delegacja i publikacja nadal wymagają osobnej zgody, nowego odczytu DS i kontroli TLS. Ocena ról/umów oraz akceptacja dokumentów i retencji pozostają odrębnym warunkiem; techniczny test poczty nie jest opinią prawną.

Poniższe wcześniejsze wpisy są chronologicznym zapisem poprzednich stanów, nie poleceniem ponownego tworzenia konta, dodawania rekordów lub powtarzania ukończonego QA.

---

> **10.10.2026 — poczta Gmail ↔ Zimbra sprawdzona w obie strony.** Odbiór testu w Zimbra potwierdzono własnym odczytem (19:28 CEST, rexbid.kontakt@gmail.com → kontakt@rexbid.pl). Właściciel potwierdził ręcznie, że odpowiedź wysłana z Zimbra dotarła do folderu Odebrane w Gmailu; nie odczytywano Gmaila ani nagłówków odpowiedzi. Logowanie oraz rzeczywisty test dwóch kierunków PASS z rozdzieleniem dowodów. To nie potwierdza jeszcze DKIM/DMARC. Sprawdzenie 19:34:30 CEST: obie nazwy DKIM OVH nie istnieją na dns111/ns111 ani blair/titan (8 odpowiedzi NXDOMAIN); plan zawiera wyłącznie dwa CNAME z panelu OVH, bez zastępowania MX/SPF/Resend. Pliki poza Git: zimbra-dkim-precheck.json i zimbra-dkim-additions.txt. Nie zmieniono DNS. Właściciel zgłosił 10% pozostałego limitu Pro i prosi o oszczędność; nie powtarzać pełnego QA, deployu ani audytu. Następny mały etap po zgodzie: dodać te dwa rekordy w OVH oraz kopii Cloudflare, zweryfikować odczytem; SRV nie jest konieczne do użycia webmaila. Następnie w jednym pakiecie zaktualizować opis bieżącej poczty w dokumentach strony (Zimbra; stare archiwum Gmail pozostaje), bez deklarowania jego migracji/usunięcia.

> **10.10.2026, 18:53 CEST — konto Zimbra utworzone i aktywne.** Po usunięciu zatwierdzonej reguły właściciel zatwierdził formularz. Readback OVH: kontakt@rexbid.pl, Starter 15 GiB, Aktywna, wykorzystanie 1/1, domena REXBID z 1 kontem. ID konta d90ee060-b9bb-46fe-aa87-b7c75c7e0006. Poprzednia blokada wynikała z zajęcia adresu przez przekierowanie, nie wykazano błędnego hasła. Stara reguła do Gmaila usunięta; wcześniejsze wiadomości Gmaila nie były dotykane. Diagnostyka OVH: MX OK, SPF OK, DKIM wymaga 2 CNAME, SRV autodiscover brak. DNS niezmieniony (10/10 readback), rekordy do osobnej zgody poniżej w QA. Aktywna w panelu nie oznacza potwierdzonego E2E: właściciel otrzymał logowanie, wynik logowania/odbioru/wysyłki oczekujący. Bez nowego zakupu, zmian strony, D1 lub MFA.

> **10.10.2026, 18:51 CEST — zatwierdzone zastąpienie przekierowania w toku.** Właściciel wyraził zgodę na usunięcie pojedynczej reguły kontakt@rexbid.pl → rexbid.kontakt@gmail.com i zastąpienie jej Zimbra. Przed zmianą odczytano Starter 0/1, brak zadań i dokładnie jedną regułę. Usunięcie przyjęte przez OVH; readback 0/1000, brak przekierowań, następnie tabela zadań pusta. Nie usuwano wiadomości Gmaila. Formularz konta z hasłem wprowadzonym przez właściciela pozostaje gotowy; końcowe Zatwierdź przekazane właścicielowi, nie wykonane przez agenta. Odbiór podczas przełączenia NIE jest potwierdzony. Nie zakładać, że stara reguła nadal działa. Odtworzenie w razie błędu według planu w QA. Kontrola DNS 16:51:49Z: 10/10 zgodnych wyników na dns111/ns111, plik zimbra-dns-after-release.json poza Git. DNS, aplikacja, MFA, D1 i plany niezmienione.

> **10.10.2026 — ustalona blokada utworzenia Zimbra:** po zatwierdzeniu przez właściciela OVH zwróciło `The email address for your account is already used; check existing mailbox, alias, redirection, or mailing list name.` Odczyt tabeli Redirect potwierdził dokładnie 1 wpis: kontakt@rexbid.pl → rexbid.kontakt@gmail.com. Adres jest zajęty przez dotychczasowe przekierowanie; nie diagnozować tego jako błędnego hasła. Skrzynka nadal nieutworzona. Zachowano oba zrzuty: zimbra-address-conflict.png i ovh-existing-contact-forward.png poza Git. Przekierowania nie usuwano, DNS i usługi aplikacji bez zmian. Proponowane zastąpienie wymaga zgody właściciela ze względu na zmianę odbioru i możliwą przerwę. Szczegółowy zakres i wycofanie w aktualnym QA poczty.

> **10.10.2026 — kontrola po potwierdzeniu właściciela „zapisane i skonfigurowane”.** Właściciel potwierdził zapis hasła Zimbra w Bitwarden i zakończenie konfiguracji; sekretu nie odczytywano. OVH po pełnym odświeżeniu nadal pokazuje 0 kont, Starter 0/1, licencję bez przypisanego konta i organizacji oraz brak zadań w toku. Domena aktywna, liczba kont 0. Komunikat sukcesu kreatora nie wystarcza do potwierdzenia utworzenia skrzynki. Przyczyna rozbieżności nieustalona. Nie ponawiano tworzenia ani resetu hasła. Przygotowano oficjalny formularz https://zimbra1.mail.ovh.net/ do kontrolowanego logowania właściciela; logowanie oraz odbiór/wysyłka pozostają nieweryfikowane. Dowód poza Git: REXBID_MAIL_DOCUMENTS_20261010/zimbra-license-unassigned.png. DNS, redirect, staging, produkcja i MFA bez zmian; brak zakupu. Wybór Zimbra jest już zatwierdzony — wcześniejsze prośby o wybór kanału lub zapis hasła są historyczne. Następny krok: właściciel sprawdza logowanie zachowanym hasłem, bez udostępniania go w czacie.

> **10.10.2026, 18:22 CEST — wybór Zimbra zatwierdzony przez właściciela („działaj”), konfiguracja rozpoczęta.** Wykorzystano istniejącą organizację REXBID i licencję Starter (1). Dodano rexbid.pl do usługi Zimbra z wyłączonym automatycznym zapisem wszystkich czterech grup DNS (SRV, MX, SPF, DKIM). Kreator zakończył krok domeny i przeszedł do konta. Przygotowano kontakt@rexbid.pl, nazwę wyświetlaną REXBID Kontakt i posiadany Starter; pole hasła pozostawiono puste, utworzenie konta czeka na właściciela. Nie tworzono kolejnej organizacji ani nie zamawiano licencji. Bezpośrednie odczyty obu OVH: 10/10 porównań MX/TXT/DKIM/CNAME zgodnych z zachowanym stanem, receipt zimbra-dns-after.json. Brak zmiany DNS nie jest testem dostarczenia wiadomości — odbiór nowej skrzynki nadal niezweryfikowany. Nie wracać do pytania o wybór kanału i nie uruchamiać ponownie kreatora od początku.

> **10.10.2026 — poczta i dokumenty sprawdzone, staging f673688f-7b7d-45f1-a812-a42a927bb190 na 100%.** [Bieżący raport]( MAIL_DOCUMENTS_QA_2026-10-10.md). 905/905 + 14/14 PASS, syntax 167 JS/5 inline, oba generatory, walidatory, dry-run publikacji i celowane desktop/mobile PASS. Aktualizacja wyłącznie dwóch publicznych dokumentów; D1/dane/MFA/sekrety/DNS bez zmian, provider 0. OVH redirect bez dodatkowej skrzynki potwierdzony; posiadana Zimbra Starter zawarta w zamówieniu domeny. Utworzono tylko organizację REXBID, nie domenę/skrzynkę/hasło lub DNS. Pozostaje decyzja o przyszłym kanale kontaktu i następnie jedna zgoda dokumenty/retencja/publikacja/delegacja. Nie uruchamiać domyślnego kreatora poczty bez kontroli współistnienia z redirect. Dane publikacyjne 1817/3253/19044/1638, transfer 276/276 ukończony — nie powtarzać. Poniższe e74 i wcześniejsze wersje są punktami historycznymi/rollbacku.

> **10.10.2026 — aktualny stan: transfer ukończony.** [Raport](PUBLICATION_COMPLETION_QA_2026-10-10.md): osobna D1 c8a30088 ma 1817 ofert/3253 obserwacje/19044 wydarzenia/1638 stanów; 276/276 partii, brak pending. Backup przed/po i rzeczywiste odtworzenie PASS, prywatne dane0. Staging e74e4106, 902+14 PASS, Apibara 0. **Zgoda finansowa właściciela obejmuje potrzebne przedstawione koszty**, nowe kwoty przed aktywacją; [budżet](OPERATING_BUDGET_2026-10-10.md). Nie kupiono planów. Przed publicznym ruchem rekomendowany Workers Paid5USD, przed pełnymi kontami obecna organizacja2Micro Supabase Pro35USD; kwoty bazowe, nie cap. Zgoda finansowa nie jest zgodą na DNS/publikację. Dokumenty/retencja i faktyczny kanał korespondencji nadal do zamknięcia. Dane partnera spodziewane12–14.10, V4 częściowy. **STOP206 poniżej jest historyczny; nie wznawiać ukończonego transferu.**

> **9.10.2026, 16:05 CEST — przygotowanie kandydata, STOP na budżecie D1.** [Aktualny raport](PUBLICATION_PREPARATION_QA_2026-10-09.md). Preflight c8a30088:1817 ofert/3253 snapshoty/13127 events/618 receipts; 206/276 partii, brak5917events/1020receipts. Staging6c7d016d bez zmian. Bridge wymaga trwałego budżetu; konto79292 zapisów według bazowego odczytu + własnych metadanych, rezerwa20708. Analytics opóźnione. Nie publikować częściowo przeniesionej bazy. Po resecie10.10 o02:00CEST wykonać odczyt quota/backup i wznowić zapisany plan, bez Apibara. Lokalny pełny transfer i backup restorePASS,901+14testówPASS, bundle przygotowany bez uploadu. Pozostają odłożone dokumenty/retencja/ocena korespondencji i osobna zgoda DNS/publikacji. Poniższe wcześniejsze liczby są historyczne; aktualne wyniki ma raport z tego etapu.
> **9.10.2026 — aktualny staging 6c7d016d-a822-4a4f-9868-b46d111f20be; publikacja nadal odłożona.** [QA Timed/Polestar i alert D1](CATALOG_COVERAGE_QA_2026-10-09.md). Staging1817 ofert, 3253snapshoty, 19044events; baza publikacyjna nie była zmieniana w tym etapie. Nowy kod aktywny100%, końcową kontrolę metadanych wykonano po przywróceniu OAuth przez login --device. Bez ponownego deployu, migracji i zmian DNS.
>
> **Bramka przed kolejną operacją zapisu:** limit Free100000 rows written/dzień jest wspólny dla konta i uwzględnia indeksy. Metryki8.10:150821 konto/129544staging;9.10 o13:18UTC:2763zapisy/1317965odczytów. Budżet Apibara nie chroni D1. Nowe importy pozostają STOP do przygotowania trwałego licznika meta.rows_written, bieżącego odczytu zużycia wszystkich baz i rezerwy dla kont/portalu. Nie przedstawiać tego warunku jako już wdrożonego automatycznego limitera. Nie aktywować planu Paid ani usuwać indeksów/danych w celu obejścia limitu. Reset dobowy00:00UTC (obecnie02:00CEST); brak odczytu metryk nie jest potwierdzeniem dostępnej puli.

> **8.10.2026 — etap historii zamknięty 40/40, publikacja nadal odłożona.** Staging **21522ccb-b342-408f-a649-65d4b7720dc4** pozostaje na 100%, bez deployu. Trzy nowe próby po znanych VIN-ach i usage: IAAI 45692906 fetched_empty, Copart 70103156 Sold / 19 900 USD. 61 wydarzeń / 40 receipts, duplikaty / FK 0; wcześniejsze 38 historii i chronione dane zachowane. Razem **101/1000**; STOP 56 i wcześniejszy identity STOP nietknięte. HTTP 8/8 D1, desktop/mobile, 855/855 + 14/14 PASS. Publikacyjna D1 niezmieniona. [Aktualny raport](HISTORY_ENRICHMENT_QA_2026-10-08.md). **Wpisy 38/40 i 98 poniżej są historyczne; nie wykonywać cutoveru.**

> **8.10.2026 — stagingowy etap historii, publikacja nadal odłożona.** Staging **21522ccb-b342-408f-a649-65d4b7720dc4**,855/855+ 14/14PASS. Próbka38/40,Copart 19/IAAI 19,60 events/38 receipts,11prawidłowo pustych. Guard odrzucił numeryczny LOT IAAI 45692906 zwrócony jako inny Copart i zatrzymał transport; pozostały Copart 70103156 nie odczytany. Łącznie98/1000,nowyidentitySTOP i pierwotnySTOP 56 zachowane. Chronione dane/MFA bez zmian,QA zD1 bezprovider. Baza publikacyjna niezmieniona; wydarzeń nie kopiowano. [Raport](HISTORY_ENRICHMENT_QA_2026-10-08.md). Nie wykonywać cutoveru.

> **8.10.2026 — publikacja i ocena poczty odłożone przez właściciela.** Nowsze poprawki kart wdrożono wyłącznie na staging **658c25a8-82c2-44c8-b55e-7cc9bc5012cc**. Staging ma teraz 4 wydarzenia historii Tesli; baza publikacyjna nie była zmieniana. Kampania nadal STOP 56, osobne 3 odczyty diagnostyczne dają łącznie 59/1000. Szczegóły: [QA cen i historii](OWNER_PRICE_HISTORY_QA_2026-10-08.md). Poniższe dane 824 testy / 0 events / 69d632c2 opisują wcześniejszy etap. Nie uruchamiać tego runbooka bez późniejszej osobnej zgody.

> **Aktualny staging, 8.10.2026:** **5e6f2c25-3738-4c95-9c81-8d09a8cbdf61**, [QA czytelności danych](DATA_READABILITY_QA_2026-10-08.md), 840/840 +14/14 PASS. Nowe Apibara 0, razem59, STOP 56. Powyższa wersja 658c25a8 to punkt rollbacku. Publikacja i etap prawny nadal odłożone; nie wykonano tego runbooka ani zmian DNS/produkcji.

# REXBID — pakiet delegacji i publikacji do akceptacji

**Aktualizacja końcowa 2026-10-08: STAGING VERIFIED — PUBLICATION / DNS OWNER APPROVAL PENDING.** Kontrolowany refresh zatrzymany na zapisanym checkpointcie; poprawki stagingu ukończone, bez zmian obecnego mtbid/rexbid-db, DNS, delegacji lub publicznych tras. Jedynym przyszłym targetem jest odseparowany **rexbid-production-preflight / D1 c8a30088-70af-43a6-9a7f-c4018279d37d**. Nie używać wyłączonego profilu release zwracającego 503.

## Aktualny rezultat i bramki wykonania

- Staging: **69d632c2-4f53-4d08-9602-6cd60de43d8e**. Publikacyjna i stagingowa D1: **1638 ofert (840 Copart / 798 IAAI), 1682 snapshots, 1363 oferty z mediami**. **1098 active potwierdzonych 8.10 (499 / 599)**; pozostałe 540 ma starsze obserwacje. Katalog jest partial, metadata_complete = false; nie obejmuje całego rynku. Publiczna historia rozróżnia obserwacje i potwierdzone wydarzenia. Events i entities = 0.
- Zużycie zatwierdzonej kampanii **56/1000 prób (25/31), retry = 0**. Bramka pierwszych dwóch stron / 40 aktywnych obserwacji: PASS. **STOP pozostaje aktywny** po niepotwierdzonym zapisie D1 drugiej strony IAAI Timed (upstream 200). Pierwotnego błędu nie zachowano; odzyskanie stanu z kodem D1_STATE_WRITE_INTERRUPTED zachowało cursor i budżet. Nie kontynuować wywołań providera w tym etapie; publikacja stored nie wykonuje providera.
- Prywatne tabele publikacji pozostają puste. Stagingowe Accounts/MFA/R2 i 19 chronionych tabel zachowane. Wcześniejsze backupy przed/po oraz rzeczywiste odtworzenie w lokalnej pamięci: PASS, ostatnio 8.10 o 10:36:53 UTC. Przed późniejszym oknem ponownie porównać aktualność i SHA z manifestem; nowy backup jeżeli nastąpi zmiana. [Backup](BACKUP_RECOVERY.md).
- Kod i automatyczne testy: **824/824 PASS**, osobno pakiet partnera **14/14 PASS**. Nowa kontrola HTTP: **19/19 PASS**, oraz pełna ścieżka demonstracyjna desktop/mobile w rzeczywistej przeglądarce. Wcześniejsze HTTP 22/22 pozostaje historycznym dowodem. PASS: 2 generatory, 3 walidatory konfiguracji, składnia 152 JS + 12 inline oraz dry-run. QA provider calls = 0. Widoczne poprawki obserwacji, historii, nawigacji i dokumentów wdrożono tylko na stagingu. Prywatny preflight nadal **0a876baa-7b80-44ce-9d85-602ff8c82314**, bez routingu. Dry-run publikacji nie jest deployem ani testem domeny.
- Pierwszy zakres **zapisany katalog, karty, historia obserwacji, filtry, URL-e mediów, V4, lokalne ulubione i kontakt**. **Auth / portal / pliki / Cron / Sync / discovery / media enrichment / automatyczny provider fallback: OFF**. Konta i portal pozostają w kodzie i działającym stagingu, do osobnego uruchomienia; nie kopiować ich do D1 publikacyjnej.
- DNS, 8.10, 13:41 CEST: **b, d, f, h i j odpowiedziały autorytatywnie NOERROR/NODATA, DS = 0 przez UDP/TCP**. a-dns timeout i IPv6 ENETUNREACH pozostają NOT VERIFIED. Aktualna delegacja IANA obejmuje 6 NS; pomocnicze DoH/RDAP są spójne. Pełne **12/12 rekordów na obu OVH i Cloudflare blair/titan**, 13:44 CEST, jest zgodne z najnowszym eksportem. Kolejny eksport nie jest potrzebny bez zmiany strefy. Delegacja nadal wskazuje OVH; docelowe NS: **blair.ns.cloudflare.com / titan.ns.cloudflare.com**. Po zakończonym okresie oczekiwania pięć zgodnych odpowiedzi z AA = 1 wspiera gotowość. W oknie przełączenia ponowić macierz aktualnych NS IANA. [Czasy, statusy i ograniczenia](DNS_READINESS_REFRESH_2026-10-08.md).
- Poczta Resend/OVH bez zmian. Poprzednie pomiary zużycia z 7.10 są ręcznym odczytem właściciela; nie gwarantują obecnych limitów/kosztów. Pierwszy zakres nie wysyła maili i nie ma bindingu R2. Przed przyszłym Auth/plikami osobno: E2E poczty, MFA właściciela, przenośna kopia zapasowa i kontrola kosztów.

[Bieżące QA i szczegółowe ograniczenia](FINAL_ACCEPTANCE_QA_2026-10-08.md), [demo 12.10](PARTNER_DEMO_2026-10-12.md), [karta końcowej zgody](FINAL_PUBLICATION_APPROVAL.md), [retencja](DATA_RETENTION_REVIEW.md). [QA poprzedniego sprintu — dowód historyczny](PUBLICATION_REFRESH_QA_2026-10-08.md). Poniższy target i procedura są aktualne; historyczne dowody z 7.10 są jawnie datowane i nie zastępują odczytu z 8.10.

## Podmiot i treści pierwszej publikacji — bieżąca bramka

Właściciel potwierdził **REX AUTO CARGOLOOP L.L.C**, adres **1209 Mountain Road Pl NE, Ste N, Albuquerque, NM 87110, United States** oraz wariant A: obsługa klientów w imieniu spółki, która jest administratorem danych. Administrator techniczny pozostaje bez zmian. Kontakt **kontakt@rexbid.pl** jest zachowany. Do przeglądu na stagingu: [O nas](https://rexbid-auth-test.tedn828.workers.dev/o-nas.html), [kontakt](https://rexbid-auth-test.tedn828.workers.dev/kontakt.html), [warunki](https://rexbid-auth-test.tedn828.workers.dev/warunki.html), [prywatność](https://rexbid-auth-test.tedn828.workers.dev/prywatnosc.html).

Warunki i prywatność są kompletne i nadal oznaczone **DRAFT** do końcowej akceptacji. Dane firmy i wariant A są potwierdzone; NM Entity ID nie ustalono i nie wykazano jako samodzielnej bramki katalogu. Do decyzji pozostają treści i proponowana retencja oraz ocena warunków rzeczywistego kanału korespondencji OVH → Gmail, ról i transferów. Nie deklarować Gmaila procesorem z DPA bez podstawy, nie zmieniać usług automatycznie. Szczegóły i bramka publikacji kontaktu: [LEGAL_SCOPE_REVIEW.md](LEGAL_SCOPE_REVIEW.md) oraz [FINAL_PUBLICATION_APPROVAL.md](FINAL_PUBLICATION_APPROVAL.md).

Pierwszy zakres catalog nie składa zlecenia licytacji; formularz tylko przygotowuje e-mail. Oznaczenie fazy publikacji i JS zapobiegają odtworzeniu niedostępnego linku Konto. Konta na stagingu pozostają dostępne. [Bieżący raport i QA](FINAL_ACCEPTANCE_QA_2026-10-08.md).

## 1. Dokładny target i zakres zgody

| Element | Proponowany target |
| --- | --- |
| Konto Cloudflare | Tedn828 / 7ff5a57444667c4eda2a6a7f0fc4120d |
| Nowa publikacja | rexbid-production-preflight; aktualna odczytana prywatna wersja 0a876baa-7b80-44ce-9d85-602ff8c82314 |
| D1 | rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d |
| Supabase | rexbid-production / kkwbqzndildovbblbkcx / Ireland / Free |
| Nowy profil katalogu | wrangler.production-publication.jsonc; entrypoint worker.publication.js, oparty na pełnym worker.js |
| Źródło katalogu | Odseparowana D1 c8a…; stored public list/detail/history/filters; provider fallback OFF |
| Origin | https://rexbid.pl |
| Alias HTTPS | https://www.rexbid.pl → apex, status 308 tylko dla GET/HEAD; path/query zachowane, mutacje odrzucone |
| DNS | OVH dns111/ns111 → Cloudflare blair/titan, wyłącznie po osobnej akceptacji |
| Poczta | MX/SPF, aktywna skrzynka Zimbra OVH, dwa CNAME DKIM Zimbra oraz trzy rekordy Resend zachowane; bez zmiany sekretu SMTP |

**Poza zakresem publikacji:** mtbid, wersja 351ac4e7-2175-4d51-813b-5f85d9527f64; rexbid-db, UUID 971879fe-04ed-4e8c-9dc6-5306980bb872. Staging rexbid-auth-test / D1 acb3cb8e-69a2-459f-8a46-0f2f5b9004be dostał osobno autoryzowane poprawki i 0007 po backupie; jego konta, MFA i dane zachowano. Końcowy Version i QA: [handoff](../PROJECT_HANDOFF.md). Pakiet nie obejmuje migracji obecnej produkcji, importu prywatnych danych stagingu, pusha, nowego płatnego planu, discovery/backfill ani aktywacji Sync/Cron/media enrichment. Historyczny REXBID_D1_PRIMARY_READS=false pozostaje wyłączony; nowy jawny stored-read wrapper dla c8a… czyta D1 bez aktywacji starego produkcyjnego cutoveru. Nie używać wrangler.release.jsonc ani jego wrappera zwracającego 503.

## 2. Historyczne kontrole z 7 października — aktualny wynik powyżej

- **Sejf:** właściciel potwierdził LOCAL VERIFYVAULT PASS SAME COMPUTER. Pełny keyring i active ID są zgodne; weryfikacja nie wymagała DPAPI. Drugie urządzenie: NOT VERIFIED. SMTP key, hasło DB i API key zapisano ręcznie, bez technicznej weryfikacji. Agent nie otwierał Bitwarden ani wartości sekretów.
- **Cloudflare API, 15:55 UTC:** właściwe konto; mtbid bez zmian, nowy prywatny Version 0a876baa-7b80-44ce-9d85-602ff8c82314. Workers.dev i preview OFF. **APIBARA_API_KEY jest obecny w metadanych**, obok pięciu sekretów cookie/keyringu/Supabase; owner ID celowo nie wskazano. Nazwa nie dowodzi wartości ani dostępu do Apibara; **0 nowych requestów providera** w tym etapie.
- **Nowa D1 po seedzie, 16:09 UTC:** ledger 0000/0001/0002/0003/0004/0006/0007; sources/listings 579 (352 Copart, 227 IAAI), snapshots=584, events/entities=0. Users/favorites/orders/messages/files=0, dwa partial scope bez cursorów i bez last_success/last_complete. FK i duplikaty `(platform, LOT)`=0. 281 listingów z mediami (Copart 134 / IAAI 147), 8063 referencje HTTPS; bez binarnych zdjęć i raw payloadu. 0004 zawiera media columns, więc nie zastosowano ponownie 0005. 0004/0007 wykonano tylko na nowej D1, nie na rexbid-db.
- **Aktualność snapshotu:** oryginalne last_seen/summary/detail obserwacje 2026-09-29T20:01:13.556Z → 2026-10-05T21:34:05.046Z; wszystkie starsze niż 24 h. Przyszła data aukcji nie jest dowodem świeżości. Nie zmieniono timestampów. Domyślny katalog pokazuje znane zapisane rekordy; bieżące kategorie wymagają świeżej obserwacji i nie przedstawiają starych aut jako potwierdzonych aktywnych ofert. Pełnego rynku nie deklaruje API ani UI.
- **Staging po backupie:** addytywne 0007 receipts; users=2 / favorites=2 / orders=2 / messages=4 / files=3 zachowane, FK=0. Czytanie wiadomości klienta i zespołu rozdzielone po stronie serwera, role historycznych nadawców i MFA bez zmian. Nie uruchomiono e-mailowych powiadomień. Nowego rzeczywistego testu unread na dwóch zalogowanych kontach w tym etapie nie wykonano; wcześniejsze właścicielskie E2E zachowano jako osobny dowód.
- **R2 nowy i stagingowy:** r2.dev OFF, custom domains: 0. Produkcyjne załączniki nadal OFF; brak potwierdzonego hard capu rozliczeń całego konta.
- **Supabase UI:** Site URL https://rexbid.pl, jeden callback https://rexbid.pl/api/auth/callback?state=*, Custom SMTP ON, nazwa nadawcy REXBID, host smtp.resend.com, port 465, odstęp 60 s, hasło ukryte. Potwierdzone stagingowe recovery dotyczyło **testowego klienta**, nie hasła właściciela. Produkcyjna dostawa i E2E nie zostały wykonane.
- **Pełne porównanie DNS, 7 października 16:47:35 CEST:** wszystkie 12 rekordów z eksportu Cloudflare z 7 października 10:21:12 są zgodne z każdym z dwóch serwerów OVH: **12/12 na każdym**. Wartości i priorytety MX są zgodne; TTL Auto/3600 to udokumentowana różnica. Źródłem Cloudflare był dostarczony eksport, nie nowy odczyt live API, który zwrócił 403.
- **Udany odczyt parent DS, 7 października 15:52:30 CEST:** a-dns.pl / 192.102.225.53 i b-dns.pl / 192.195.72.53; odpowiedzi authoritative, NOERROR/NODATA, DS=0, TC=false, SOA .pl; delegacja OVH. Okno po 14:49 minęło. Późniejsze UDP timeout oraz TCP b-dns SOA bez DS / a-dns błąd sieci **nie stanowią pełnego powtórzenia na obu serwerach**. Zachować wcześniejszy dowód i ponowić oba bezpośrednio przed zatwierdzoną delegacją.
- **Billing:** strefa Cloudflare pending, Website Free; Subscription API 403. Bieżące usage/plany zostały ręcznie odczytane i potwierdzone przez właściciela około 17:20–17:43 CEST, patrz tabela poniżej. Nie jest to własny pomiar API ani gwarancja przyszłych kosztów. Brak osobnego technicznego dowodu obu tracking flags OFF.
- **Końcowe lokalne QA i staging:** `node --test` **749/749 PASS**, partner package osobno **14/14 PASS**, calculator parity **125663/125663 PASS**, oba generatory/config/diff PASS, składnia **143 JS + 12 inline PASS**. Staging Version **4a6bfcf9-4ecb-43fb-8943-0b246d7bc484**; dry-run profilu publikacji PASS, bez jego deployu. Własny desktop/mobile QA potwierdził katalog, dokładne VIN/LOT, karty obu platform, galerie/wideo, V4, kontakt i guest favorites. Home ma cztery uczciwe puste sekcje bieżących ofert z powodu starych obserwacji. Ekrany kont i zamknięty portal anonimowy sprawdzone; nie powtarzano loginów właściciela/MFA ani klientowskiego E2E. Końcowe screeny, HTTP i readback w [handoffie](../PROJECT_HANDOFF.md).
- **Remote readback i smoke końcowy, 16:43 UTC:** staging dane zachowane, receipts=0, provider reservations=291 / runs=32 / page commits=45 bez zmiany. mtbid351ac4e7 i prywatny preflight0a876baa oraz brak jego publicznych domen zachowane. HTTP **16/16 PASS**: health/ready/cars/filters200, dokładny VIN/LOT, detail obu platform/historyD1, missing404, me/portal guest401. Receipt `REXBID_PROFESSIONAL_READONLY_AFTER_20261007.json` poza Git. Zimne/network odczyty6–7s i kilka ciepłych odczytów81–162ms są pojedynczymi obserwacjami, nie benchmarkiem/SLA.

Dowody operatorowe bez wartości sekretów, poza Git, w C:/Users/nowic/Documents/Codex: REXBID_PROFESSIONAL_READONLY_BEFORE_20261007.json, REXBID_PROFESSIONAL_LOCAL_RESTORE_20261007.json, REXBID_PUBLIC_CATALOG_SEED_20261007.json, REXBID_DNS_PUBLICATION_FULL_20261007.json, REXBID_PARENT_DS_PUBLICATION_20261007.json. Import publiczny korzystał ze statycznej whitelisty, zachował dokładne LOT/platforma i źródłowe daty; nie kopiował operacyjnych runs/budgets/cursorów ani kont.

## 3. Koszty i blokery

Ręcznie odczytane przez właściciela z dashboardów **7 października około 17:20–17:43 CEST**, nie własne pomiary API:

| Usługa | Potwierdzony odczyt |
| --- | --- |
| Resend | Transactional Free; 2/3000 miesięcznie, 0/100 dzisiaj; oba przełączniki pay-as-you-go OFF |
| Resend domena | powiadomienia.rexbid.pl Verified; „Enable tracking metrics → Configure”, brak skonfigurowanej subdomeny trackingowej; nie jest to osobny dowód Click/Open tracking OFF |
| Workers | 19/100000 dzisiaj, 918 w okresie; 0,00 USD |
| D1 | 389/5 mln odczytów, 104/100 tys. zapisów dzisiaj; 3,04 MB/5 GB; bazy 5/10; 0,00 USD |
| R2 | Class A 15 / Class B 39; 519,36 kB; staging 3 obiekty, produkcyjny bucket 0 obiektów / 0 B; 0,00 USD |
| Apibara | Basic; 4123/30000 wykorzystane, 25877 pozostałe, 4 dzisiaj |

To punktowy dowód, nie gwarancja przyszłych kosztów. Import i późniejszy ruch zwiększają wykorzystanie; nie aktywowano płatnego planu ani automatycznych dopłat.

1. **Źródło i quota:** APIBARA_API_KEY jest już obecny w metadanych nowego Workera; nie powtarzać zadania dodawania sekretu. Pierwsza faza stored nie wykonuje publicznych requestów Apibara. Zachowane limity 500 global / catalog 250 / detail 150 / history 60 / discovery 0 / media 0 są konfiguracją przyszłych, osobno zatwierdzanych readów, a nie aktywnym fallbackiem tej publikacji. Limity są per D1, nie wspólną miesięczną pulą subskrypcji. Staging i istniejący mtbid nadal wymagają monitoringu swoich pul; nie podniesiono ich i nie wykonano upgrade. Stare/missing nie oznacza automatycznego fetchu.
2. **Resend:** Free: 100/dzień UTC i 3000/miesiąc; wspólna pula wszystkich kluczy, stagingu, produkcji oraz inbound Resend. Skrzynka Zimbra OVH jest oddzielna. Cooldown SMTP 60 s i limiter 30/min nie są miesięcznym capem. Zweryfikować aktualny plan/usage oraz Click tracking OFF i Open tracking OFF. Nie aktywować płatnych dodatków ani overages. [Limity Resend](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
3. **R2:** Standard: 10 GB-month, 1 mln Class A i 10 mln Class B miesięcznie; przekroczenia są metered. Kod nie ogranicza zużycia całego konta ani GB-month. Limit 8 MiB, MFA i prywatność nie dają gwarancji braku dopłat. Wszystkie nowe profile publikacji mają Files OFF i **brak bindingu R2**. Przed załącznikami potrzebna jest odrębna kontrola wszystkich bucketów, stagingu, backupów i orphan objects. DeleteObject jest bezpłatne; PUT/list i GET/head należą do odmiennych klas. Nie naliczać błędnie każdego DELETE jako Class A. [Cennik R2](https://developers.cloudflare.com/r2/pricing/).
4. **Legal i zakres produktu:** właściciel zatwierdza dane podmiotu, privacy/terms/retention i zakres publikowanych funkcji; drafty nie są finalną poradą prawną. Kalkulator pozostaje szacunkiem i pokazuje niepełny wynik przy brakach. Pierwszy pakiet partnera: port docelowy i kraj odprawy, zakres frachtu, cena oraz zakres port/broker/dokumenty; potrzebne waluta, jednostka, netto/brutto i data obowiązywania. Nie prosić ponownie o potwierdzone 610/24 stawek, preferowane terminale, mnożniki i BEV 150 USD.
5. **Recovery/MFA produkcji:** dopiero po TLS i fazie Auth nowe konto produkcyjne właściciela, jawne mapowanie issuer/subject → D1 users.id, osobne MFA oraz mailowy E2E testowego klienta również w innej przeglądarce. Nie zmieniać MFA ani hasła właściciela stagingu.
6. **Backup:** kopie staging/preflight przed zmianą o 16:02 UTC i po seedzie/0007 o 16:27 UTC mają checksum/DPAPI roundtrip i local-memory restore PASS. Pełne odtworzenie późniejszych eksportów o 16:32 UTC potwierdziło schema/count/FK i izolację. Przed publikacją sprawdzić aktualność późniejszej kopii względem readbacku; zmiana danych wymaga nowego eksportu. Lokalne SQL/Git/R2 kopie DPAPI nie są pełnym off-device DR. Sejf pięciu pozycji ma same-computer PASS bez DPAPI; trzy dodatkowe sekrety tylko ręczny zapis, drugi komputer i przenośna kopia danych oczekują. [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md).

7. **Workers/D1:** plan Free strefy nie dowodzi planu Workers całego konta. Workers Free ma 100 tys. requestów/dzień i 10 ms CPU/wywołanie; D1 Free 5 mln odczytanych wierszy/dzień, 100 tys. zapisów/dzień, 5 GB łącznie. Ręczny punktowy odczyt powyżej nie gwarantuje utrzymania runtime w tych limitach; monitorować CPU/wiersze i nie aktywować płatnego planu. [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/).

## 4. Przygotowane lokalnie narzędzia i polecenia

Wybrany generator to scripts/prepare-production-publication.cjs. Zachowuje stały, odseparowany target: rexbid-production-preflight i rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d, z `REXBID_PUBLIC_CATALOG_MODE=stored`. Nie wykonuje sieci, deployu ani odczytu sekretów. V4 używa dokładnie dozwolonej pary nazwa D1 + UUID. Wrapper blokuje obce hosty oraz mutacje aliasu przed upstream i nie przenosi stagingowego debugowania. Cztery publiczne odczyty korzystają z D1; cache ma maksymalnie 30 s i izolowany klucz host/ścieżka/pełne query. Cookie/Authorization, prywatne odpowiedzi, błędy i endpointy kont są BYPASS. Cache nie odświeża dat obserwacji. Missing 404, ambiguous 409 i schema/unavailable 503 nie uruchamiają provider fetch.

Lokalna kontrola istniejącego profilu katalogu i dry-run:

~~~powershell
Set-Location -LiteralPath 'C:\Users\nowic\Desktop\stona_auta-www'
node scripts/prepare-production-publication.cjs --check
node .\.codex-wrangler-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js deploy --dry-run --config .\wrangler.production-publication.jsonc
~~~

--check sprawdza zgodność wygenerowanego profilu, ale nie jest zgodą na publikację ani dowodem obecności sekretów. --write służy utworzeniu brakującego profilu i odmawia nadpisania istniejącego; przygotowany profil katalogu już istnieje.

Fazy generatora:

| Faza | Zakres i wymagane dowody |
| --- | --- |
| catalog | Zapisany partial katalog/V4, dokładny VIN/LOT i platforma, dostępne galerie/obserwacje historii, kontakt i guest favorites; provider fallback OFF. Auth, portal i Files OFF. Generator nie wymaga boolean evidence, ale wykonanie nadal podlega bramkom i zgodzie z tej instrukcji. |
| auth-setup | Auth ON, portal OFF. Wymaga dziewięciu podstawowych dowodów z tabeli poniżej. Umożliwia utworzenie/potwierdzenie konta oraz test recovery. |
| owner-setup | Wymaga podstawowych dowodów, potwierdzonego subject właściciela oraz confirmation/recovery E2E. Dostępne są wyłącznie istniejące endpointy security/enroll/challenge/verify; normalne API portalu i restart pending pozostają zamknięte. |
| portal-no-files | Wymaga wszystkich powyższych dowodów oraz produkcyjnego MFA właściciela. Portal działa, Files OFF, brak R2. |

Zapisz poniższy szablon jako C:\Users\nowic\Documents\Codex\REXBID_PUBLICATION_EVIDENCE_20261007.json, poza Git. Zawiera wyłącznie booleany, bez wartości sekretów. **Każde true wolno wpisać dopiero po odpowiednim dowodzie lub faktycznej zgodzie właściciela na daną fazę.** Samo przygotowanie profilu nie potwierdza żadnej z tych wartości. Pola, których dana faza jeszcze nie wymaga, mogą pozostać false.

~~~json
{
  "production_supabase_project_confirmed": false,
  "independent_production_secrets_verified": false,
  "provider_key_present": false,
  "limiter_namespace_confirmed_unique": false,
  "accounts_portal_schema_verified": false,
  "smtp_configuration_verified": false,
  "fresh_backup_restore_verified": false,
  "legal_retention_reviewed": false,
  "owner_cutover_approved": false,
  "production_owner_subject_confirmed": false,
  "smtp_confirmation_recovery_verified": false,
  "production_owner_mfa_verified": false
}
~~~

| Pole | Co musi być potwierdzone przed true |
| --- | --- |
| production_supabase_project_confirmed | Właściwy, niezależny projekt produkcyjny kkwbqzndildovbblbkcx. |
| independent_production_secrets_verified | Wymagane sekrety danej fazy pochodzą z produkcyjnych kopii i są poprawnie skonfigurowane; nie kopiowano stagingu. Sama lista nazw nie wystarcza. |
| provider_key_present | Zachowany klucz Apibara jest obecny w nowym Workerze. |
| limiter_namespace_confirmed_unique | Namespace 2026100601 i binding AUTH_RATE_LIMITER są potwierdzone dla nowego targetu; namespace jest odrębny od stagingowego. |
| accounts_portal_schema_verified | Odczyt ledger/schema/count/FK nowej D1 jest zgodny; nie opiera się wyłącznie na lokalnym SQL. |
| smtp_configuration_verified | Poprawna konfiguracja produkcyjnego SMTP i właściwy zakres zachowanego klucza. To jeszcze nie dowód doręczenia. |
| fresh_backup_restore_verified | Świeży backup nowej D1, checksum/manifest i właściwa kontrola odtwarzalności. |
| legal_retention_reviewed | Właściciel zatwierdził dokumenty, retencję i zakres funkcji. |
| owner_cutover_approved | Właściciel faktycznie zaakceptował konkretną fazę, target i okno wykonania. Zgoda na katalog nie pokrywa późniejszych faz. |
| production_owner_subject_confirmed | Jawnie potwierdzona tożsamość produkcyjna i mapowanie issuer/subject → D1 users.id; właściwy REXBID_OWNER_USER_ID w nowym Workerze. |
| smtp_confirmation_recovery_verified | Rzeczywiste produkcyjne confirmation/recovery E2E na finalnym originie, w tym kontrolowany test klienta w innej przeglądarce. |
| production_owner_mfa_verified | Właściciel skonfigurował osobne produkcyjne MFA; AAL2 jest potwierdzone. |

Po spełnieniu dowodów wymaganych dla konkretnej fazy i uzyskaniu jej zgody przygotuj tylko odpowiedni nowy profil:

~~~powershell
node scripts/prepare-production-publication.cjs --phase auth-setup --evidence 'C:\Users\nowic\Documents\Codex\REXBID_PUBLICATION_EVIDENCE_20261007.json' --output .\wrangler.production-auth-setup.prepared.jsonc
node scripts/prepare-production-publication.cjs --phase owner-setup --evidence 'C:\Users\nowic\Documents\Codex\REXBID_PUBLICATION_EVIDENCE_20261007.json' --output .\wrangler.production-owner-setup.prepared.jsonc
node scripts/prepare-production-publication.cjs --phase portal-no-files --evidence 'C:\Users\nowic\Documents\Codex\REXBID_PUBLICATION_EVIDENCE_20261007.json' --output .\wrangler.production-portal-no-files.prepared.jsonc
~~~

Te polecenia są osobnymi krokami kolejnych faz, a nie serią do wykonania naraz. Generator odmawia nadpisania istniejącego pliku i nie przyjmuje sekretów ani dodatkowych pól evidence. Powstałe profile zachowują ten sam nowy Worker i D1; przed wykonaniem sprawdzić diff i dry-run odpowiedniego profilu. Nie używać --env do zmiany targetu.

Stary prepare-production-portal.cjs ma również fazę portal-no-files dla historycznego mtbid, ale **nie jest generatorem wybranego nowego targetu**. Nie używać go w tej operacji.

Sprawdzony lokalny Wrangler znajduje się w istniejącym cache; lokalne node_modules nie zawiera wrangler.cmd. Zachować cache. Końcowy suite, generatory/config/dry-run, składnia, staging Version i własny desktop/mobile QA są zebrane w [handoffie](../PROJECT_HANDOFF.md). To nie weryfikacja publicznego runtime produkcji. Lokalny checkpoint nie obejmuje sekretów ani prywatnych kopii danych.

## 5. Kolejność po akceptacji — niespełniona bramka oznacza STOP

1. Potwierdzić HEAD/diff, konto i target, metadane sekretów, quota i legal. Zatwierdzić **zapisany partial zakres**, ze źródłowymi datami; 1098 ofert potwierdzono 8.10, lecz aktualność wygasa z czasem. Po kampanijnym STOP nie wykonywać dodatkowych requestów w ramach publikacji. Sprawdzić testy/config/generatory/składnię/diff/dry-run i checksum artefaktu.
2. Potwierdzić aktualność kopii refresh-after-20261008 z 10:22:31 UTC względem świeżego readbacku, SHA-256, manifest schema/count/FK oraz prywatny Version Workera. Przy zmianie danych wykonać nowy szyfrowany backup/rehearsal. Nie migrować żadnej obecnej bazy. Nowa D1 ma już 0000/0001/0002/0003/0004/0006/0007; nie stosować ich ponownie ani nie dodawać 0005 z tymi samymi media columns. Przy niezgodnym odczycie STOP i wyjaśnienie; nie uruchamiać staging migrations apply.
3. Po zgodzie na deployment można przygotować nowy build nadal prywatnie, z routes=[] i workers.dev OFF; zapisać jego Version ID. Obecne mtbid i staging pozostają nietknięte. Publiczny profil na tym etapie służy tylko dry-run.
4. Ponowić odczyt DS i pełny snapshot DNS, potwierdzić brak nowego DS oraz plan zachowania poczty. W OVH, **DNS servers / Serwery DNS**, zmienić wyłącznie delegację na blair.ns.cloudflare.com i titan.ns.cloudflare.com. Zachować strefę OVH i aktywną skrzynkę Zimbra kontaktu.
5. Czekać na Cloudflare active i nowe parent NS. Przygotować jawny diff Cloudflare: usunięcie tylko konfliktujących parkingowych rekordów A apex/www 213.186.33.5, nieużywanego FTP CNAME oraz **przekierowanie HTTP → HTTPS dla apex/www**. Wykonać te zmiany wyłącznie po zgodzie. Po publicznym deployu zatwierdzonego profilu oba Custom Domains wskazują nowy Worker; Cloudflare generuje ich DNS. Zachować MX/SPF, dwa CNAME DKIM Zimbra, trzy rekordy Resend i pozostałe TXT. Przekierowanie **HTTPS www → HTTPS apex, 308**, realizuje przygotowany wrapper; nie dodawać osobnego CNAME www ani drugiej reguły tego przekierowania. Wrapper nie zastępuje osobnej konfiguracji HTTP → HTTPS.
6. Potwierdzić certyfikaty obu hostów, HTTP→HTTPS, przekierowanie HTTPS www z path/query bez pętli oraz odrzucenie mutacji aliasu i brak cookies aliasu. Smoke katalog/V4: health/ready/cars/filters/VIN/LOT/Copart/IAAI/gallery/snapshot history/guest favorites/desktop/mobile. W tej fazie **0 upstream requestów Apibara**: missing/stale nie wykonują fallbacku. API ma catalog_complete=false i filters metadata_complete=false; daty źródła zachowane. Nie prezentować 1638 rekordów jako całego rynku. Zapisać działającą wersję katalogu i odczyty cache/D1.
7. Po osobnej akceptacji fazy kont wygenerować auth-setup z prawdziwym evidence i tym samym targetem. Auth odmawia działania przy niepełnej konfiguracji. Właściciel sam rejestruje nowe konto produkcyjne, potwierdza e-mail i loguje się. Odczytać dokładne issuer/subject oraz mapowanie D1; właściciel jawnie potwierdza tożsamość. Dopiero potem wpisać REXBID_OWNER_USER_ID w nowym Workerze. Nie wybierać pierwszego konta ani odgadywać właściciela z adresu e-mail.
8. W zatwierdzonym oknie testowe konto klienta sprawdza confirmation/recovery, grant bez dostępu do panelu, nowe hasło, odrzucenie starego, logowanie nowym, replay, expiry i logout, również w drugiej przeglądarce. Hasła i kody wpisuje właściciel, nie agent ani czat. Po E2E wdrożyć owner-setup; właściciel sam konfiguruje QR/TOTP i potwierdza AAL2. Administracja bez właściwego owner ID i AAL2 pozostaje zamknięta.
9. Po pełnych bramkach i osobnej zgodzie: portal-no-files, czyli izolowane orders/messages/profiles/customer/export, bez załączników. Sprawdzić izolację oraz private, no-store; nie publikować danych testowych. Pliki, Sync i Cron pozostają OFF do odrębnego pakietu.
10. Obserwować błędy, quota, delivery i fallback; powtórzyć mały smoke po 15–30 min. Po stabilizacji: DNSSEC Cloudflare ON → nowy DS w OVH → parent DS i kontrola validating resolver. DMARC wymaga osobnego diffu i zgody; nie jest częścią domyślnej aktywacji.

## 6. Rollback z triggerami

| Trigger | Akcja | Schemat/dane |
| --- | --- | --- |
| Brak sekretu, quota, legal, backupu lub konfiguracji; FAIL przed wykonaniem | STOP bez zmian usług | Brak migracji |
| Nieakceptowalnie stare/niepełne dane | Zostawić uczciwy opis zapisanych danych albo wycofać publiczny zakres; refresh uzgodnić osobno | Nie zmieniać timestampów i nie uruchamiać unlimited fallbacku |
| DNS/TLS niegotowe | Nie włączać Auth; odtworzyć zatwierdzony snapshot Cloudflare/routingu. W razie konieczności powrót delegacji OVH po osobnym uzgodnieniu TTL/DS | Rollback Workera nie zmienia DNS |
| Regresja katalogu/V4 | Cofnąć do poprzedniego zgodnego builda **tego samego nowego Workera** albo wycofać jego publiczny routing; sprawdzić health i smoke odczytów | Nie używać wersji mtbid 351ac4e7 jako rollbacku nowego Workera; nie podmieniać D1 |
| Problem Auth/recovery/MFA/CSRF/portalu | Wrócić do zapisanej działającej **wersji katalogu nowego Workera**; Auth/portal/files OFF; zachować keyring, dane i MFA | Bez DROP i czyszczenia kont |
| Incydent izolacji | Zamknąć portal/files, zatrzymać sesje i zapisy, wykonać sanitizowany audit oraz backup incydentu | Zachować zaszyfrowane dane i keyring |
| Utrata danych | Freeze → backup incydentu → restore do **osobnej D1** → schema/count/FK/reconciliation → zgoda na rebind | Nie przywracać starszego dumpu w miejscu; D1 nie odtwarza Supabase/R2 |
| Wyczerpanie quota lub niepewne rozliczenia | Zatrzymać daną funkcję lub klasę requestów; bez upgrade i nieograniczonego retry | Bez destrukcyjnego rollbacku |
| Częściowa migracja przyszłej zmiany | Sprawdzić ledger, DDL i checksum; włączyć read-only/OFF; osobno zaplanować idempotentne wznowienie lub restore | Cofnięcie samego kodu nie naprawia schematu ani danych |
| Powrót NS po nowym DS Cloudflare | Utrzymać obecne NS/podpisy; najpierw bezpiecznie zmienić/usunąć DS i odczekać jego TTL, potem cofnąć delegację | Nigdy niespójne DS/NS |

## 7. Proponowana treść akceptacji — nie jest jeszcze udzielona

„Zatwierdzam opisany etap DNS i publikację **zapisanego, częściowego katalogu/V4** na rexbid-production-preflight / D1 c8a30088-70af-43a6-9a7f-c4018279d37d, dla apex/www rexbid.pl, z zachowaniem poczty OVH i zmianami sekcji 5. Rozumiem częściowe pokrycie rynku i rzeczywiste daty obserwacji; 1098 ofert potwierdzono 8 października, pozostałe mają starsze dane. Obecne mtbid/rexbid-db pozostają nietknięte. **0 migracji obecnej produkcji; Auth/portal/files/Sync/Cron/discovery/media enrichment/provider fallback OFF.** Warunki przed wykonaniem: config, quota, legal, fresh backup i preflight PASS. Kolejne fazy Auth, owner MFA, portalu, R2 i refreshu wymagają osobnej akceptacji.”

## 8. Minimalne pozostałe działania właściciela

1. Review nowego stagingu i decyzja: **pierwsza publikacja odświeżonego partial katalogu** z jawnie zapisanymi datami obserwacji. Nie prosimy o ponowne API key ani dashboardy już potwierdzone. Zatwierdzić dane podmiotu/legal/retencję oraz konkretny zakres/okno DNS+deploymentu; nie zmieniać NS samodzielnie przed skoordynowaną operacją.
2. DNS: pełne **12/12 rekordów OVH/Cloudflare, 8.10 PASS**. Właściciel nie ma kolejnej czynności w tej bramce bez późniejszej zmiany. Przed delegacją operator ponawia macierz aktualnych autorytatywnych NS IANA. a-dns i IPv6 pozostają ograniczeniem pokrycia, nie dowodem DS. Nie zmieniać rekordów samodzielnie.
3. Przekazać wspólnikowi [krótki formularz](CALCULATOR_PARTNER_FORM.html): port docelowy/kraj odprawy, zakres frachtu, cena i zakres port/broker/dokumenty. Nie zbierać ponownie potwierdzonych 610/24 stawek, terminali, mnożników i BEV 150 USD.
4. Przed kolejnymi fazami kont/portalu: final-domain klientowski mail E2E, jawne produkcyjne owner identity i osobne MFA; potem off-device verifier/przenośny backup danych oraz cost-control przed plikami. Same-computer vault PASS zachowany; trzy dodatkowe sekrety pozostają tylko ręcznie potwierdzone. Bez wartości/QR w czacie. [Supabase production](https://supabase.com/dashboard/project/kkwbqzndildovbblbkcx/auth/users), [Resend Usage](https://resend.com/usage).

Aktualne wyniki automatyczne/dry-run i lokalny SHA: [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md). Bez pusha; działająca produkcja, DNS i MFA w tym etapie bez zmian.
