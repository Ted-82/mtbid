# Konta REXBID — aktywacja podstawowych kont, 14.10.2026

## 15.10.2026 — panel bez załączników uruchomiony po MFA i zgodzie

**Produkcja:** https://rexbid.pl, Version ID **bfd91ee3-654a-423f-ac19-04196f965b65**. **Staging:** https://rexbid-auth-test.tedn828.workers.dev, **c5ea5457-e9dd-497f-8634-5930eaa8ed07**. Lokalny punkt wejścia `d17447828c7f9b65e7e58936a555d4dafd973839`; aktualny checkpoint zawiera ten raport. Nie wykonano pusha.

### Zgoda i rzeczywisty zakres

Właściciel osobiście ustanowił produkcyjne MFA i zgłosił „MFA gotowe”. Po technicznej kontroli otrzymał kompletny zakres wdrożenia i zasad danych, odpowiadając **„Zatwierdzam panel i zasady przechowywania”**. Zgoda obejmuje profile, przypisane realizacje, etapy, rozmowy i eksport na rexbid.pl, bez załączników i automatycznych e-maili.

- Faza `portal-no-files`; wszystkie12bramek readiness mają dowody. Uprawnienie administracyjne nadal wymaga dokładnej tożsamości właściciela i AAL2. Nie dodano roli wspólnika ani uprawnień konta testowego.
- Retencja: profil do zmiany/usunięcia lub zamknięcia konta; realizacje/rozmowy przez obsługę+12miesięcy od zamknięcia; później comiesięczny **ręczny** przegląd/usunięcie; minimum konkretnego obowiązku/sporu osobno; kopie30/90dni. Brak automatycznego cleanupu. Niczego nie usunięto. Pierwszy przegląd nowych zasad najpóźniej15.11.2026; wcześniejszy przegląd kont14.11 zachowany. Nie utworzono automatycznego przypomnienia.
- Opublikowane [prywatność](https://rexbid.pl/prywatnosc) i [warunki](https://rexbid.pl/warunki) rozróżniają lokalny formularz kontaktowy od zapisywanych rozmów panelu. Potwierdzenie właściciela nie zastępuje przeglądu prawnego; oznaczenie wersji do przeglądu zachowano.
- Katalog/D1/cache, Auth i Cron co15min działają; limity automatu8/przebieg,500/dzień,12000/miesiąc,40nowych/dzień,rezerwa500 zachowane. LegacySync/fallbackOFF, brak produkcyjnego R2bindingu. Stary mtbid, DNS, poczta, hasła i sekrety nietknięte. Bez migracji i kopiowania klientów stagingu.

### Kontrole i poprawki

| Rodzaj dowodu | Rzeczywisty wynik |
| --- | --- |
| MFA właściciela | Po przeładowaniu `/administracja` świeża odpowiedź UI potwierdziła właściciela i drugi składnik; kod wyświetla ten stan wyłącznie dla owner+aal2. Po wdrożeniu widoczny rzeczywisty obszar obsługi. Nie odczytywano QR, sekretu, kodu ani cookies. |
| Testy lokalne | **970/970 PASS**, w tym regresje opisów pustego panelu i mobilnego nagłówka. Wcześniejsze968/969 to podzbiory wcześniejszych wersji — nie sumować. Generator config oraz `git diff --check` PASS. |
| HTTP finalne | **35/35 produkcja**, **34/34 staging**: strony/config/ready, anon401+no-store, obcyOrigin403, Auth i plikiOFF na produkcji, D1/cache bez fallbacku. |
| Rzeczywista przeglądarka | Sesja właściciela: administracja po MFA, pusta lista realizacji, konto z linkiem do panelu i właściwym zakresem eksportu, przejście do Moich importów. Desktop1280/mobile390 oraz konto320px. Nie tworzono produkcyjnych realizacji/wiadomości. |
| Dane | Po wdrożeniu osiem chronionych tabel w każdej D1 ma identyczne liczby i SHA względem początku; FK0. Produkcja2users, pozostałe7tabel0. Stagingusers2/favorites2/orders2/events3/messages4/files3/profiles0/reads0. |
| Rzeczywiste E2E klient ↔ właściciel | **Niewykonane w tym etapie.** Izolacja i rozmowy sprawdzone regresjami syntetycznymi; brak zweryfikowanej sesji osobnego klienta w przeglądarce. Odczyt pustego panelu nie dowodzi pełnego E2E zapisu/odczytu dwóch kont. |

W QA wykryto: opis obiecywał zdjęcia/dokumenty mimo wyłączonych załączników, a nagłówek konta na390px osiągał398px. Usunięto nadmiarową obietnicę i powtórzony przycisk Aukcje oraz dodano zawijanie kontrolek na małym ekranie. Staging po zmianie:390/scroll375,320/scroll305; produkcyjne zalogowane konto:320/305,390/375,1280/1265 — bez poziomego overflow. Końcowy audyt danych i wersji:15.10,13:30:50UTC; końcowy HTTP produkcji13:30:48UTC i stagingu13:29:11UTC. Zachowano działające pliki stagingu i pozostałą stylistykę.

Jeden przebieg pełnego suite w sandboxie miał967/970PASS: trzy testy lokalnego atomic-rename otrzymały EPERM dla plików testowych w katalogu sandboxTemp. Ten sam końcowy kod, uruchomiony w normalnym środowisku uprawnionym do plików testowych, dał970/970PASS. Nie zmieniano ACL, testów zabezpieczeń ani mechanizmu atomic-write. To ograniczenie wykonania testów, nie potwierdzona awaria zdalnej D1.

Bezpośrednia nawigacja nowej karty do `/api/portal/security` została odrzucona przez kontrolę same-origin dla prywatnych GET. Nie uznano jej za nieudane MFA ani nie osłabiono zabezpieczenia. Właściwy dowód to ponowne załadowanie rzeczywistego ekranu, który korzysta z dopuszczonego wywołania same-origin, oraz odczyt uprawnionego panelu. `mfa-readback.json` z próby dokumentowej nie jest dowodem PASS; poprawny zapis `mfa-ui-readback.json`.

### Kopia, rollback, koszty i kontynuacja

Zweryfikowana świeża kopia z12:46UTC i restore12:47UTC w `private-backups/rexbid/owner-setup-before-20261015`:28tabel,integrityOK,FK0, podwójna próba istniejących migracji bez zmian. Ponownie porównano wszystkie chronione tabele z aktualnym stanem — identyczne. Nie było nowej migracji ani zapisów prywatnych; wykorzystano tę samą sprawdzoną kopię z bieżącego etapu. Publiczny katalog jest niezależnie aktualizowany przezCron. Kopia D1 nie obejmuje Supabaseidentity/MFA.

Rollback aktywacji: sprawdzony **owner-setup9dc22414-5c2d-470a-8c46-0893834f3554**, zachowując bieżącą D1, konta, MFA, ownerbinding i Cron. Sprawdzić portalOFF/uploadsOFF/ready/bindingi/harmonogram. Bez odtwarzania całej starszejD1 tylko dla wyłączenia funkcji. Szczegóły w [runbooku](PRODUCTION_CUTOVER_RUNBOOK.md).

Nowe abonamenty/zakupy **0USD**, SupabaseFree pozostaje; dotychczasowy WorkersPaid i użycie usług według posiadanych pakietów. Nie jest to gwarancja braku przyszłego naliczania ani odporności Free na usypianie. Ręczne requestyApibara w tym etapie **0**; Cron działa niezależnie, jego licznika nie zerowano i nie przedstawiano starego salda jako nowego odczytu.

Dowody pozaGit: `C:/Users/nowic/Documents/Codex/REXBID_PORTAL_ACTIVATION_20261015` (before/after, HTTP, testy, logi wdrożeń, zrzuty); MFAw `REXBID_OWNER_SETUP_20261015`. Następny test: właściciel w oddzielnym profilu przeglądarki loguje istniejące „REXBID-konto testowe” i uzupełnia jawny profil TEST; potem po potwierdzeniu dokładnego konta utworzyć jedną oznaczoną realizację, sprawdzić obie strony rozmowy/odczyt/odświeżenie/izolację. Nie identyfikować klienta po kolejności kont. Nie przesyłać haseł/kodów. Wysyłka automatycznych e-maili i pliki pozostają poza tym zakresem.

Poniżej historyczne fazy — ich dawne stwierdzenia portalOFF/MFAfalse nie opisują bieżącego wdrożenia.

---

## 15.10.2026 — wdrożony ekran MFA właściciela

Produkcja **https://rexbid.pl**, Version ID **9dc22414-5c2d-470a-8c46-0893834f3554**, faza **owner-setup**. Właściciel osobno jednoznacznie zatwierdził przypisanie swojego zweryfikowanego konta oraz wdrożenie konfiguracji MFA. Obie operacje wykonano po tych potwierdzeniach; wcześniejsze odmowy automatycznej kontroli nie zostały obchodzone.

- Tożsamość wskazana we wcześniejszej uwierzytelnionej sesji ponownie dopasowana przez SHA identyfikatora oraz issuer+subject; potwierdzony produkcyjny issuer i e-mail. Konto testowe nie otrzymało uprawnień. `REXBID_OWNER_USER_ID` zapisano jako chroniony binding, bez identyfikatora w Git i bez odczytu haseł. Metadata readback PASS.
- Włączone są wyłącznie istniejące ścieżki odczytu/enroll/challenge/verify MFA właściciela. Portal config zwraca enabled=false i uploads_enabled=false; realizacje, rozmowy, pliki i reset TOTP pozostają zablokowane. Nie skonfigurowano jeszcze drugiego składnika; `production_owner_mfa_verified=false`.
- Katalog, Auth, niezależna D1, limiter, domeny i Cron co 15 min zachowane. Limity automatu 8/przebieg, 500/dzień, 12000/miesiąc, 40 nowych/dzień i rezerwa500 bez zmian. Brak R2bindingu, Sync/fallback OFF. Staging **c8436db5-d49e-47ab-8ccd-6c94e7c01606** bez wdrożenia i bez zmian MFA. Stary mtbid/DNS nietknięte.
- Świeży backup i odtworzenie w RAM PASS: 28 tabel, integralność OK, FK0. Szczegóły w [BACKUP_RECOVERY](BACKUP_RECOVERY.md). Bez zdalnej migracji.
- **967/967 pełnego suite PASS**, w tym **88/88 celowanych** publikacja/MFA/portal; tych liczb nie sumować. Generator i dry-run PASS. **24/24 rzeczywiste kontrole HTTP PASS** na produkcji: dostępność, Auth, D1/cache, brak fallbacku, odmowa anonimowego MFA, zamknięty portal/reset, odmowa obcego Origin i www308.
- Readback 12:52:42 UTC (14:52 CEST): 8 chronionych tabel w każdej D1 ma identyczne liczby i SHA przed/po; FK0. Produkcja: 2 users, pozostałe 7 tabel0. Staging: 2 users, 2 ulubione, 2 realizacje, 3 zdarzenia, 4 wiadomości, 3 pliki; profile i odczyty wiadomości0. Liczniki katalogu mogą rosnąć niezależnie przez Cron.
- Rzeczywista przeglądarka w istniejącej sesji właściciela: `/administracja` pokazuje „Skonfiguruj ochronę konta” i zamknięty panel. Nie klikano enroll, nie tworzono QR/TOTP, nie odczytywano kodów. Zrzut bez sekretów `REXBID_OWNER_SETUP_20261015/owner-security-ready.png`. To kontrola ekranu konfiguracji, nie zakończone MFA ani nowy pełny desktop/mobile QA.

Nowe zakupy/abonamenty: 0 USD; Supabase Free. Ręczne odczyty Apibara w tym kroku: 0, Cron działa niezależnie. Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_OWNER_SETUP_20261015`. Nie wykonywano pusha.

**Następne:** właściciel na swoim koncie produkcyjnym otwiera `/administracja`, klika „Skonfiguruj ochronę konta”, osobiście dodaje nowe produkcyjne TOTP w aplikacji uwierzytelniającej i zatwierdza kod. Nie przesyła QR/klucza/kodu w czacie. Po potwierdzeniu odczytać stan verified + AAL2 dla tej samej tożsamości; dopiero wtedy ustawić bramkę MFA i przygotować portal-no-files z zachowaniem Cron. Nie odtwarzać stagingowego czynnika i nie resetować istniejącego.

**Rollback tego kroku:** przy regresji powrót do fazy auth-setup (sprawdzone wcześniejsze wydanie **9de3ce41-5479-4c48-86d0-1a6339e3c140**) lub wygenerowanie jej z bieżącego kodu z `--automatic-refresh`. Przed operacją odczytać aktywny deployment. Zachować aktualną D1, tożsamości, owner binding i czynniki Supabase; samo auth-setup nie udostępnia administracji. Po zmianie sprawdzić `/ready`, konto, portalOFF i harmonogram. Bez przywracania starszej całej bazy, usuwania kont lub resetu MFA. Ta zmiana nie zmieniała schematu ani prywatnych rekordów.

---

## 15.10.2026 — produkcyjne recovery testowego klienta

Źródło: ręczne wykonanie i potwierdzenie właściciela w rozmowie, na **rexbid.pl**, na osobnym koncie testowego klienta. Hasło zapisano w Bitwarden jako „REXBID-konto testowe”; zapis sejfu nie jest technicznym odczytem jego zawartości.

| Sprawdzenie | Wynik / dowód |
| --- | --- |
| Rejestracja i potwierdzenie e-maila testowego klienta | PASS — potwierdzenie właściciela |
| Ustawienie nowego hasła przez recovery | PASS — potwierdzenie właściciela |
| Odrzucenie starego hasła | PASS — potwierdzenie właściciela |
| Logowanie nowym hasłem | PASS — właściciel odpowiedział „Tak, nowe hasło działa” |
| Zmiana hasła konta właściciela | Nie wykonywano |
| Użyty lub wygasły link, otwarcie w innej przeglądarce | Nie potwierdzono w tym rzeczywistym teście; nie mylić z istniejącymi testami syntetycznymi |

Podstawowy produkcyjny recovery E2E potwierdzony. `smtp_confirmation_recovery_verified=true`; produkcyjne MFA nadal false. Nie odczytywano haseł, Bitwarden ani tokenów recovery. Nie powtarzać wcześniejszego stagingowego E2E. Gotowa następna faza: owner-setup, zablokowane realizacje/wiadomości/pliki i samodzielne ustanowienie produkcyjnego TOTP przez właściciela. Do przypisania użyć wyłącznie dokładnej tożsamości potwierdzonej wcześniejszą sesją i skrótami, nie konta testowego.

---

## 15.10.2026 — potwierdzona rejestracja i dokładna tożsamość właściciela

Właściciel zgłosił utworzenie własnego konta produkcyjnego, zapis hasła w Bitwarden jako „REXBID-konto produkcyjne”, następnie **„konto potwierdzone, zalogowano”**. To ręczne potwierdzenie rzeczywistej rejestracji, dostarczenia/potwierdzenia e-maila i logowania. Hasła ani sejfu nie odczytywano. Nie jest to wynik recovery ani ustanowienia MFA.

Odczyt D1 15.10 o12:19:20 UTC (14:19 CEST): jedno konto, email_verified=1, issuer zgodny z niezależnym produkcyjnym Supabase. Realizacje, wiadomości i pliki nadal0; FK0. Odczyt zbiorczy nie wskazuje automatycznie właściciela — liczba/kolejność kont nie jest podstawą uprawnień. Dowód bez identyfikatorów/adresów: C:/Users/nowic/Documents/Codex/REXBID_OWNER_CONFIRMATION_20261015/registration-check.json.

Przeglądarka Codex początkowo pokazała brak aktywnej sesji. Właściciel następnie osobiście zalogował się już istniejącym kontem i potwierdził „zalogowano w Codex”. Widok /konto pokazał „Status: zalogowano · e-mail potwierdzony”, ulubione w chmurze0 oraz brak panelu importów. Bez ponownej rejestracji, odczytu cookies lub tokenów.

O12:22:01UTC (14:22CEST) odczytano identyfikator konta z dokumentu /api/me w tej samej uwierzytelnionej sesji. Odczyt D1 przez dokładne WHERE id potwierdził jeden rekord, email_verified=1, provider=email oraz issuer właściwego projektu produkcyjnego i poprawny subject. **production_owner_subject_confirmed=true**. Nie wybrano konta po kolejności ani liczbie rejestracji. Bez danych osobowych i identyfikatorów wGit; dowód zSHA: C:/Users/nowic/Documents/Codex/REXBID_OWNER_CONFIRMATION_20261015/identity-proof.json.

Nie nadano jeszcze roli ani nie ustawiono REXBID_OWNER_USER_ID. Łączna bramka smtp_confirmation_recovery_verified pozostajefalse, ponieważ realny recovery osobnego testowego klienta nie został jeszcze wykonany. ProdukcyjneMFAfalse, portal/plikiOFF. Następny krok właściciela: osobne konto testowe w prywatnym oknie na innym kontrolowanym adresie, potwierdzenie e-maila i logowanie; służy sprawdzeniu recovery bez zmiany hasła właściciela. Po E2E wrócić do dokładnej zweryfikowanej tożsamości właściciela i osobistego TOTP. Przed przypisaniem sprawdzić ponownie zgodność identyfikatorów z zapisanymi skrótami, nie wybierać najnowszego konta.

Brak zmian kodu wykonawczego/wdrożenia, uprawnień, danych, DNS i odczytów Apibara w tym kroku. Wersje9de3ce41/c8436db5 zachowane. Zmieniono dowód readiness i odpowiadającą asercję testową; statyczne sprawdzenie nie uruchamia fazyowner-setup. Celowane testy publikacji30/30PASS, generator aktywnego profiluPASS, gitdiffcheckPASS. Pełnego zestawu967testów nie powtarzano dla samego dowodu/dokumentacji; poprzedni wynik pozostaje historyczny.

---

## Aktualizacja po zgodzie właściciela

Punkt wejścia: `2d3d177ada92bf43b14a3fd55e5c453ad561c997`. Właściciel zatwierdził przedstawione zasady kont i retencji („zatwierdzam […] działaj dalej”). Akceptacja obejmuje prowadzenie kont do zamknięcia, ulubione do usunięcia pozycji/konta, comiesięczny ręczny przegląd niepotwierdzonych rejestracji starszych niż30dni oraz ręczne kopie30/90dni. Ręczne wnioski obsługuje właściciel w imieniu LLC przez kontakt@rexbid.pl. Nie jest to prawna opinia ani potwierdzenie wykonania usunięć. Osobne propozycje korespondencja12m i własne logi30dni nie zostały objęte tą zgodą. Pierwszy ręczny przegląd kont najpóźniej14.11.2026.

### Gdzie działa

- Produkcja https://rexbid.pl: **9de3ce41-5479-4c48-86d0-1a6339e3c140**, faza **auth-setup**. Włączone podstawowe konta, rejestracja/potwierdzenie adresu, login/recovery, ulubione i eksport danych konta. Są to dostępne funkcje wdrożenia; rzeczywisty e-mail E2E pozostaje do wykonania.
- Staging https://rexbid-auth-test.tedn828.workers.dev: **c8436db5-d49e-47ab-8ccd-6c94e7c01606**, aktualne dokumenty, dotychczasowe konta/portal/pliki zachowane.
- Produkcyjny portal, rozmowy, realizacje i pliki OFF; brak R2bindingu i produkcyjnego ownerID. Brak migracji, kopii użytkowników stagingu, zmiany MFA/sekretów, DNS, mtbid i pusha.
- Ten sam Worker `rexbid-production-preflight`, D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`, Supabase `kkwbqzndildovbblbkcx`; katalog D1/cache i Cron co15min zachowane. Limity nadal8/przebieg,500/dzień,12000/miesiąc,40nowych/dzień,rezerwa500.
- Supabase Free pozostaje; nowy abonament/zakup0USD. Nie ogłaszać gwarancji dostępności Free ani ustalonego limitu całej faktury Cloudflare. Brak aktywacji Pro i dodatków.

### Kontrole wykonane w tym etapie

- **967/967 pełnych testów repo PASS**, w tym58/58 celowanych; zaktualizowano asercje poprzedniej fazy publikacyjnej i treści, nie usuwano zabezpieczeń.
- **70/70 kontroli wdrożonych HTTP PASS**,14.10,17:50:12UTC. Oba środowiska, formularze/no-store, aktualne dokumenty, gotowość Auth, zapisany katalog/fallbackOFF, www308 z path/query i odrzucenie mutacji aliasu.
- Produkcja: anonimowy odczyt konta, eksportu i ulubionych401; obcy Origin dla signup/login/password/favorites403; portal/orders i security niedostępne. Syntetyczny znacznik recovery tworzy wyłącznie ograniczony grant: przekierowanie303 czyści parametr z URL, cookie Secure/HttpOnly/SameSite=Lax/Path=/ bezDomain; grant jest rozpoznawany, ale nadal401 dla danych konta/ulubionych/eksportu. Bez wywołania weryfikacji OTP, wysłania maila, utworzenia tożsamości czy zmiany hasła. Wartości cookies wyłącznie wRAM, poza raportem.
- Pierwsza wersja zewnętrznego skryptu QA zakładała nagłówek D1 na stagingu i302 dla recovery. Faktyczny kontrakt to meta.read_source=d1 oraz303. Poprawiono skrypt do rzeczywistego kontraktu; końcowy przebieg70/70. To nie naprawa backendu ani zatajenie błędu aplikacji.
- Browser: produkcyjna rejestracja desktop1280/mobile390, brak poziomego przewijania, widoczny fokus i walidacja pustego formularza. Logowanie i ekran prośby o recovery sprawdzane bez danych i wysyłki; linki do dokumentów pozostają dostępne. Dalsze dowody w katalogu QA.
- Świeży zaszyfrowany backup17:36:35UTC, odtworzenie17:37:03UTC:28tabel,integrityOK,FK0,0003/0006/0007 dwukrotnie bez zmian istniejących rekordów/schematu. [Szczegóły kopii](BACKUP_RECOVERY.md).
- Audyt po wdrożeniu17:48:01UTC:8chronionych tabel w każdej bazie identyczneSHA/liczby przed/po. Produkcyjne prywatne tabele0; stagingusers2/favorites2/orders2/events3/messages4/files3/profiles0/reads0. Nie oznacza to odczytu liczby kont Supabase: panel nadal ma sprzeczny szacunkowy licznik.
- Stan17:48:16UTC:1857ofert,3326snapshotów,19044wydarzenia,1638receiptów,FK0,duplikatyplatformaLOT0. Automat72próby, łącznie1848 z bazą1776; licznik rośnie niezależnie po wdrożeniu. Ostatni zakończony cykl17:45 odczytany zD1. Brak ręcznych odczytów Apibara w tym etapie; wcześniejszy STOP56 zachowany. To licznik prób, nie nowe saldo dostawcy.

Dowody: `C:/Users/nowic/Documents/Codex/REXBID_AUTH_ACTIVATION_20261014`. Backup prywatny: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/auth-activation-before-20261014`. Żadne sekrety, dane prywatne ani backup nie trafiają doGit.

### Następne rzeczywiste kroki

1. Właściciel osobiście otwiera https://rexbid.pl/rejestracja, używa własnego wybranego adresu i hasła, potwierdza e-mail i loguje się. Potwierdzenie najlepiej otworzyć w tej samej przeglądarce, która rozpoczęła rejestrację (PKCE). Hasło/kody wyłącznie w panelach i sejfie. Następnie wskazuje zalogowane konto jako własne; nie nadajemy ownera pierwszemu użytkownikowi.
2. Osobny testowy klient: rzeczywiste confirmation/recovery, mail w innej przeglądarce dla recovery, nowe/stare hasło, ponowny i wygasły link. Nie zmieniać hasła właściciela. Test realnego zamknięcia konta Supabase również oczekuje; dotychczasowy test zamknięcia obejmował tylkoD1wRAM.
3. Dopiero po potwierdzeniu exactissuer+subject i mapowaniu doD1users.id dodać właściwy ownerID. Po rzeczywistym e-mailE2E przejść doowner-setup; właściciel osobiście ustawia osobne produkcyjneTOTP. Nie kopiować stagingowego MFA. Portal-no-files dopiero poAAL2 i testach izolacji.

Plik bramek ma teraz legal_retention_reviewed=true; **production_owner_subject_confirmed, smtp_confirmation_recovery_verified i production_owner_mfa_verified nadalfalse**. Nie zaznaczać PASS na podstawie samej konfiguracji.

### Rollback aktywacji

W razie regresji Auth wycofać tylko kod/konfigurację kont do sprawdzonej fazy catalog+automatic-refresh (poprzednia wersja **ce112a51-fbd5-45d6-beaf-c5f4bab3853d**), zachowując bieżącą D1, sekrety, nowe tożsamości i liczniki. Odczytać najpierw bieżący deployment; przy rollbacks sprawdzić osobno harmonogram oraz bindingi. Katalog+Cron muszą zostać czynne. Staging: poprzednia wersja56b36e73-743d-421c-b9bc-01ac5998ca31.

Nie przywracać starszej całej D1 nad nowymi obserwacjami/kontami dla cofnięcia samej flagi. Jeśli potrzebny będzie rollback danych, izolowany restore, porównanie i zastosowanie rejestru zamknięć przed ruchem. Bez resetu haseł/MFA. Walidacja obecnego profilu: `node scripts/prepare-production-publication.cjs --check --evidence config/rexbid-accounts-readiness-20261014.json`.

---

## Historia: przygotowanie techniczne przed powyższą zgodą

## Zakres i stan

Punkt wejścia: df6e349e0293373f1dc1e82213bbe0a633667ab0. Aktualne zlecenie obejmuje sprawdzone wdrożenia, dlatego nie potrzeba ponownej ogólnej zgody na rozwój. Supabase Pro został odłożony; pozostaje Free. Nie uruchomiono nowego abonamentu, nie zmieniono haseł, MFA, właściciela ani uprawnień. Konto wspólnika nie zostało utworzone.

Etap usuwa kolizję faz kont z działającym automatem katalogu, poprawia formularze i zakres eksportu, aktualizuje opis danych oraz weryfikuje schemat/backup. Produkcja pozostaje w fazie **catalog** do rozstrzygnięcia zasad danych i wykonania kontrolowanego uruchomienia/testu kont. Portal i pliki produkcji pozostają OFF. Wersje wdrożeń i końcowe QA dopisano poniżej po wykonaniu.

## Wykonane poprawki

- Generator `buildAutomaticPublicationConfig(base, phase, evidence)` łączy Auth z tym samym Cron co15min, D1 i limitami. Poprzedni wariant przy przejściu na Auth usuwał Cron; nie należy go już stosować dla bieżącego wydania.
- `/ready` zachowuje sprawdzenie zapisanej oferty, zasobu HTML i bezpiecznego stanu Cron również w fazach kont; dodatkowo sprawdza konfigurację Auth. Nie wywołuje Apibara, nie loguje użytkownika, nie wysyła e-maila. Gotowość konfiguracji nie oznacza E2E.
- Rejestracja nie żąda nieużywanego imienia. Wymaga e-maila, hasła z potwierdzeniem i zaakceptowania dostępnych pod linkiem warunków. Polityka prywatności ma osobny link; nie udaje zgody marketingowej.
- Konto pokazuje link do importów dopiero po potwierdzeniu funkcji przez serwer. Eksport opisuje faktyczny zakres i brak załączników, gdy są OFF. Spóźniona odpowiedź po wylogowaniu nie przywraca prywatnego widoku.
- Aktualne dokumenty odróżniają publiczny katalog od przygotowywanych kont, opisują cookies, lokalne ulubione, Supabase i Resend. Oznaczenie do przeglądu pozostaje; testy nie są opinią prawną.

## Rzeczywiste dowody

- Cloudflare14.10,16:49:52UTC: publiczny Worker `rexbid-production-preflight`, D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`; AuthOFF, portalOFF, brak R2bindingu, CronON. Staging odrębny, Auth/portal/plikiON, bezCron. Metadane6sekretów obecne; wartości nieodczytywane przez API.
- Odrębne sekrety i ich aktywne kopie: zachowane wcześniejsze wdrożenie, kryptograficzne kontrole i ręczne potwierdzenie offlinePASS pięciu pozycji Bitwarden na obecnym komputerze. To dowód historyczny, nie nowy odczyt sejfu ani sprawdzenie drugiego urządzenia. SMTP/DB/Apibara mają wcześniejsze ręczne potwierdzenie zapisu. Nie kopiowano sekretów stagingu.
- Limiter16:59:43UTC: `AUTH_RATE_LIMITER`, namespace2026100601,30prób/60s, jedyny taki namespace w4Workerach konta. Nie zmieniano zakresu limitów.
- Supabase panel: właściwy projekt `kkwbqzndildovbblbkcx`; Confirm emailON, EmailON, anonymous/manual linkingOFF, pozostali dostawcyOFF. SiteURL/callback, CustomSMTP i polskie szablony sprawdzono we wcześniejszym etapie tego samego dnia. Są zgodne z `PARTNER_AUTH_READINESS_2026-10-14.md`.
- Lista SupabaseUsers pokazała pustą tabelę przy szacunkowym liczniku10 również po Refresh. Nie uznajemy tego sprzecznego widoku za dowód liczby tożsamości. D1 natomiast została odczytana jednoznacznie: produkcyjne users/favorites/portal0. Przed wskazaniem ownera sprawdzić konkretną zweryfikowaną tożsamość, nigdy licznik lub kolejność.
- Banner dostawcy dotyczył incydentu Realtime według status.supabase.com; nie dowodzi awarii Auth. Aplikacja nie dodaje w tym etapie integracji Realtime.
- Odczyt D1: wszystkie tabele0003/0006/0007 już istnieją, FK0. Produkcja8chronionych tabel pusta; staging2users,2favorites,2orders,3events,4messages,3files,0profiles/reads. Skróty rekordów zapisano pozaGit i porównano po wdrożeniu. Brak migracji i prywatnych zapisów z tego etapu.
- Backup16:50:12UTC: szyfrowany DPAPI+NTFS właściciel/SYSTEM,30 425 384B, SHA256 SQL `064da7ff7c386a38b6532795d4b80beb3baa07465d7913d6de4f56591764bec8`. Restore16:54:16UTC doSQLite wRAM:28tabel, integrityOK,FK0;0003/0006/0007 wykonane dwukrotnie nie zmieniają schematu ani rekordów. Testowe zamknięcie konta wyłącznie wRAM: dokładna identity, blokada ownera, cascadefavorites, inne konto zachowane i rollbackPASS. To nie test usunięcia konta wSupabase.

Dowody lokalne: `C:/Users/nowic/Documents/Codex/REXBID_ACCOUNTS_20261014`. Backup: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/accounts-before-20261014`. Żaden backup/sekret nie należy do Git ani paczki czatu.

## Gotowy zakres kolejnej aktywacji

`config/rexbid-accounts-readiness-20261014.json` zapisuje prawdziwe bramki: ustawienia/schema/backup sprawdzone, bieżące szerokie upoważnienie właściciela uwzględnione; retencja, rzeczywiste produkcyjne confirmation/recovery i owner/MFA nie są oznaczone PASS. Nie ustawiać wszystkich pól na true dla wygenerowania pliku.

Po rozstrzygnięciu zasad danych i przed aktywacją ponownie odczytać stan projektu i backup, jeżeli minął czas lub zmieniły się dane. Następnie:

```powershell
node scripts/prepare-production-publication.cjs --phase auth-setup --evidence config/rexbid-accounts-readiness-20261014.json --output wrangler.production-auth-setup.prepared.jsonc --automatic-refresh
```

Aktualne `legal_retention_reviewed:false` ma celowo blokować wygenerowanie aktywnego profilu. Plik przejściowy nie jest wdrożeniem. Po sprawdzeniu wygenerowanego diff używać przypiętego Wrangler4.149.0 i tej samej konfiguracji XDG. **Nie używać legacy `scripts/prepare-production-portal.cjs` ani `wrangler.rexbid-production.jsonc` — targetują dawny mtbid.** Nie zmieniać DNS, ponieważ rexbid.pl już działa.

Faza auth-setup: niezależny produkcyjny Supabase, konto klienta, potwierdzenie e-maila, login/recovery, ulubione i eksport konta. Brak licytacji, płatności, realizacji, rozmów i plików. Cron i zapisany katalog działają dalej.

1. Osobne konto testowe przechodzi realne confirmation/recovery; wiadomości nie kierować do wymyślonych adresów. Sprawdzić inna przeglądarka, ograniczony grant, nowe/stare hasło, wykorzystany/wygasły link i odmowę danych przed ustawieniem hasła. Nie testować zmiany hasła właściciela.
2. Właściciel osobiście rejestruje swoje konto produkcyjne, potwierdza e-mail i wskazuje je jako własne. Dokładne issuer+subject mapuje się do D1users.id; to ten UUID trafia do REXBID_OWNER_USER_ID. Nie wybierać pierwszego konta ani domniemanego e-maila.
3. Owner-setup dopiero po dowodach identity/E2E; właściciel osobiście ustanawia nowe TOTP. Nie kopiować stagingowego MFA. Portal-no-files dopiero po AAL2 i testach izolacji. Rola wspólnika wymaga osobno określonego zakresu, nie automatycznego admina.

## Jedna propozycja zasad danych do decyzji

1. Konto: do zamknięcia na zweryfikowany wniosek; ulubione do usunięcia pozycji lub konta. Obsługa ręczna przez właściciela działającego w imieniu LLC, kontakt@rexbid.pl.
2. Niepotwierdzone rejestracje: comiesięczny ręczny przegląd i usunięcie nieukończonych starszych niż 30 dni. Nie jest to automatyczny termin usunięcia; między przeglądami mogą pozostać dłużej.
3. Kopie prywatnych danych kont: zwykłe ręczne kopie do 30 dni, kopie przed istotną migracją do 90 dni; cykliczny ręczny przegląd. Rejestr wykonanych zamknięć do usunięcia ostatniej kopii, z której konto mogłoby zostać przywrócone. Obowiązki konkretnego sporu lub rozliczenia oceniać osobno.
4. Polityka przekazuje rzeczywiste role Supabase/Resend oraz odrębne okresy dostawców; weryfikacja LLC jako strony usług nie polega na zmianie właściciela domeny. Bez konta wspólnika i bez dostępu innych podmiotów do danych.

To propozycja do jednego zatwierdzenia, bez nowego abonamentu. Niczego nie skasowano ani nie ustawiono automatycznego usuwania. Instrukcja zamknięcia i obsługa częściowego błędu: [ACCOUNT_DATA_PRIVACY](ACCOUNT_DATA_PRIVACY.md). Nie wymaga ponownego potwierdzania nazwy lub adresu LLC ani podawania haseł i kodów.

## Wynik wdrożeń i QA

- Produkcja https://rexbid.pl: **ce112a51-fbd5-45d6-beaf-c5f4bab3853d**. Katalog i Cron ON; Auth, portal i pliki nadal OFF.
- Staging https://rexbid-auth-test.tedn828.workers.dev: **56b36e73-743d-421c-b9bc-01ac5998ca31**. Poprawione formularze i konto; dotychczasowe Auth, portal i pliki ON, bez zmiany danych.
- Pełne testy repo **967/967 PASS**. Pierwszy przebieg 965/967 ujawnił dwie nieaktualne asercje dokumentacji (Cron OFF i data 10.10). Poprawiono je do faktycznej treści i ponowiono pełny zestaw. Nie wyłączano testów. Celowane Auth 73/73 i publikacja 30/30 częściowo pokrywają pełny zestaw.
- Wdrożone HTTP **35/35 PASS**, 14.10 o17:06:15 UTC: oba środowiska, formularze, linki, aktualny JS, gotowość, lista i rzeczywiste flagi. To odczyty, nie produkcyjne logowanie ani e-mail E2E.
- Przeglądarka: rejestracja stagingowa przy 1280 i390px, fokus i walidacja pustego formularza, link prywatności w nowej karcie; bez poziomego przewijania. Produkcyjna prywatność przy 390 i1280px: aktualna treść i brak linków do wyłączonych kont. Konto bez sesji nie udostępnia prywatnych realizacji. Nie wpisywano nowego hasła ani nie wysłano rejestracji lub recovery. Zrzuty poza Git.
- Readback o17:06:04 UTC: osiem chronionych tabel w każdej bazie ma identyczne liczby i SHA256 jak przed wdrożeniem; FK0. Nie kopiowano danych testowych.
- Statyczne konfiguracje i generator publikacji PASS; V4 bez zmian: 610 lokalizacji i24 stawki frachtu. `git diff --check` PASS.
- Nowe zakupy i abonamenty: **0 USD**. Istniejące rozliczenia Workers Paid i Apibara pozostają; nie jest to gwarancja zerowego użycia. Supabase Free nadal może zostać uśpiony przy nieaktywności.
- Ten etap nie uruchamiał ręcznych odczytów Apibara. Produkcyjny Cron działa niezależnie i zwiększa trwałe liczniki; nie stosować starej liczby jako aktualnego salda. Historyczny STOP56 bez zmian.

Rzeczywiście oczekujące: akceptacja zasad kont i retencji oraz właściwe umowy usług; produkcyjne confirmation/recovery; jednoznaczna tożsamość właściciela i TOTP przed panelem; rzeczywisty test zamknięcia testowego konta Supabase. Lokalne testy nie zastępują tych kroków. Brak stawek partnera nie blokuje podstawowych kont. Nie kopiować jego danych ani nie przydzielać uprawnień z domysłu.

## Rollback

Zmiany tego etapu są kodowe; nie wykonano migracji ani transformacji kont. Przy regresji stagingu wrócić do `0db16a3d-d7d9-4c05-95e4-1041f799cd1b`, produkcji do `aaa709e1-24eb-4985-aa73-851c2baa0a05`, po odczycie aktualnego deploymentu i przypiętych bindingów. Zweryfikować `/ready`, katalog oraz Cron; zachować jego rosnące liczniki i dane. Rollback nie usuwa sekretów i nie przywraca starszej D1 nad nowymi obserwacjami.

Po przyszłej aktywacji Auth preferować przygotowany **catalog+automatic-refresh** z aktualnym kodem; zachować już utworzone konta. Przy rzeczywistym uszkodzeniu danych najpierw izolowane odtworzenie i porównanie, rejestr zamknięć przed ponownym ruchem. D1 backup nie odtwarza Supabase tożsamości ani MFA. Nie resetować haseł lub czynników dla rollbacku.
