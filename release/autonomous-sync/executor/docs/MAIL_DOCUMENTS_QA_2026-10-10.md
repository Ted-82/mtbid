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

> **10.10.2026, 19:30 CEST — rzeczywisty odbiór Gmail → Zimbra PASS.** Po zgłoszeniu właściciela o wysłaniu z przeglądarki własny odczyt potwierdził w skrzynce odbiorczej kontakt@rexbid.pl wiadomość od rexbid.kontakt@gmail.com: temat „Test REXBID”, treść „Test odbioru nowej skrzynki”, czas pokazany przez Zimbra 10.10.2026 19:28 CEST. Nie w spamie. Dokładny temat różni się od proponowanego „TEST REXBID PRZEGLĄDARKA”; nie wyciągać z tego wniosku, który klient wysłał wiadomość. Wcześniejsze „W kolejce” zostało skorygowane przez właściciela jako jeszcze niewysłany test, nie awaria odbioru. Przygotowano odpowiedź „Test wysyłki ze skrzynki kontakt@rexbid.pl.” do tego samego Gmaila, ale agent jej NIE wysłał. Wysyłka Zimbra → Gmail nadal oczekuje na zatwierdzenie przez właściciela i kontrolę odbioru. Dowody poza Git: zimbra-inbound-test-pass.png i zimbra-outbound-test-draft.png. DNS/DKIM, aplikacja i dane bez zmian.

> **10.10.2026 — logowanie Zimbra potwierdzone.** Właściciel zgłosił „zalogowano”; własny odczyt przeglądarki potwierdził https://zimbra1.mail.ovh.net/modern/, konto kontakt@rexbid.pl i otwartą pustą skrzynkę odbiorczą. To PASS logowania, nie test odbioru lub wysyłki. Nie odczytywano haseł ani sejfu i nie wnioskowano, czy właściciel zmienił hasło przy pierwszym logowaniu. Odbiór/wysyłka nadal oczekują na kontrolny e-mail z własnego adresu właściciela i odpowiedź. DKIM/SRV pozostają przygotowane do osobnej zgody, DNS bez zmian. Dowód poza Git: REXBID_MAIL_DOCUMENTS_20261010/zimbra-login-confirmed.png.

> **10.10.2026, 18:53 CEST — konto Zimbra utworzone i aktywne.** Po usunięciu zatwierdzonej reguły właściciel zatwierdził formularz. Readback OVH: kontakt@rexbid.pl, Starter 15 GiB, Aktywna, wykorzystanie 1/1, domena REXBID z 1 kontem. ID konta d90ee060-b9bb-46fe-aa87-b7c75c7e0006. Poprzednia blokada wynikała z zajęcia adresu przez przekierowanie, nie wykazano błędnego hasła. Stara reguła do Gmaila usunięta; wcześniejsze wiadomości Gmaila nie były dotykane. Diagnostyka OVH: MX OK, SPF OK, DKIM wymaga 2 CNAME, SRV autodiscover brak. DNS niezmieniony (10/10 readback), rekordy do osobnej zgody poniżej w QA. Aktywna w panelu nie oznacza potwierdzonego E2E: właściciel otrzymał logowanie, wynik logowania/odbioru/wysyłki oczekujący. Bez nowego zakupu, zmian strony, D1 lub MFA.

> **10.10.2026, 18:51 CEST — zatwierdzone zastąpienie przekierowania w toku.** Właściciel wyraził zgodę na usunięcie pojedynczej reguły kontakt@rexbid.pl → rexbid.kontakt@gmail.com i zastąpienie jej Zimbra. Przed zmianą odczytano Starter 0/1, brak zadań i dokładnie jedną regułę. Usunięcie przyjęte przez OVH; readback 0/1000, brak przekierowań, następnie tabela zadań pusta. Nie usuwano wiadomości Gmaila. Formularz konta z hasłem wprowadzonym przez właściciela pozostaje gotowy; końcowe Zatwierdź przekazane właścicielowi, nie wykonane przez agenta. Odbiór podczas przełączenia NIE jest potwierdzony. Nie zakładać, że stara reguła nadal działa. Odtworzenie w razie błędu według planu w QA. Kontrola DNS 16:51:49Z: 10/10 zgodnych wyników na dns111/ns111, plik zimbra-dns-after-release.json poza Git. DNS, aplikacja, MFA, D1 i plany niezmienione.

> **10.10.2026 — ustalona blokada utworzenia Zimbra:** po zatwierdzeniu przez właściciela OVH zwróciło `The email address for your account is already used; check existing mailbox, alias, redirection, or mailing list name.` Odczyt tabeli Redirect potwierdził dokładnie 1 wpis: kontakt@rexbid.pl → rexbid.kontakt@gmail.com. Adres jest zajęty przez dotychczasowe przekierowanie; nie diagnozować tego jako błędnego hasła. Skrzynka nadal nieutworzona. Zachowano oba zrzuty: zimbra-address-conflict.png i ovh-existing-contact-forward.png poza Git. Przekierowania nie usuwano, DNS i usługi aplikacji bez zmian. Proponowane zastąpienie wymaga zgody właściciela ze względu na zmianę odbioru i możliwą przerwę. Szczegółowy zakres i wycofanie w aktualnym QA poczty.

> **10.10.2026 — wynik próby logowania właściciela:** Zimbra odrzuciła nazwę użytkownika lub hasło. Równoczesny odczyt OVH nadal: 0 kont / Starter 0/1. To nie dowodzi błędnego hasła; utworzenie konta nie jest potwierdzone. Przygotowano bez zapisu formularz Konto e-mail → Skonfiguruj: kontakt@rexbid.pl, organizacja REXBID, nazwa REXBID Kontakt, posiadany Starter (1). Pole hasła pozostawione właścicielowi, końcowe Zatwierdź niewykonane. Domyślne wymuszenie zmiany przy następnym logowaniu pozostawiono bez zmiany. Właściciel ma wprowadzić zapisane hasło i zatwierdzić, pozostawiając wynik do kontroli; nie uznawać formularza za utworzone konto. Bez resetu, zakupu, DNS, produkcji i zmian aplikacji.

> **10.10.2026 — kontrola po potwierdzeniu właściciela „zapisane i skonfigurowane”.** Właściciel potwierdził zapis hasła Zimbra w Bitwarden i zakończenie konfiguracji; sekretu nie odczytywano. OVH po pełnym odświeżeniu nadal pokazuje 0 kont, Starter 0/1, licencję bez przypisanego konta i organizacji oraz brak zadań w toku. Domena aktywna, liczba kont 0. Komunikat sukcesu kreatora nie wystarcza do potwierdzenia utworzenia skrzynki. Przyczyna rozbieżności nieustalona. Nie ponawiano tworzenia ani resetu hasła. Przygotowano oficjalny formularz https://zimbra1.mail.ovh.net/ do kontrolowanego logowania właściciela; logowanie oraz odbiór/wysyłka pozostają nieweryfikowane. Dowód poza Git: REXBID_MAIL_DOCUMENTS_20261010/zimbra-license-unassigned.png. DNS, redirect, staging, produkcja i MFA bez zmian; brak zakupu. Wybór Zimbra jest już zatwierdzony — wcześniejsze prośby o wybór kanału lub zapis hasła są historyczne. Następny krok: właściciel sprawdza logowanie zachowanym hasłem, bez udostępniania go w czacie.

> **10.10.2026, 18:22 CEST — wybór Zimbra zatwierdzony przez właściciela („działaj”), konfiguracja rozpoczęta.** Wykorzystano istniejącą organizację REXBID i licencję Starter (1). Dodano rexbid.pl do usługi Zimbra z wyłączonym automatycznym zapisem wszystkich czterech grup DNS (SRV, MX, SPF, DKIM). Kreator zakończył krok domeny i przeszedł do konta. Przygotowano kontakt@rexbid.pl, nazwę wyświetlaną REXBID Kontakt i posiadany Starter; pole hasła pozostawiono puste, utworzenie konta czeka na właściciela. Nie tworzono kolejnej organizacji ani nie zamawiano licencji. Bezpośrednie odczyty obu OVH: 10/10 porównań MX/TXT/DKIM/CNAME zgodnych z zachowanym stanem, receipt zimbra-dns-after.json. Brak zmiany DNS nie jest testem dostarczenia wiadomości — odbiór nowej skrzynki nadal niezweryfikowany. Nie wracać do pytania o wybór kanału i nie uruchamiać ponownie kreatora od początku.

# REXBID — poczta, dokumenty i pakiet publikacji

Stan: 10.10.2026. **STAGING VERIFIED — MAIL CHANNEL DECISION / PUBLICATION APPROVAL PENDING.** Nie zmieniono produkcji, DNS, delegacji, danych D1, MFA ani sekretów. Nie wysłano wiadomości i nie wykonano requestów Apibara.

## Gotowy rezultat

- Staging: https://rexbid-auth-test.tedn828.workers.dev/
- Version ID: **f673688f-7b7d-45f1-a812-a42a927bb190**, 100%, wdrożenie 10.10 o 16:09:23 UTC / 18:09:23 CEST. Metadane potwierdzone o 16:11:02 UTC. Rollback stagingu: e74e4106-929d-4f5d-92ed-9e69eeaa1133.
- [Warunki](https://rexbid-auth-test.tedn828.workers.dev/warunki.html) i [prywatność](https://rexbid-auth-test.tedn828.workers.dev/prywatnosc.html) mają pełne dziewięć sekcji, datę 10.10 i zachowane oznaczenie wersji do przeglądu. Odpowiadają potwierdzonemu podmiotowi, wariantowi A, aktualnemu formularzowi i historii aukcji. Kopie docs/legal są zgodne z HTML.
- Formularz wymaga imienia, e-maila i wiadomości, a budżet jest opcjonalny. Przygotowanie szkicu nie wysyła go do backendu ani do panelu; adres nadawcy będzie także częścią samodzielnie wysłanego e-maila. Nie zmieniono istniejących funkcji formularza.
- Odczyt aktualnych ustawień Cloudflare i OVH uzupełnia wcześniejsze materiały, zamiast zastępować je niepotwierdzoną deklaracją.

## Faktycznie sprawdzona poczta

| Kontrola | Rzeczywisty wynik | Ograniczenie |
| --- | --- | --- |
| MX Plan OVH | Aktywna usługa redirect; 0/0 skrzynek, jedno przekierowanie kontakt@rexbid.pl → rexbid.kontakt@gmail.com | Nie ma dodatkowej skrzynki w tej usłudze; retencji kolejek, logów i kopii operatora nie potwierdzono |
| Istniejąca licencja | Zamówienie zawiera Free starter account with domain oraz Zimbra Starter; usługa odnawiana 5.10.2027 | Nie kupiono nowej usługi; dokładnej ceny przyszłego odnowienia nie odczytano |
| Warunki | Zimbra 20.01.2025 i DPA 17.10.2025 już zaakceptowane na koncie technicznym 5.10.2026 o 15:42 | Nie akceptowano nowych umów; nie jest to dowód bezpośredniej umowy LLC z OVH |
| Przygotowanie Zimbra | Utworzono logiczną organizację REXBID | Domena/skrzynka/hasło nieutworzone; nie kontynuować przez tworzenie drugiej organizacji |
| Kreator | Proponuje autorytatywną domenę i automatyczne DNS. Obejrzenie konfiguracji zakończono przed zapisaniem domeny | Współistnienie z redirect wymaga sprawdzenia przed aktywacją; nie zatwierdzać domyślnych zmian DNS |
| DNS poczty 10.10 | Rekursywny odczyt: MX1/5/100 OVH, SPF mx.ovh.com, pełny DKIM Resend i oba właściwe CNAME | Ten odczyt nie zastępuje wcześniejszego pełnego autorytatywnego porównania 12/12 |
| DMARC | Resolver zwrócił NXDOMAIN dla root i powiadomienia | To odpowiedź rekursywna; nie autorytatywne NODATA. Nie dodano rekordów |
| Resend / wysyłka | Zachowano istniejący SMTP i osobne klucze według wcześniejszej dokumentacji | Bieżące dwie flagi tracking, nagłówki maila i produkcyjny SMTP E2E niezweryfikowane. Auth OFF w pierwszej publikacji |

Przygotowanie organizacji nie uruchomiło firmowej skrzynki i nie zastąpiło Gmaila. Hasło nowej skrzynki musi ustawić właściciel samodzielnie; nie będzie podawane w czacie. Nie odczytywano korespondencji, haseł ani Bitwarden. Nie zmieniono forwardingów, rekordów i ustawień Supabase.

## Koszt i konkretna rekomendacja

W tym etapie **0 nowych zamówień i 0 aktywowanych płatnych dodatków**. Do firmowej poczty można wykorzystać posiadaną licencję Zimbra Starter; zakup Workspace nie został uznany za konieczny. Przyszła kwota odnowienia wymaga kontroli przed odnowieniem/zmianą usługi. [Budżet](OPERATING_BUDGET_2026-10-10.md) nadal rozdziela pierwszy katalog — rekomendowane Workers Paid 5 USD/mies. — i przyszłe konta/portal — bazowo 40 USD/mies. poza Apibara, domeną, podatkami i przekroczeniami. Paid nie jest sztywnym limitem rachunku; nie aktywowano go w tym etapie.

Rekomendacja: wybrać posiadaną Zimbra do przyszłej obsługi kontaktu, bez kolejnego abonamentu. Przed zmianą trzeba ustalić bezpieczny tryb współistnienia z redirect, odczytać faktyczne rekordy i dopiero przygotować dokładny diff poczty oraz test odbioru. Obecny pakiet i dokumenty opisują nadal OVH → Gmail. Sam brak DPA konsumenckiego Gmaila nie został uznany za pełną ocenę prawną lub automatyczny zakaz tej usługi.

## Retencja do akceptacji

| Dane | Propozycja | Faktyczny mechanizm |
| --- | --- | --- |
| Zamknięte zapytania bez umowy | 12 miesięcy od zamknięcia; kwartalny przegląd | Ręczny, niewdrożony; otwarte sprawy i obowiązki umowne osobno |
| Własne rutynowe logi | 30 dni; wyjątek dla potrzeb konkretnego incydentu | Ręczny, niewdrożony; nie obejmuje automatycznie logów Cloudflare |
| Szyfrowane kopie | 30 dni zwykłe / 90 dni przed wdrożeniem | Miesięczny przegląd, zachować ostatnią sprawdzoną do zastąpienia |
| Lokalne ulubione/obserwacje | Do usunięcia przez użytkownika/przeglądarkę | Brak TTL; usunięcie ulubionego nie usuwa osobnej historii |
| Katalog i publiczna historia | Coroczny przegląd celu, praw źródła i wniosków | Brak czasowego automatycznego cleanupu |

Pełna procedura, stan dostawców i ograniczenia: [DATA_RETENTION_REVIEW.md](DATA_RETENTION_REVIEW.md). Nie wykonano kasowania ani zmiany retencji.

## Testy i dowody

- Repozytorium **905/905 PASS**; pakiet partnera **14/14 PASS**. Trzy nowe regresje: źródłowa historia vs obserwacje i kwota warunkowa, rzeczywiste obowiązkowe pola kontaktu oraz zgodność dat/zakresu kopii dokumentów.
- Pierwsze wykonanie suite w sandboxie Windows miało EPERM przy atomowej zmianie nazwy własnych plików testowych. Powtórzono ten sam pełny suite poza sandboxem: 905 PASS. Nie zmniejszano pokrycia ani nie obchodzono guardów aplikacji.
- Oba generatory --check, walidatory konfiguracji, syntax 167 JS +5 inline i git diff --check PASS. Dry-run rzeczywistego profilu publication PASS: właściwa odseparowana D1, stored/catalog, Auth/portal/pliki OFF. Starsze walidatory mtbid/preflight nie są dowodem poprawności publicznego wdrożenia.
- HTTP **5/5 PASS**: prywatność, warunki, kontakt, O nas, publiczna konfiguracja kontaktu. Nowa data i wersja do przeglądu widoczne; nie tylko HTTP200.
- Rzeczywista przeglądarka: desktop 1480 px i mobile 390 px; oba dokumenty po 9 sekcji, brak overflow poziomego, poprawne linki warunki → prywatność → kontakt, działające mobilne menu. Puste obowiązkowe pola kontaktu zablokowały przygotowanie szkicu.
- Nie powtarzano całego zakończonego QA katalogu, kont i panelu, ponieważ zmiany dotyczyły dokumentów. Zachowano wcześniejsze dowody w PUBLICATION_COMPLETION_QA_2026-10-10.md.
- Bieżące metadane: preflight nadal 0a876baa, zero publicznych domen; observability=null/logpush=false/0 tail consumers, Cron pusty. Account Logpush i subskrypcja: 403, nieweryfikowane. Nie pobierano treści logów.

Dowody poza Git: C:/Users/nowic/Documents/Codex/REXBID_MAIL_DOCUMENTS_20261010 — metadata-dns.json, http-qa.json, syntax.json, tests-unsandboxed.log, build oraz privacy-desktop.png /privacy-mobile.png /terms-mobile.png. Nie zawierają kopii korespondencji lub wartości sekretów. Dokładne zasoby i migracja publikacji: [FINAL_PUBLICATION_APPROVAL.md](FINAL_PUBLICATION_APPROVAL.md) oraz [runbook](PRODUCTION_CUTOVER_RUNBOOK.md).

## Zakres publikacji i rollback — bez wykonania

Jedyny target: rexbid-production-preflight i jego D1 c8a30088-70af-43a6-9a7f-c4018279d37d. Gotowa baza ma 1817 ofert, 3253 obserwacje, 19044 wydarzenia, 1638 stanów historii i 0 danych prywatnych. Nie uruchomiono nowego transferu. Backup i sprawdzone odtworzenie z poprzedniego etapu pozostają aktualne, ponieważ baza nie zmieniła się w tym etapie.

Pierwsza publikacja: katalog, karty, galerie, historia aukcji i osobne obserwacje, V4, lokalne ulubione, kontakt. Auth/portal/R2/Cron/Sync/fallback OFF. Apex rexbid.pl; www308 z zachowaniem ścieżki/query; docelowe NS blair/titan. Usunąć tylko parkingowe A apex/www i nieużywany FTP. Dotychczasowe rekordy poczty OVH/Resend pozostają bez zmian, chyba że właściciel zaakceptuje osobny dokładny plan poczty.

Przed przyszłym przełączeniem: ponowny autorytatywny DS, kontrola pełnej strefy, backupu, wersji, kwoty planu i TLS. Istniejące 12/12 i pięć autorytatywnych DS=0 pozostają datowanymi dowodami; timeout a-dns nie jest DS=0. DNSSEC Cloudflare dopiero po stabilizacji. Rollback: zgodny build nowego Workera/wycofanie jego routingu, snapshot strefy; powrót NS wymaga zgodnego DS/TTL. Nie używać mtbid/503 release ani przywracać dumpu w miejscu. Przy uszkodzeniu danych: freeze, kopia incydentu, odtworzenie do osobnej D1, audyt i osobna zgoda na rebind.

## Pozostałe czynności właściciela

1. Wybrać kanał kontaktu: rekomendowana posiadana Zimbra Starter zamiast docelowej obsługi przez konsumencki Gmail. To decyzja o przygotowaniu konkretnej zmiany poczty, nie zgoda na domyślny kreator DNS. Obecny odbiór pozostaje działający.
2. Po udokumentowaniu wybranego kanału: jedna końcowa akceptacja tekstów, retencji oraz dokładnej publikacji/delegacji z FINAL_PUBLICATION_APPROVAL.md. Dotychczasowa zgoda finansowa nie zatwierdza DNS i produkcji.

Nie wymagać ponownego dostarczania nazwy/adresu firmy, wariantu A, stawek partnera, eksportu strefy ani sekretów w czacie. Dane do pełnej wyceny partnera pozostają odrębnym, znanym pakietem oczekiwanym12–14.10; nie blokują wyraźnie częściowego kalkulatora. Apibara 0 nowych; licznik 1774 i historyczny STOP 56 zachowane. Bez pusha.

## Zastąpienie kolidującego przekierowania — do zgody właściciela

- Obecny stan odtworzenia: usługa redirect dla rexbid.pl, pojedyncze przekierowanie kontakt@rexbid.pl do rexbid.kontakt@gmail.com, brak dodatkowej skrzynki w tej usłudze (0/0). Nie jest to kopia treści wiadomości. Treści pozostają w Gmailu, bez automatycznego importu do Zimbra.
- Przed operacją: właściciel dostępny do zatwierdzenia formularza konta; ponownie potwierdzić 0 kont Zimbra i brak zadania. Nie usuwać przekierowania podczas nieobecności właściciela.
- Zakres zgody: usunąć tylko powyższe przekierowanie, zwolnić nazwę i utworzyć kontakt@rexbid.pl w istniejącym Starter (bez zakupu). Finalny formularz z hasłem zatwierdza właściciel. Brak zgody na DNS, delegację, zmiany haseł istniejących usług lub usunięcie wiadomości.
- Ryzyko: po zwolnieniu adresu, a przed jego działającym przypisaniem do Zimbra, odbiór może być przerwany; możliwe odrzucenie wiadomości. Nie obiecywać migracji bez przerwy ani automatycznego ponowienia przez nadawców.
- Po zapisie: odczytać konto i przypisanie licencji; następnie logowanie właściciela i test odbioru/wysyłki między własnymi adresami po uzgodnieniu testu. Brak DNS zmian w tej operacji. Diagnostyka DKIM/SPF/Zimbra i ewentualny dokładny diff do osobnej zgody; brak obecnego DKIM nie oznacza przyczyny błędu tworzenia konta.
- Wycofanie przed skutecznym utworzeniem konta: odtworzyć dokładnie pojedynczą regułę kontakt@rexbid.pl → rexbid.kontakt@gmail.com, potwierdzić readback i test odbioru. Gdy nazwa jest zablokowana zadaniem lub konto już istnieje, nie usuwać skrzynki/wiadomości w ciemno; zabezpieczyć stan i wyjaśnić z OVH. Przywrócenie odbioru nie jest gwarantowane natychmiast.
- Nowy koszt aktywacji: brak dodatkowego zamówienia, wykorzystanie posiadanej licencji zawartej w cenie. Nie zmieniać odnowienia ani planu. Przekierowanie do Gmaila po uruchomieniu Zimbra wymaga osobnego ustalenia; nie zakładać, że pozostanie automatycznie.

Dokumentacja: https://docs.ovhcloud.com/en/guides/web-cloud/email-and-collaborative-solutions/common-email-features/feature-redirections oraz https://docs.ovhcloud.com/en/guides/web-cloud/email-and-collaborative-solutions/zimbra/getting-started-zimbra . Faktyczny konflikt potwierdza odpowiedź panelu konta, a istniejącą regułę odczyt uwierzytelnionej tabeli; nie jest to wniosek oparty tylko na dokumentacji.
## Zimbra — wykonane zastąpienie i dalsze kontrole, 10.10.2026

Zgoda właściciela obejmowała zastąpienie jednej reguły; wykonano je bez DNS zmian. Pierwotna reguła była poprawnym przekierowaniem, nie błędem konfiguracji projektu. Nie pozwalała sama logować się do skrzynki Zimbra ani odpowiadać z niej. Wykorzystano posiadaną licencję, bez nowego abonamentu lub zmiany odnowienia. Screenshot `zimbra-contact-active.png` poza Git potwierdza konto; `ovh-contact-forward-removed.png` dokumentuje 0 reguł.

Aktualne treści opublikowane na stagingu nadal opisują wcześniejszą trasę OVH → Gmail. Po potwierdzeniu działania nowej skrzynki trzeba zaktualizować opis bieżącego odbioru do Zimbra i osobno pozostawioną historyczną korespondencję w Gmailu. Nie twierdzić, że archiwum Gmaila usunięto lub przeniesiono. Nie odtwarzać automatycznie starej reguły, gdy konto już istnieje. Odtworzenie usuniętej reguły z tą samą nazwą nie jest zgodnym rollbackiem przy aktywnym koncie; w razie problemów odbioru najpierw diagnostyka istniejącej skrzynki i OVH, bez kasowania danych.

### Dokładne uzupełnienie DNS do osobnej zgody

Źródło wartości: uwierzytelniony panel OVH → Zimbra → rexbid.pl → Raporty diagnostyczne. Tych zmian NIE wykonano. Nowe rekordy należy sprawdzić pod kątem konfliktów i dodać zarówno do obecnej autorytatywnej OVH, jak i przyszłej strefy Cloudflare. CNAME w Cloudflare DNS only. Nie zastępować DKIM Resend ani SPF/MX.

| Typ | Nazwa w strefie rexbid.pl | Wartość |
| --- | --- | --- |
| CNAME | ovhmo-selector-1._domainkey | ovhmo-selector-1._domainkey.4988509.qm.dkim.mail.ovh.net. |
| CNAME | ovhmo-selector-2._domainkey | ovhmo-selector-2._domainkey.4988510.qm.dkim.mail.ovh.net. |
| SRV (autodiscover) | _autodiscover._tcp | 0 0 443 zimbra1.mail.ovh.net. |

DKIM dotyczy uwierzytelniania wiadomości wychodzących z Zimbra. Brak SRV wpływa na automatyczne ustawienie aplikacji pocztowych; nie jest przyczyną zajętej nazwy lub błędnego logowania. MX i SPF mają status Konfiguracja OK w OVH, ale to kontrola konfiguracji, nie rzeczywisty test dostarczenia. Brak zgody na zmiany DNS w tej operacji pozostaje respektowany; nie aktywowano przycisku automatycznej konfiguracji. Resend dla powiadomienia.rexbid.pl pozostaje oddzielny i niezmieniony.