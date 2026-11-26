## 12.10.2026 — rexbid.pl uruchomione za zgodą właściciela

Publiczne https://rexbid.pl; www308 zachowuje path/query, HTTP301 doHTTPS. Worker rexbid-production-preflight **1cd69740-fda8-495a-a895-587f135cf077**, odseparowana D1c8a30088. Auth/portal/files/Cron/Sync/fallbackOFF. Staging **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**, zachowane dane/MFA; mtbid351ac4e7 nietknięty. Delegacja blair/titan potwierdzona w OVH i pięciu odpowiedziach parent; DS0 na b/d/f/h/j, a timeout. Cloudflare active,13 wpisów (11 zachowanych zwykłych +2 managedWorker), poczta32/32PASS. Workers Paid aktywowany samodzielnie przez właściciela:5USD/mies.+usage, nie hard cap.

Naprawiono ujawniony w rzeczywistym QA błąd mobilnego menu (stara reguła ukrywała Jak to działa/Ulubione). **913/913 repo,47/47 celowane,31/31 final-domainHTTP/API PASS**; desktop/mobile, VIN/LOT, karty obu platform, galerie, częściowyV4, lokalne ulubione i kontakt sprawdzone. Fresh backup+readback; dane1817/3253/19044/1638/private0 zachowane,0 migracji i nowychApibara. Daty8–9.10 nadal wymagają kontrolowanego odświeżenia; nie udają danych live.

[Raport uruchomienia i konkretny rollback](PUBLIC_LAUNCH_QA_2026-10-12.md). Starsze wpisy poniżej są historią, w tym dawne „brak zgody/Free/pending”; nie wykonywać ponownie delegacji, tworzenia zasobów ani transferu danych. DNSSEC i produkcyjne konta/portal pozostają osobnym etapem. Treści prawne zachowały oznaczenie wersji do przeglądu, nie przypisano im prawnej akceptacji. Bez pusha.

---

## Aktualny stan12.10.2026 — techniczny pakiet publikacji ukończony

Odseparowany Worker/D1 gotowy w lokalnym pakiecie C:/Users/nowic/Documents/Codex/REXBID_PUBLICATION_PREP_20261012/candidate. Naprawiono produkcyjne robots/sitemap i /ready; katalog ma1817ofert/19044events/1638stanów, prywatne tabele0, FK/duplikaty0. Ponowny restore istniejącej kopiiPASS na obecnym komputerze. 912testówPASS +końcowy suite publikacji20PASS, dry-run repo/pakietPASS. Dashboard potwierdza WorkersFree; Paid5USD/mies.+usage, bez zakupu. Staging5079f5f9 zachowany, nie wdrażano zmian publikacyjnego entrypointu na staging. Apibara0, DNS/produkcja bez zmian. [Aktualny raport](PUBLICATION_TECHNICAL_QA_2026-10-12.md).

Zimbra i dane firmy są potwierdzone. Braki wspólnika nie blokują pierwszego częściowego katalogu. Pozostaje akceptacja dokumentów/retencji i konkretnego cutoveru, rekomendowany Paid przed ruchem oraz DS/TLS/smoke w zatwierdzonym oknie. Auth/portal/pliki/Cron/Sync/fallbackOFF. Starsze wpisy poniżej są historią; nie wykonywać ich ponownie.

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

# REXBID — końcowa karta akceptacji publikacji

**Stan na 10 października 2026: transfer zapisanych danych ukończony, staging f673688f. Zgoda na potrzebne przedstawione koszty udzielona; zgoda na publikację i DNS nie została udzielona.** [Aktualny QA](MAIL_DOCUMENTS_QA_2026-10-10.md), [budżet](OPERATING_BUDGET_2026-10-10.md).

Ta karta obejmuje jeden pierwszy etap katalogu. Potwierdzenie danych firmy i wariantu A nie jest zgodą na jego uruchomienie. Podstawą wykonania pozostaje [runbook publikacji](PRODUCTION_CUTOVER_RUNBOOK.md); karta precyzuje podmiot, treści do akceptacji i zakres jednej końcowej zgody.

## Potwierdzony podmiot i role

| Pozycja | Potwierdzony stan |
| --- | --- |
| Firma | REX AUTO CARGOLOOP L.L.C |
| Adres | 1209 Mountain Road Pl NE, Ste N, Albuquerque, NM 87110, United States |
| Administrator danych | REX AUTO CARGOLOOP L.L.C — wariant A |
| Rola użytkownika | Działa w imieniu firmy i pozostaje administratorem technicznym serwisu |
| Kontakt | kontakt@rexbid.pl |
| NM Entity ID | Nieustalony; nie podawać niezweryfikowanego numeru |

Nazwa, adres i wariant A są już potwierdzone i nie wymagają ponownego pytania. NM Entity ID pozostaje nieustalony; [przegląd źródeł](LEGAL_SCOPE_REVIEW.md) nie wykazał go jako samodzielnego warunku publikacji tego katalogu.

## Treści objęte końcową akceptacją

Do przeglądu i zatwierdzenia są końcowe teksty [O nas](../public/o-nas.html), [kontaktu](../public/kontakt.html), [warunków](../public/warunki.html) i [polityki prywatności](../public/prywatnosc.html), wraz z [propozycją retencji](DATA_RETENTION_REVIEW.md).

Okresy, wyjątki i sposób usuwania danych należy zatwierdzić dokładnie w wersji opisanej w DATA_RETENTION_REVIEW.md. Karta nie dopisuje własnych okresów ani nie przedstawia niepotwierdzonych ustawień usług jako wdrożonej retencji. Zmiana dokumentów po akceptacji wymaga ponownego przeglądu zmienionej treści.

Pierwsza publikacja umożliwia oglądanie katalogu, orientacyjne kalkulacje i przygotowanie wiadomości e-mail. Formularz kontaktowy nie wysyła wiadomości z serwera i nie składa zlecenia licytacji. Kalkulator V4 pokazuje znane koszty i braki; brakujące koszty nie są zerem ani pełną ceną dostawy pod dom.

## Warunek kanału korespondencji — przed publikacją kontaktu

Obecny kanał kontakt@rexbid.pl to aktywna skrzynka OVH Zimbra; Gmail projektu przechowuje tylko wcześniejszą korespondencję, bez automatycznego przekierowania nowych wiadomości. Przed publikacją kontaktu należy zamknąć ocenę rzeczywistych podmiotów i warunków usług odbierających dane w imieniu LLC oraz podstawę odpowiednich transferów, albo udokumentować wybrany inny kanał korespondencji. Wynik i zaakceptowany kanał muszą odpowiadać końcowej polityce prywatności oraz [przeglądowi prawnemu zakresu](LEGAL_SCOPE_REVIEW.md). Ten warunek nie jest jeszcze zamknięty.

Konsumencki Gmail nie ma DPA i Google nie działa w tej usłudze jako podmiot przetwarzający, zgodnie z [oficjalnym wyjaśnieniem Google](https://support.google.com/policies/answer/9581826?hl=en). Nie opisywać takiej skrzynki jako procesora LLC objętego umową powierzenia. Sama nazwa Gmail nie potwierdza korzystania z Google Workspace ani przyjęcia jego warunków.

Aktywna skrzynka Zimbra i historyczne archiwum Gmail pozostają zachowane podczas przyszłej publikacji. Jeśli wybór innego kanału wymaga zmiany usług lub przekierowania, dokładna zmiana i właściwy opis odbiorców muszą zostać udokumentowane w pakiecie przed końcową akceptacją. Sama zgoda właściciela na publikację nie zastępuje wymaganych umów, podstaw przetwarzania ani warunków transferu. Brak udokumentowanego kanału oznacza STOP przed publikacją kontaktu.

## Dokładny cel pierwszej publikacji

| Element | Zatwierdzany zakres |
| --- | --- |
| Konto Cloudflare | Tedn828 / 7ff5a57444667c4eda2a6a7f0fc4120d |
| Worker | rexbid-production-preflight |
| D1 | rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d |
| Profil i kod | wrangler.production-publication.jsonc / worker.publication.js / faza catalog / tryb stored |
| Domena główna | https://rexbid.pl |
| Alias | https://www.rexbid.pl, na tym samym nowym Workerze |
| Funkcje | Zapisany częściowy katalog, filtry, karty Copart/IAAI, odnośniki do mediów, historia aukcji i osobne obserwacje, Calculator V4, lokalne ulubione i kontakt |

Auth, portal, załączniki R2, Cron, Sync, discovery, uzupełnianie mediów i automatyczny provider fallback są OFF. Brak bindingu R2. Brak kopiowania kont, MFA, wiadomości, zleceń lub plików ze stagingu. Obecne mtbid oraz rexbid-db / 971879fe-04ed-4e8c-9dc6-5306980bb872 nie są celem tej operacji. Publikacja nie stosuje migracji i nie obejmuje pusha.

Aktualny kandydat i dowody: [raport ukończenia](PUBLICATION_COMPLETION_QA_2026-10-10.md). Preflight zawiera1817 ofert (945Copart/872IAAI), 3253obserwacje, 19044wydarzenia i1638stanów historii. Transfer276/276 ireadbackPASS,private0. Pozostaje179 nowych historii niepobranych i167 wcześniejszych nierozstrzygniętych przypadków; nie przedstawiać ich jako pustych ani źródłowo kompletnych. Daty pozostają rzeczywiste, katalog częściowy. Warunki dokumentów/retencji/faktycznej korespondencji poniżej nadal obowiązują.

Historyczna kampania pozostaje STOP 56. Licznik wszystkich prób operatora1774, ostatnie rozliczenie dostawcy5833/30000; w przygotowaniu kandydata0nowych requestów. Akceptacja katalogu nie zezwala na nowe odczyty Apibara.

## Dokładny zakres DNS i HTTPS

Delegację rexbid.pl można zmienić z dns111.ovh.net / ns111.ovh.net na **blair.ns.cloudflare.com / titan.ns.cloudflare.com**. Po statusie Cloudflare active do usunięcia są wyłącznie parkingowe A apex i www wskazujące 213.186.33.5 oraz nieużywany CNAME ftp wskazujący apex. Oba Custom Domains zostają podłączone do wskazanego nowego Workera; Cloudflare tworzy ich DNS i certyfikaty.

Pozostałe **9 rekordów pocztowych i TXT** zachowuje pełne wartości i priorytety:

- 3 MX apex: 1 mx1.mail.ovh.net, 5 mx2.mail.ovh.net, 100 mx3.mail.ovh.net;
- SPF apex: v=spf1 include:mx.ovh.com -all;
- pełny DKIM TXT resend._domainkey.powiadomienia.rexbid.pl;
- CNAME rsend.powiadomienia → rsend-euw1.forge.rmta.net i send.powiadomienia → send.forge.rmta.net, oba DNS only;
- TXT apex 1|www.rexbid.pl i TXT www 3|welcome.

Strefa OVH i istniejący forwarding kontakt@rexbid.pl zostają zachowane w opisanym zakresie DNS. Nie jest to potwierdzenie zgodności obecnego odbioru przez Gmail; obowiązuje warunek udokumentowanego kanału powyżej. Zmiana kanału wymagająca innego przekierowania wymaga doprecyzowania tego pakietu przed akceptacją. Ten etap nie wysyła maili ani nie zmienia ustawień SMTP. DMARC wymaga osobnego zakresu.

HTTP → HTTPS obejmuje apex i www. Dla HTTPS alias www przyjmuje wyłącznie GET i HEAD: zwraca **308** do apex, zachowując pełną ścieżkę i query, z no-store i **bez Set-Cookie**. Inne metody aliasu oraz obce hosty otrzymują **421** przed Auth/API. Nie dodawać równoległego CNAME www → apex ani drugiej reguły tego samego przekierowania.

TLS obu nazw, poprawność certyfikatów, HTTP → HTTPS, 308, path/query, brak pętli, 421 i brak Set-Cookie są kontrolami tego zatwierdzanego uruchomienia. Nie zostały jeszcze potwierdzone na docelowej domenie. **DNSSEC Cloudflare i nowy DS są późniejszym etapem po stabilizacji, wymagającym osobnej zgody.**

## Dowody oraz warunki wykonania

[DNS z 8 października](DNS_READINESS_REFRESH_2026-10-08.md) potwierdza **12/12 rekordów** na obu OVH i obu Cloudflare NS o 13:44 CEST. Pięć aktualnych serwerów .pl — b, d, f, h i j — odpowiedziało przez UDP i TCP: AA = 1, NOERROR/NODATA, DS = 0. a-dns.pl miał timeout, a IPv6 ENETUNREACH; oba wyniki są NOT VERIFIED i nie oznaczają DS = 0. Nie jest potrzebny kolejny eksport od właściciela bez zmiany strefy.

Macierz DS według aktualnej listy NS IANA operator ponawia **dopiero w faktycznym oknie, bezpośrednio przed delegacją**. DS różny od 0, sprzeczność albo brak dostatecznych odpowiedzi autorytatywnych oznacza STOP. Odczyt stanu strefy i zachowania poczty w oknie służy wykryciu zmian po zapisanym porównaniu.

[Handoff](../PROJECT_HANDOFF.md) i [aktualny raport](PUBLICATION_COMPLETION_QA_2026-10-10.md) dokumentują staging Version e74e4106-929d-4f5d-92ed-9e69eeaa1133, 902/902 testów repo i 14/14 pakietu partnera oraz celowane rzeczywiste QA desktop/mobile. Starszy pełny przegląd ścieżki pozostaje osobnym, datowanym dowodem; nie jest nowym testem domeny. Te dowody nie zastępują kontroli publicznej domeny. [Scenariusz 12.10](PARTNER_DEMO_2026-10-12.md) zawiera sprawdzone auta, zapasowe BEV i ograniczenia świeżości. Prywatny preflight ma odczytaną wersję 0a876baa-7b80-44ce-9d85-602ff8c82314.

W oknie operator potwierdza końcowy build i konfigurację, właściwe konto/Worker/D1, limity usług oraz aktualność backupu względem readbacku i manifestu SHA-256. Zmiana danych wymaga nowego szyfrowanego backupu i sprawdzenia odtworzenia według [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md). Niezgodny target, konfiguracja, backup albo niespełniona kontrola oznacza STOP.

Po uruchomieniu obowiązują kontrole HTTPS i katalogu: Home, filtry, VIN/LOT, obie platformy, galerie, historia obserwacji, V4, lokalne ulubione, kontakt oraz OFF wyłączonych funkcji, z potwierdzeniem braku wywołań providera. Po 15–30 minutach następuje mała kontrola błędów i limitów.

## Kiedy zatrzymać lub cofnąć uruchomienie

| Zdarzenie | Działanie zgodne z runbookiem |
| --- | --- |
| Niezgodny target, build, dokumenty, konfiguracja, limity lub backup | STOP przed zmianą usług |
| Brak udokumentowanego, zaakceptowanego kanału korespondencji i odpowiednich warunków odbiorców/transferów | STOP przed publikacją kontaktu; uzupełnić pakiet, bez samowolnej zmiany usług |
| Sprzeczny DS lub niedostateczny dowód przed delegacją | STOP; bez zmiany NS |
| Błąd DNS/TLS albo regresja poczty | Zatrzymać podłączenie lub odtworzyć zatwierdzony snapshot Cloudflare/routingu; powrót NS do OVH wymaga kontroli TTL/DS i uzgodnienia z właścicielem |
| Regresja katalogu lub V4 | Cofnąć do zgodnego builda tego samego nowego Workera albo wycofać jego routing; nie używać mtbid jako rollbacku |
| Nieoczekiwany provider fallback, aktywna wyłączona funkcja lub przekroczenie limitów | Wyłączyć daną funkcję lub publiczny routing; bez nowych requestów, retry i upgrade |
| Utrata danych | Freeze i backup incydentu; odtworzenie tylko do osobnej D1, kontrola schema/count/FK oraz osobna zgoda na rebind |
| Późniejszy powrót NS po wprowadzeniu DS Cloudflare | Zachować spójne NS/signing, najpierw bezpiecznie zmienić/usunąć DS i odczekać jego TTL; potem cofnąć delegację |

Nie odtwarzać starszego dumpu w miejscu i nie usuwać danych podczas rollbacku. Cofnięcie builda Workera nie cofa delegacji, DNS ani DS.

## Jedna treść końcowej zgody — do udzielenia po przeglądzie

> Przy zachowaniu wcześniej potwierdzonych danych REX AUTO CARGOLOOP L.L.C oraz wariantu A zatwierdzam końcowe teksty O nas, kontaktu, warunków i polityki prywatności oraz propozycję retencji dokładnie w wersji opisanej w docs/DATA_RETENTION_REVIEW.md. Numeru NM Entity ID nie ustalono i nie należy podawać go jako potwierdzonego; przegląd źródeł nie wykazał go jako samodzielnego warunku publikacji katalogu. Akceptacja obejmuje wyłącznie udokumentowany kanał korespondencji wskazany w uzupełnionym docs/LEGAL_SCOPE_REVIEW.md i końcowej polityce prywatności. Nowa korespondencja trafia do aktywnej skrzynki OVH Zimbra kontakt@rexbid.pl. Gmail projektu przechowuje wcześniejsze archiwum; nowe wiadomości nie są tam automatycznie przekierowywane. Warunkiem publikacji kontaktu jest udokumentowanie oceny warunków rzeczywistych odbiorców danych i podstaw odpowiednich transferów albo udokumentowanie wybranego innego kanału. To oświadczenie nie zastępuje wymaganych umów, podstaw przetwarzania ani warunków transferu.
>
> Zatwierdzam opisany w tej karcie i docs/PRODUCTION_CUTOVER_RUNBOOK.md pierwszy etap publikacji zapisanego, częściowego katalogu, kart, odnośników do mediów, historii obserwacji, filtrów, Calculator V4, lokalnych ulubionych i kontaktu na rexbid-production-preflight / D1 c8a30088-70af-43a6-9a7f-c4018279d37d, pod rexbid.pl i www.rexbid.pl. Zgoda obejmuje skoordynowane okno delegacji OVH na blair.ns.cloudflare.com / titan.ns.cloudflare.com, usunięcie tylko parkingowych A apex/www i nieużywanego FTP, podłączenie obu Custom Domains, HTTP → HTTPS, certyfikaty TLS oraz kontrole i rollback opisane w karcie. Zachowuję wszystkie 11 rekordów pocztowych/TXT: 9 wcześniejszych oraz 2 nowe CNAME DKIM Zimbra; strefę OVH i aktywną skrzynkę Zimbra. Rozumiem ograniczenia zbioru i rzeczywiste daty obserwacji. Warunkiem wykonania są poprawne target/build/config, limity, aktualny backup/readback, ponowiona w oknie autorytatywna macierz DS oraz kontrole DNS/HTTPS. Auth, portal, R2, Cron, Sync, discovery, uzupełnianie mediów i automatyczny provider fallback pozostają OFF. Zgoda nie wznawia historycznej kampanii STOP 56 i nie obejmuje nowych requestów Apibara, migracji, kopiowania prywatnych danych, zmian mtbid/rexbid-db ani pusha. DNSSEC/nowy DS i późniejsze fazy wymagają osobnej zgody.

**Powyższy tekst jest propozycją do akceptacji. Nie został udzielony i nie uruchamia publikacji.** Cały sprint wdrożył poprawki wyłącznie na stagingu i zapisuje lokalny checkpoint. Nie wykonano publicznego deployu, migracji, requestów Apibara, zmian DNS/NS, odczytu wartości sekretów ani pusha.

## Aktualizacja poczty i dokumentów10.10.2026

Pełne dokumenty kontaktu/warunków/prywatności zaktualizowano do faktycznego formularza i historii aukcji. Odczyt OVH zamknął brak dotyczący kopii w skrzynce redirect: nie ma w niej skrzynki odbiorczej. Potwierdzono posiadaną bezpłatną w zamówieniu Zimbra Starter i już zaakceptowane DPA/warunki na koncie technicznym. Nie aktywowano skrzynki ani nie zastąpiono Gmaila. Konkretna pozostająca decyzja to zatwierdzenie kanału kontaktowego: pozostawienie opisanego Gmaila z jego rzeczywistymi rolami/warunkami lub wykorzystanie istniejącej firmowej Zimbra po sprawdzonym planie współistnienia i uruchomieniu. Rekomendowane jest drugie rozwiązanie, bez zakupu kolejnej usługi. Nie przedstawiać tej rekomendacji jako już wykonanej migracji poczty.

Obecny pakiet DNS zachowuje dotychczasowe9 rekordów pocztowych/TXT. Ewentualna zmiana poczty musi otrzymać dokładny diff z faktycznego OVH, zaktualizowany opis odbiorców i osobną kontrolę odbioru przed końcową zgodą. Domyślny kreator Zimbra może zmienić rekordy: nie zatwierdzać automatycznej konfiguracji jako części obecnego pakietu.

Aktualne QA, staging i checkpoint zostaną podane w MAIL_DOCUMENTS_QA_2026-10-10.md. Ta aktualizacja nie udziela zgody na delegację/publikację.

## Zatwierdzony wybór Zimbra — 10.10, 18:22 CEST

Właściciel polecił kontynuować rekomendowaną Zimbrę. Wybór kanału jest rozstrzygnięty; nie prosić ponownie o wybór Gmail/Zimbra. Dodano domenę do istniejącej organizacji bez automatycznych zmian DNS. Oba autorytatywne serwery OVH nadal zwracają pełne, zgodne rekordy poczty (10/10 odczytów MX/TXT/DKIM/CNAME). Formularz kontakt@rexbid.pl z dostępną licencją Starter jest przygotowany; właściciel ma samodzielnie wpisać i zachować hasło oraz zatwierdzić utworzenie. Po tej czynności sprawdzić rzeczywisty stan konta, konflikt z redirect, wymagane rekordy i kontrolowany odbiór przed zmianą kierowania wiadomości. Obecna polityka opisuje nadal faktyczny OVH → Gmail. Zgoda na przygotowanie skrzynki nie jest zgodą na DNS, delegację ani publiczny deploy.
