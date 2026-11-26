# REXBID — podmiot, publiczne treści i pakiet publikacji, 8.10.2026

**STAGING VERIFIED — OWNER / LEGAL REVIEW REQUIRED — NOT PUBLICLY DEPLOYED.** Kontynuacja checkpointu 49230a993de88b29d30024cfeef2a50170453f6c bez resetu. Końcowy staging: **0dd0ea83-6777-4df8-a30b-7ba74a0664f3**, [Home](https://rexbid-auth-test.tedn828.workers.dev/). Lokalne commity są dozwolone; push nie jest dozwolony.

Kampania publication-20261008 pozostaje **STOP: 56/1000 prób, 25 Copart / 31 IAAI, retry = 0**. W tym etapie wykonano **0 nowych wywołań Apibara**.

## 1. Podmiot i źródła

Dokładna nazwa **REX AUTO CARGOLOOP L.L.C** pochodzi z bezpośredniego potwierdzenia właściciela. Użyto jej w kontakcie, O nas, ośmiu publicznych stopkach i pięciu istniejących szkicach docs/legal. Kontakt pozostaje **kontakt@rexbid.pl**, z obsługą OVH i przekierowaniem do Gmail projektu. Nie zmieniono poczty, roli administratora technicznego, domeny, kont wspólnika ani MFA.

Przejrzano lokalny szablon REX_AUTO_CARGOLOOP_Invoice_Template_NEW_05.10.2026.docx, wyłącznie nagłówek przedsiębiorstwa w Invoice new.pdf oraz wcześniejszą stronę CargoLoop i jej README z 4.10. Materiały zawierają spójny nagłówek kontaktowy firmy. Nie weryfikują formalnego adresu rejestrowego, Entity ID, EIN, statusu rejestru ani odpowiedzialności umownej. Link rejestrowy wcześniejszej strony jest placeholderem. Nie wydobywano ani nie publikowano danych klientów z faktur.

Automatyczna kontrola zgody odrzuciła próbę publikacji adresu z nagłówków faktur oraz szerokiego nadpisania dokumentów prawnych. Samo potwierdzenie nazwy nie upoważniało do dodatkowych danych ani takiej zmiany. Zastosowano węższą, dozwoloną poprawkę: **potwierdzona nazwa i celowane uzupełnienia istniejących szkiców**. Nie dodano adresów, numeracji ani warunków współpracy. Nie przedstawiono adresu kontaktowego z faktury jako zweryfikowanej siedziby.

Do przeglądu na stagingu: [O nas](https://rexbid-auth-test.tedn828.workers.dev/o-nas.html), [kontakt](https://rexbid-auth-test.tedn828.workers.dev/kontakt.html), [warunki](https://rexbid-auth-test.tedn828.workers.dev/warunki.html), [prywatność](https://rexbid-auth-test.tedn828.workers.dev/prywatnosc.html). Strony prawne są oznaczone **DRAFT — REQUIRES OWNER/LEGAL REVIEW** i noindex. Wymagają formalnej identyfikacji administratora, właściwego prawa oraz podstaw i retencji przetwarzania. Nie są finalnym regulaminem sprzedaży lub importu.

Formularz przygotowuje treść lokalnie. Skopiowanie, pobranie lub otwarcie mailto nie oznacza wysyłki ani licytacji. Rzeczywista kontrola przygotowania treści nie wysłała e-maila.

## 2. Poprawki i celowane QA

| Obszar | Faktycznie wykonana kontrola |
| --- | --- |
| Nazwa i stopka | Spójna nazwa i odnośniki w Home, katalogu, karcie auta, ulubionych i stronach informacyjnych. Rzeczywiste przejścia: stopka → O nas → warunki → kontakt. |
| Częściowy katalog | Techniczne D1 catalog: partial zastąpiono komunikatem **Katalog częściowy**. Opis wyjaśnia niepełny zbiór i datę obserwacji. Zachowano ograniczenie do stagingu i istniejącą polską informację o zakresie w katalogu. |
| Menu publikacji | Znaleziono błąd: po usunięciu Konto z HTML mobile-nav przywracał link. HTMLRewriter oznacza fazę catalog, a JS respektuje ją. Lokalny test rzeczywistego HTML i skryptu w JSDOM potwierdza, że link nie wraca. Nie jest to test publicznego wdrożenia. |
| Konto na stagingu | Nadal dostępne. Auth config: HTTP 200, enabled = true; anonimowe me: HTTP 401, private, no-store. Nie wykonywano nowych loginów ani resetu MFA. |
| Ulubione | Nowe strony prawne początkowo nie ładowały storage i pokazywały 0. Dodano istniejący storage przed mobile-nav. Rzeczywista przeglądarka mobile po deployu pokazuje **Ulubione 1**; Escape zamyka menu. Nie zmieniono zapisu ulubionych. |
| Aliasy Assets | HTTP wykazał, że kontakt, o-nas, guide i legal bez rozszerzenia omijały staging wrapper po przekierowaniu z .html. Dodano dokładne aliasy do staging run_worker_first i regresję. Po redeployu wszystkie sprawdzone HTML mają X-Robots-Tag noindex oraz private, no-store. |
| Desktop i mobile | Rzeczywista przeglądarka: **980 × 900** oraz **390 × 844**. Firma, szkice, kontakt, menu i fokus, Home/katalog, karty obu platform i subtotal V4 są czytelne; bez poziomego przewijania. Przy szerokości 980 menu jest zwinięte zgodnie z breakpointem. |
| Dokładny LOT | Wyszukanie **57660876** dało jeden właściwy wynik: Tesla Model 3 / Copart. Przejście do karty i return_to zachowało filtr. |
| Karty | Copart **57660876**: 12 referencji galerii, cena **5000 USD**, dokument/Geico i działający V4. IAAI **44593083**: 17 referencji, bid **25 USD**, buy **2000 USD**, SALVAGE/Progressive. Jedna niedostępna miniatura IAAI ma istniejący czytelny fallback; nie pobierano nowej od providera. |
| Calculator V4 | Stawki i silnik bez zmian. Tesla: land **330** + BEV **150** + sea **575/650** → transport **1055/1130 USD**. Purchase **5000 USD** → znany subtotal **6055/6130 USD**. Przełączenie „standard 4” → „ostrożny 3” zmienia sumę. Opłaty, podatki, obsługa i transport w Polsce wymagają potwierdzenia; nie są zerem, a subtotal nie jest pełną ceną pod dom. |
| Ograniczenie pomiaru subtotal | browser.json zachowuje **subtotal = false**. Dosłowne porównanie tekstu nie uwzględniało NBSP; receipt zawiera measurementNote. Osobna calculatorVariantObservation potwierdza **6055/6130 USD** w rzeczywistym UI. Nie zmieniono false na PASS. |
| JavaScript | Przechwycone logi tej karty przeglądarki: **0 wpisów/błędów i 0 wyjątków JS**. To ograniczony dowód, nie gwarancja wszystkich ścieżek. |

Kontrola przeglądarkowa tego sprintu była celowana. Nie powtarzano wszystkich wcześniejszych scenariuszy QA ani właścicielskiego loginu, MFA, portalu i recovery. Wcześniejszy ręczny E2E recovery dotyczy testowego klienta, nie hasła właściciela. Nowy dwukontowy unread E2E nadal ma status **NOT VERIFIED** z powodu braku dwóch sesji. Nie blokuje fazy katalogu bez portalu.

## 3. Testy i wdrożenie

| Kontrola | Wynik |
| --- | --- |
| Końcowy pełny node --test | **819/819 PASS**; fail, skipped i cancelled = 0. Log: REXBID_COMPANY_SUITE_FINAL_20261008.log. |
| Nowe testy | 7 regresji dotyczących firmy, linków i szkiców, menu i izolacji stagingu, polskiego komunikatu, hashów i aliasów. Test publicznego HTML rozszerzono o uruchomienie prawdziwego mobile-nav i nowe strony. |
| Generatory --check | Oba PASS; **610 lokalizacji / 24 frachty**; version rex-partner-v4-f0a67460b203286f bez zmiany |
| Konfiguracja i składnia | 3 walidatory PASS; **152 JS + 12 inline PASS**. Kontrole powtórzone po końcowym deployu. |
| Build | Dry-run stagingu i publikacji PASS; diff-check PASS |
| Końcowy staging | Deploy PASS, Version **0dd0ea83-6777-4df8-a30b-7ba74a0664f3** |
| Celowane HTTP | **12/12 PASS**; nowe treści i stopki, health 200, ready 200, cars 200, filters 200, me 401, auth-config 200 |
| Zakres HTTP | HTML: noindex oraz private, no-store po poprawce aliasów. Cars: D1, catalog_complete = false; provider fallback disabled. |

Staging sprzed sprintu, **e4e54eaa-3438-4619-a4c4-aa6648262afb**, jest znanym punktem rollbacku tego samego Workera. Pośrednie wersje e47f50e9/e0603076 nie są wynikiem końcowym.

Odczyty D1 przed, po i po końcowym deployu były read-only i potwierdziły identyczne liczby:

| Tabele | Wiersze przed i po |
| --- | ---: |
| users / favorites / orders / messages / files | 2 / 2 / 2 / 4 / 3 |
| sources / listings / snapshots | 1638 / 1638 / 1682 |
| changes / rows_written | 0 / 0 |

Końcowy receipt REXBID_COMPANY_D1_FINAL_20261008.json potwierdza **changed_db = false**. Nie zastosowano migracji i nie zmieniono danych.

Dowody poza Git, w C:/Users/nowic/Documents/Codex:

- REXBID_COMPANY_SUITE_20261008.log, końcowy REXBID_COMPANY_SUITE_FINAL_20261008.log i REXBID_COMPANY_HTTP_20261008.json;
- REXBID_COMPANY_D1_BEFORE_20261008.json, REXBID_COMPANY_D1_AFTER_20261008.json i REXBID_COMPANY_D1_FINAL_20261008.json;
- REXBID_COMPANY_QA_20261008/browser.json i screeny: about-desktop.png, terms-desktop.png, contact-desktop.png, privacy-mobile.png, home-mobile.png, calculator-mobile.png oraz iaai-desktop.png.

Część pierwszych screenów kontaktu i mobile pochodzi z pośredniej wersji tych samych treści. Końcowe screeny O nas, warunków, kalkulatora i IAAI oraz HTTP odpowiadają końcowej wersji. Źródłowe screeny nie zawierają prywatnych danych kont.

## 4. DNS — bieżący wynik

Aktualna oficjalna delegacja IANA .pl obejmuje **a, b, d, f, h i j**. Odczyt direct DS z **8.10, 11:41:40–48 UTC / 13:41 CEST**:

- **b, d, f, h i j:** UDP i TCP, AA = 1, NOERROR/NODATA, DS = 0, TC = false; wspólne SOA .pl o serialu 1791441068;
- **a przez IPv4:** timeout także po ograniczonych powtórkach;
- **wszystkie IPv6:** ENETUNREACH / brak trasy.

Timeout i brak połączenia nie oznaczają DS = 0. Google/Cloudflare DoH oraz NASK RDAP z delegationSigned = false wspierają odpowiedzi, ale ich nie zastępują.

Pełne **12/12 rekordów** porównano ponownie **11:44:19–26 UTC / 13:44 CEST** z oboma OVH i Cloudflare blair/titan. Pełny DKIM, priorytety MX, SPF i CNAME są zgodne. Ustawienie DNS only dla CNAME potwierdza dostarczony eksport; odpowiedź DNS nie mierzy ustawienia proxy. Delegacja parent nadal wskazuje OVH.

Bramka ponownego eksportu jest zamknięta. Kolejny plik nie jest potrzebny bez wykrytej zmiany. [Pełna macierz i ograniczenia](DNS_READINESS_REFRESH_2026-10-08.md).

Pięć zgodnych autorytatywnych odpowiedzi, wcześniejszy DS = 0 i zakończony okres oczekiwania do **7.10, godz. 14:49 CEST** wspierają gotowość DNS. **Pokrycie a/IPv6: NOT VERIFIED**; nie jest to dowód istniejącego DS. W faktycznym oknie ponowić autorytatywne odczyty dla aktualnych NS IANA. Sprzeczność lub DS ≠ 0 oznacza **STOP**. Nie wykonano przełączenia.

## 5. Jeden pakiet publikacji i rollback

Jedyny target: **rexbid-production-preflight / D1 c8a30088-70af-43a6-9a7f-c4018279d37d**. Kod jest przygotowany. Prywatny preflight pozostaje na wersji 0a876baa, bez publicznych tras.

Zakres: zapisane listy, szczegóły i filtry, galerie przez URL, historia obserwacji, V4, lokalne ulubione, kontakt i treści firmy. **Auth, portal, pliki, Cron, Sync i automatyczny provider fallback są OFF.** mtbid/rexbid-db pozostają bez zmian. Nie przenoszono prywatnych danych stagingu.

Obie bazy zachowują **840 Copart + 798 IAAI = 1638 ofert**, **1682 snapshots** i **1363 oferty z mediami**. Wynik **1098 active obserwowanych 8.10** jest datowanym odczytem, nie gwarancją ciągłej aktualności. Pozostałe **540** ma starsze obserwacje. Scope jest partial; starsze kwoty nie otrzymują nowej daty.

Po jawnej akceptacji:

1. Świeży readback, backup i konfiguracja.
2. Prywatny build tego samego nowego Workera.
3. Aktualna macierz parent DS i zgodność rekordów poczty.
4. Zmiana delegacji OVH na **blair.ns.cloudflare.com / titan.ns.cloudflare.com**.
5. Potwierdzenie Cloudflare active.
6. Usunięcie wyłącznie parkingowych A apex/www **213.186.33.5** i nieużywanego FTP; dwa Custom Domains na nowym Workerze.
7. HTTPS/TLS, smoke i obserwacja.
8. Osobno: Cloudflare DNSSEC i nowy DS w OVH.

Zachować 9 pozostałych rekordów: 3 MX, SPF, 2 TXT i 3 Resend. Wrapper realizuje HTTPS www → apex **308 dla GET/HEAD**, zachowuje path/query, stosuje no-store i nie przekazuje cookies. Pozostałe metody zwracają 421. HTTP → HTTPS jest osobnym ustawieniem Cloudflare. Nie dodawać CNAME www ani drugiego przekierowania 308. [Dokładna kolejność i rollback](PRODUCTION_CUTOVER_RUNBOOK.md).

Rollback wykorzystuje zgodny build katalogu **tego samego nowego Workera** albo wycofanie jego Custom Domains. Prywatna wersja 0a876baa nie jest publicznym katalogiem. Nie używać wersji mtbid jako rollbacku.

Snapshot DNS/TLS można odtworzyć po zgodzie; powrót do NS OVH wymaga zgodnej kontroli DS i TTL. Dane odtwarzać wyłącznie do osobnej D1, z kontrolą schematu, liczników, FK i uzgodnionym rebindem. Bez DROP, odtworzenia w miejscu i utraty nowych danych klientów. Ten sprint nie zmienia schematu; rollback jego UI nie wymaga migracji.

## 6. Do zebrania od właściciela

1. **Jeden pakiet firmowy i prawny:** formalny adres, właściwe dane rejestrowe i jurysdykcja, administrator, retencja korespondencji i logów oraz akceptacja odpowiedzialności i treści. Nazwa jest potwierdzona; nie pytamy o nią ponownie. Nie publikować numerów podatkowych ani warunków sprzedaży bez potwierdzenia ich potrzeby i brzmienia.
2. **Osobna zgoda na konkretny zakres DNS/deploy z sekcji 5**, po akceptacji treści. Zgoda na staging jej nie udziela. Nie potrzeba kolejnego eksportu, klucza Apibara ani testów poczty/MFA dla fazy catalog.
3. **Mały pakiet partnera do pełniejszego kosztu:** port docelowy i kraj odprawy, zakres frachtu, cena i zakres portu, brokera i dokumentów, waluta, jednostka, netto/brutto i data obowiązywania. Braki nie blokują jawnie niepełnego szacunku. Nie prosić ponownie o 610 stawek, terminale, mnożniki ani BEV 150 USD.

Nowe zasoby i płatności: **0**. Publiczny deploy, zmiany DNS, migracje i push: **0**. Lokalny checkpoint zawiera tylko kod, publiczne treści i dokumentację. Sekrety, kopie SQL, prywatne receipts i źródłowa faktura pozostają poza Git.

## 7. Zmienione pliki sprintu

Lista obejmuje **29 plików z git diff --name-only i 4 nowe pliki, łącznie 33**. Nowe pliki: docs/COMPANY_PUBLICATION_REVIEW_2026-10-08.md, public/prywatnosc.html, public/warunki.html oraz tests/publication-company.test.cjs.

| Grupa | Liczba | Pliki |
| --- | ---: | --- |
| Publiczne UI i wspólne zasoby | 16 | public/administracja.html, car.html, index.html, jak-to-dziala.html, kontakt.html, konto.html, logowanie.html, o-nas.html, panel.html, rejestracja.html, reset-hasla.html, ulubione.html, prywatnosc.html, warunki.html, rexbid-brand.css, rexbid-mobile-nav.js |
| Worker i konfiguracja | 3 | worker.publication.js, worker.staging.js, wrangler.staging.jsonc |
| Testy | 2 | tests/production-publication.test.cjs, tests/publication-company.test.cjs |
| Dokumentacja | 12 | PROJECT_HANDOFF.md, ROADMAP.md, docs/BACKUP_RECOVERY.md, DNS_READINESS_REFRESH_2026-10-08.md, LAUNCH_READINESS.md, PRODUCTION_CUTOVER_RUNBOOK.md, COMPANY_PUBLICATION_REVIEW_2026-10-08.md oraz docs/legal/AUCTION_DATA_DISCLAIMER_DRAFT.md, CALCULATOR_DISCLAIMER_DRAFT.md, COOKIES_ANALYTICS_DRAFT.md, PRIVACY_POLICY_DRAFT.md, TERMS_OF_SERVICE_DRAFT.md |
