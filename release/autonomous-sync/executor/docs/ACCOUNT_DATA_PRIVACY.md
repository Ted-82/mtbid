# REXBID — dane kont, retencja i obsługa zamknięcia

## 15.10.2026 — pakiet panelu bez załączników

Uruchomiona faza portal-no-files dodaje szyfrowany profil kontaktowy, przypisane realizacje i etapy, rozmowy z nadawcami REXBID/Klient oraz trwałe oznaczenia odczytu. Klient odczytuje tylko swoje realizacje i widoczne mu materiały; właściciel wymaga AAL2. Nie dodano roli wspólnika, plików ani automatycznej wysyłki e-mail. Eksport osobisty obejmuje własny profil, ulubione, realizacje, widoczne zdarzenia i rozmowy; nie jest eksportem całej administracji ani tożsamości Supabase.

**Zasady panelu zatwierdzone przez właściciela 15.10.2026 („Zatwierdzam panel i zasady przechowywania”):** profil do zmiany/usunięcia lub zamknięcia konta, z wyodrębnieniem niezbędnego zakresu otwartej sprawy; realizacje i rozmowy przez czas obsługi +12 miesięcy po zamknięciu, następnie ręczny comiesięczny przegląd/usunięcie. Minimum rzeczywistego obowiązku lub sporu ma osobny uzasadniony okres i datę przeglądu. Kopie panelu30/90dni. Nie ma automatycznego usuwania ani usunięcia wykonanego w tym etapie. Stan zatwierdzenia i wdrożenia: ACCOUNTS_RELEASE_2026-10-14.md. Dokumenty nadal do przeglądu prawnego.

Przy zamknięciu konta z realizacjami nie uruchamiać starej procedury dla pustego konta: zinwentaryzować profile, events, messages, receipts i FK, potwierdzić zakres sprawy, wykonać kopię, próbę w izolacji i rejestr zamknięcia. Nie kasować całej historii obsługi bez tego rozstrzygnięcia. Bieżący etap nie usuwa żadnych danych.

Potrzebę podania okresu lub kryterium i ograniczenia przechowywania sprawdzono w art.5 ust.1 lit.e i art.13 ust.2 lit.a [RODO — źródło pierwotne](https://eur-lex.europa.eu/legal-content/en/TXT/PDF/?uri=CELEX%3A32016R0679). **12 miesięcy jest zatwierdzonym kryterium operacyjnym, nie ustawowym okresem dla wszystkich spraw importowych.**

Poniżej historyczny zakres auth-setup; nie traktować jego opisów portalOFF jako stanu nowszego wdrożenia.

**Wersja dla auth-setup, 14.10.2026. Właściciel zatwierdził zasady kont i ich kopii opisane w sekcji 5. Nie jest to opinia prawna ani potwierdzenie wykonania usunięcia danych.**

## 1. Zakres kont podstawowych

Faza auth-setup obejmuje rejestrację, potwierdzenie e-maila, logowanie, recovery, konto, eksport jego danych i ulubione w chmurze. Portal i załączniki pozostają OFF. Działający katalog i kontrolowane odświeżanie nie zależą od kont. Profil kontaktowy, realizacje, wiadomości, załączniki oraz dostęp wspólnika nie należą do tej fazy. Konto nie umożliwia licytacji ani płatności. Odrębne stagingowe konta i MFA pozostają zachowane. Faktyczną wersję wdrożenia i wyniki kontroli zapisuje raport etapu; zmiana tego dokumentu sama nie wdraża aplikacji.

Potwierdzony administrator danych w wariancie A: **REX AUTO CARGOLOOP L.L.C**, 1209 Mountain Road Pl NE, Ste N, Albuquerque, NM 87110, United States; kontakt **kontakt@rexbid.pl**. Właściciel obsługuje klientów w imieniu spółki i pozostaje administratorem technicznym. Nie wybierać produkcyjnego właściciela z kolejności rejestracji lub domysłu dotyczącego e-maila. Rola dodatkowego podmiotu z arkusza partnera wymaga ustalenia przed przekazaniem mu danych; nie blokuje przygotowania kont bez jego dostępu.

Publiczne dokumenty rozdzielają katalog, opcjonalne konto i niedostępny panel realizacji. Zgoda właściciela z 14.10.2026 obejmuje kryteria kont, niepotwierdzonych rejestracji, ich kopii oraz ręcznej obsługi wniosków. Nie zatwierdza automatycznie pozostałych propozycji retencji ani nie zastępuje przeglądu prawnego. Rzeczywista wysyłka produkcyjnego confirmation/recovery oraz operacyjne zamknięcie testowego konta muszą zostać udokumentowane odrębnie; opis procedury nie jest wynikiem E2E.

## 2. Inwentarz potwierdzony w kodzie

| Zbiór | Zakres i cel | Przechowywanie i usuwanie obecnego kodu |
| --- | --- | --- |
| Supabase Auth | E-mail, materiał uwierzytelniający, potwierdzenie adresu, identity, sesje; logowanie i odzyskanie dostępu | Dane dostawcy; brak aplikacyjnego TTL konta. Nie przechowywać hasła ani tokenów w D1, logach lub raporcie. Włączone metody MFA mają odrębne dane u dostawcy. |
| D1 users | Wewnętrzny UUID, auth_issuer, auth_subject, provider, email_verified, created_at/updated_at | Brak adresu e-mail, hasła i tokenów. Brak automatycznego usuwania; unikalne issuer+subject. |
| D1 user_favorites | Użytkownik, VIN albo LOT/platforma, daty | Usunięcie pojedynczego ulubionego jest dostępne. FK do users z ON DELETE CASCADE; brak czasowego cleanupu. |
| Prywatny cache przeglądarki | rex_bid_cloud_favorites_v1:UUID oraz rex_bid_auth_cache_owner_v1; wybrane metadane auta i identyfikator właściciela cache | Bez tokenów. Kod usuwa cache przy logout/401/zmianie konta; brak TTL. Dane witryny może usunąć użytkownik. Nie traktować wyłączenia Auth po stronie serwera jako zdalnego skasowania każdej starej przeglądarki. |
| Lokalne ulubione gościa | rex_bid_local_v1 i legacy mtbid_favorites | Osobny zbiór bez TTL. Import do konta po potwierdzeniu użytkownika; dopiero udany import czyści bieżące ulubione gościa. Legacy klucz nie jest automatycznie usuwany. |
| Cookies | Zaszyfrowane dane sesji i krótkich operacji | Zob. dokładne czasy poniżej; nie są retencją danych Supabase. |
| Limitowanie | Klucze operacja+IP lub operacja+wewnętrzny ID użytkownika | Cloudflare limiter, nie publiczna analityka. Szczegółowej wewnętrznej retencji dostawcy nie potwierdzono. |
| Własne logi Auth | Ograniczone fakty diagnostyczne, etapy i statusy | Szczegółowa diagnostyka jest ograniczona do jawnego stagingowego hosta. Bez haseł, e-maili, body, cookies, kluczy i tokenów. Platforma może mieć odrębne logi żądań. |
| Wiadomości dostępowe | E-mail odbiorcy, treść confirmation/recovery, status dostarczenia | Supabase uruchamia wysyłkę przez skonfigurowany Resend. Dane dostawcy i skrzynka odbiorcy mają osobne zasady przechowywania. |
| Profil/portal/pliki | Imię, kontaktowy e-mail, telefon, realizacje, rozmowy, receipts odczytu, pliki | **Poza auth-setup**. Profil jest szyfrowany w portal_customer_profiles; nie deklarować jego uruchomienia razem z podstawowym kontem. |

Dowody: auth/routes.js, auth/session.js, auth/supabase.js, public/rexbid-auth.js, public/rexbid-storage.js, public/rexbid-data-export.js, portal/operations.cjs, docs/proposals/0003_accounts_foundation.sql. Inwentarz jest odczytem implementacji, nie zdalnym odczytem danych klientów.

## 3. Cookies i granice czasu sesji

Cookies Auth używają prefiksu __Host-, Path=/, Secure, HttpOnly, bez atrybutu Domain. Sesja, rejestracja i recovery mają SameSite=Lax; krótkie wyzwanie MFA ma SameSite=Strict. Zawartość jest szyfrowana AES-GCM. Sekrety nie są dostępne dla kodu przeglądarki przez localStorage.

| Cookie/operacja | Czas w kodzie |
| --- | --- |
| __Host-rexbid_session | Max-Age 30 dni od ostatniego ustawienia; odnawiane przy rotacji/refresh. **Nie jest to bezwzględny 30-dniowy limit całej sesji.** |
| __Host-rexbid_auth_flow — rejestracja | 24 godziny |
| Ten sam flow — ponowne potwierdzenie/prośba o recovery | 1 godzina |
| Flow OAuth | 10 minut |
| __Host-rexbid_recovery | Odrębny ograniczony grant 10 minut; otwarcie linku nie daje zwykłej sesji konta |
| __Host-rexbid_callback_diag | 5 minut, wyłącznie dopuszczona diagnostyka stagingu |
| __Host-rexbid_mfa_challenge | Do 5 minut lub wcześniejszego wygaśnięcia wyzwania dostawcy; SameSite=Strict; usuwane po udanej weryfikacji |

Callback czyści flow; logout czyści session/flow/recovery i lokalny cache. Usunięcie cookie nie oznacza usunięcia wszystkich sesji lub rekordów dostawcy. Źródło Supabase opisuje sesje domyślnie bez końcowego terminu oraz płatne opcje ich ograniczania; Free pozostaje wybranym planem. [Supabase — sesje](https://supabase.com/docs/guides/auth/sessions).

## 4. Eksport i minimalizacja

Eksport /api/me/export pobiera tylko mapowanie bieżącego konta REXBID i jego ulubione. Nie jest pełnym eksportem danych Supabase i nie obejmuje haseł, tokenów, MFA ani logów dostawcy. Interfejs pobierania JSON istnieje; zakres musi być nazwany konto+ulubione, gdy portal jest wyłączony. Żądanie pełnego dostępu do danych może wymagać ręcznego uzupełnienia od dostawcy. Import i odczyt ulubionych używa tożsamości zweryfikowanej po stronie serwera, nie przekazanego przez klienta user_id.

Podstawowa rejestracja wymaga e-maila i hasła, bez nieużywanego imienia. Prowadzenie dobrowolnego konta i jego ulubionych służy wykonaniu usługi na żądanie użytkownika; dokumenty wskazują art. 6 ust. 1 lit. b RODO. Nie utożsamiać akceptacji warunków korzystania z ogólną zgodą na przetwarzanie lub marketing. Bezpieczeństwo i przeciwdziałanie nadużyciom mają odrębny cel opisany w polityce.

## 5. Kryteria kont i kopii zatwierdzone 14.10.2026

Właściciel zaakceptował pakiet z [ACCOUNTS_RELEASE_2026-10-14.md](ACCOUNTS_RELEASE_2026-10-14.md), odpowiadając „zatwierdzam […] działaj dalej”. Ręczne wnioski i przeglądy wykonuje właściciel działający w imieniu LLC. **Akceptacja kryteriów nie jest dowodem wykonanego przeglądu, usunięcia ani wdrożenia automatycznego cleanupu.**

| Dane | Zatwierdzone kryterium |
| --- | --- |
| Konto Supabase i mapowanie D1 | Utrzymywać dla rzeczywiście świadczonej funkcji konta do jego zamknięcia; obsługiwać zweryfikowany wniosek ręcznie. Nie deklarować usuwania po zadanej nieaktywności, którego nie ma. |
| Ulubione w chmurze | Do usunięcia pozycji przez użytkownika albo zamknięcia konta; bez dodatkowego archiwum listy dla marketingu. |
| Niepotwierdzona rejestracja | Comiesięczny ręczny przegląd i usunięcie nieukończonych rejestracji starszych niż 30 dni. Między przeglądami dane mogą pozostać dłużej; wygaśnięcie linku samo nie usuwa użytkownika Supabase. |
| Dowód obsługi zamknięcia | Minimalny rejestr identyfikatorów, daty, zakresu i wyniku do usunięcia ostatniej kopii, która mogłaby przywrócić zamknięte konto. Nie zapisywać hasła, tokenu ani pełnej korespondencji. Konkretną dalszą potrzebę dowodową uzasadnić osobno. |
| Niezbędne dane konkretnego sporu/obowiązku | Zachować tylko właściwy zakres z odnotowanym powodem i przeglądem; nie stosować domyślnej retencji dokumentów importu do pustego konta. |
| Ręczne kopie prywatnych danych kont | Zwykłe kopie do 30 dni, kopie przed istotną migracją do 90 dni, z comiesięcznym ręcznym przeglądem. Przed usunięciem ostatniej sprawdzonej kopii sprawdzić nowszą; ewentualne przedłużenie dla konkretnego incydentu lub obowiązku osobno uzasadnić. Nie utożsamiać z oknem D1 Time Travel. |

Propozycje 12 miesięcy dla zamkniętej korespondencji i 30 dni dla własnych rutynowych logów **nie zostały zatwierdzone tą decyzją**. Pozostają oddzielnie w DATA_RETENTION_REVIEW.md. Nie zmieniono retencji zarządzanej przez usługodawców.

### Ręczny przegląd miesięczny

1. Odczytać niepotwierdzone rejestracje starsze niż 30 dni i potwierdzić brak zakończonej rejestracji oraz dokładną tożsamość; nie wybierać użytkownika wyłącznie po wieku lub kolejności.
2. Obsłużyć zakwalifikowane pozycje zgodnie z procedurą zamknięcia poniżej, z kontrolą ownera i powiązań. Nie usuwać konta ze sporną tożsamością lub wymagającego odrębnego postępowania.
3. Sprawdzić daty i przeznaczenie kopii kont. Przed wycofaniem ostatniej poprawnej kopii potwierdzić odtworzenie nowszej; nie przedłużać retencji bez odnotowanej przyczyny.
4. Zapisać datę, zakres i wynik przeglądu poza Git, bez treści korespondencji, haseł lub tokenów. Pierwszy przegląd przewidzieć najpóźniej 14.11.2026; dokument nie uruchamia automatycznego harmonogramu.

RODO dopuszcza podanie okresu albo rzeczywistego kryterium jego ustalania. Nie jest podstawą do wymyślenia niewykonywanej automatycznej retencji. [RODO art. 13 ust. 2 lit. a](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/).

## 6. Ręczna procedura zamknięcia podstawowego konta

**Procedura do przygotowania i sprawdzenia na koncie testowym. Nie wykonano jej na koncie właściciela.** Nie dodaje automatycznej rotacji haseł, zmiany MFA ani prawa do kasowania przypadkowych kont.

1. Przyjąć żądanie przez kontakt@rexbid.pl, ustalić zakres i niezbędnie potwierdzić tożsamość. Nie żądać hasła, kodu MFA, linku recovery ani przesłania dokumentów ponad rzeczywistą potrzebę. Samo żądanie z innego adresu nie uprawnia do usunięcia konta.
2. Odczytać dokładny projekt produkcyjny kkwbqzndildovbblbkcx oraz parę auth_issuer/auth_subject i odpowiadający jej UUID REXBID. Nie wybierać pierwszego użytkownika ani działać po podobnym adresie. **Porównać z REXBID_OWNER_USER_ID; dla właściciela zatrzymać standardową procedurę i ustalić zachowanie administracji.** Nie obejmować stagingu ani MFA inną operacją.
3. Sprawdzić powiązania w D1. Ta procedura dotyczy tylko konta i ulubionych przy portal OFF. Jeżeli istnieją realizacje, profile, wiadomości lub pliki, przerwać standardowe kasowanie i ustalić osobny zakres, retencję oraz skutki FK. Nie używać ogólnego cascade na nieprzejrzanej bazie.
4. Zapisać poza Git minimalny identyfikator sprawy i dokładną tożsamość do wykluczenia z późniejszych odtworzeń. Zweryfikować dostępną kopię i sposób naprawy częściowo wykonanej operacji; nie tworzyć niekontrolowanej wieczystej kopii usuwanych danych. Za pomocą istniejącego uprawnionego panelu usunąć właściwego użytkownika w Supabase Authentication → Users. Brak service-role w Workerze nie wymaga jego dodania dla ręcznej obsługi.
5. Potwierdzić wynik operacji Supabase i brak możliwości odnowienia/logowania usuniętej tożsamości. Następnie w transakcji D1 usunąć **wyłącznie** odczytane mapowanie users przy zgodnych UUID+issuer+subject, z jawnie sprawdzonym skutkiem dla user_favorites. Oczekiwać dokładnie jednego mapowania i znanej liczby ulubionych. Samo usunięcie D1 nie zamyka Supabase; ponowne prawidłowe logowanie mogłoby odtworzyć mapowanie.
6. Wykonać readback: brak tożsamości Supabase, brak wskazanego users/favorites w D1, brak FK/duplikatów, odmowa API dla poprzedniej sesji i brak wpływu na pozostałe konta. REXBID sprawdza live identity /user i mapowanie D1; nie uznawać samego skasowania wiersza za test sesji. Supabase ostrzega, że już wydany JWT pozostaje kryptograficznie ważny do expiry; nie obiecywać jego natychmiastowego unieważnienia we wszystkich usługach.
7. Przy częściowym błędzie zachować stan i zapis przyczyny. Gdy Supabase już usunięto, a D1 nie, ograniczyć dostęp i dokończyć usunięcie zweryfikowanego mapowania; nie zakładać ponownie użytkownika z backupu jako automatycznego rollbacku. Gdy usunięto tylko D1, zamknąć dostęp tożsamości w Supabase przed uznaniem sprawy za zakończoną. Nie kasować innych rekordów dla obejścia błędu.
8. Poinformować użytkownika o zakresie i wyniku, odrębnych kopiach oraz ewentualnie zachowanym minimum konkretnej sprawy. Wylogowanie usuwa cache w aktualnej przeglądarce; operator nie może zdalnie obiecać skasowania każdego urządzenia. Instrukcja użytkownika: wylogować się i usunąć dane witryny na używanych urządzeniach.
9. **Przed udostępnieniem jakiegokolwiek odtworzenia**: odtworzyć kopię do izolowanego środowiska, zastosować rejestr wykonanych usunięć do tożsamości Supabase i danych D1, sprawdzić nieobecność oraz odmowę dostępu. Dopiero wtedy dopuszczać ruch. Nie kopiować do Git rejestru tożsamości, eksportów klientów ani sekretów. Usunięcie z aktywnych danych nie usuwa automatycznie Time Travel, eksportów i kopii dostawców; egzekwować osobne uzgodnione okresy.

Instrukcje dostawcy: [zarządzanie i usuwanie użytkowników Supabase](https://supabase.com/docs/guides/auth/managing-user-data). Brak przycisku samodzielnego usuwania w aplikacji nie stanowi sam w sobie wymogu płatnej usługi; potrzebna jest działająca i sprawdzona obsługa wniosku.

## 7. Dostawcy — fakty z dokumentacji, nie odczyt zawartości kont

Przegląd oficjalnych stron 14.10.2026. Nie odczytywano treści logów ani wiadomości. Nie wykonano usunięcia i nie potwierdzono zawarcia umowy bezpośrednio przez LLC tylko na podstawie strony dostawcy.

- **Supabase Free:** cennik rozróżnia Auth Audit Logs **1 godzinę** oraz API/Database logs **1 dzień**. Automatyczne backupy i płatne timeouty sesji nie są częścią Free. Okna logów nie są terminem kasowania danych auth.users ani wszystkich kopii operacyjnych. Region projektu Ireland potwierdzono w poprzednim odczycie panelu; nie oznacza to wyłącznego przetwarzania wszystkich danych w UE. [Cennik](https://supabase.com/pricing).
- **Supabase DPA:** publiczny dokument wiąże przechowywanie z okresem umowy i wcześniejszym usunięciem na żądanie przez funkcje usługi; opisuje osobny 30-dniowy okres zwrotu danych po wygaśnięciu umowy. Nie stosować go jako TTL pojedynczego konta klienta. Warunki SCC i właściwą stronę umowy należy odnieść do rzeczywistego konta organizacji. [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum).
- **Resend Free:** według dokumentacji wiadomości i logi mają **30 dni**, backupy **7 dni**, a pozostałe dane po zakończeniu konta są usuwane w ciągu **90 dni**. Wcześniejsze usunięcie wiadomości wymaga kontaktu z dostawcą. Dane są przechowywane w USA; region eu-west-1 wybiera miejsce wysyłki, nie magazynowania. Standardowy DPA obowiązuje wszystkie plany od rejestracji; podpisaną kopię udostępnia Settings → Documents. Dokumentacja opisuje SCC. Ustalić stronę konta działającą w imieniu LLC i zachować właściwą kopię umowy, bez wymuszania zakupu tylko po to, by uzyskać standardowy DPA. [Resend — GDPR](https://resend.com/security/gdpr).
- **Cloudflare:** obowiązuje istniejący opis platformy i ręcznych kopii w DATA_RETENTION_REVIEW.md. Aktualizacja dokumentu nie włączyła nowego loggera ani eksportu. Nie przypisywać wszystkim zbiorom okresu z cennika Workers Logs.

## 8. Status akceptacji i pozostałe kontrole

1. Kryteria kont i ich kopii zatwierdzone 14.10.2026; ręczne wnioski i przeglądy wykonuje właściciel w imieniu LLC. Pozostałe propozycje retencji oraz przegląd prawny pozostają odrębne.
2. Sprawdzone własne procedury eksportu/zamknięcia i odtworzenia z ponownym zastosowaniem usunięć; bez deklaracji technicznego PASS przed wykonaniem.
3. Potwierdzone konfiguracje dostawców oraz właściwe warunki/dane strony umowy; standardowy DPA Resend nie wymaga nowego abonamentu. Konto partnera i dodatkowy podmiot pozostają poza zakresem.
4. Rzeczywiste produkcyjne confirmation i recovery na koncie testowym, z kontrolą innej przeglądarki, ograniczonego grantu, nowego/starego hasła i powtórnego linku. Wyniku stagingowego klienta nie przypisywać właścicielowi ani produkcji.
5. Wyłącznie po potwierdzeniu konkretnej produkcyjnej tożsamości przygotować rolę właściciela i jego osobny TOTP. Podstawowe konto nie nadaje roli właściciela. Portal i pliki pozostają zamknięte do osobnego sprawdzenia.

Dane firmy, wariant A i kontakt są już potwierdzone. NM Entity ID, nieustalone koszty importu i zakres dostępu wspólnika nie blokują niezależnego przygotowania auth-setup. Pro Supabase pozostaje odłożone: **0 USD nowego abonamentu** w tym etapie; Free wymaga uwzględnienia ryzyka pauzy. Nie zmieniono retencji usług, kont, haseł ani MFA przez aktualizację tego dokumentu.
