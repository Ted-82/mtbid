# REXBID — profesjonalna ścieżka klienta i kandydat publikacji

**2026-10-07. STAGING CODE / AUTOMATED / PUBLIC DESKTOP / PUBLIC MOBILE VERIFIED. PREPARED FOR OWNER REVIEW — NOT PUBLISHED.** Kontynuacja lokalnego checkpointu `364b1d7`; bez resetu, pusha, zmian DNS lub obecnej produkcji. Końcowy staging: **4a6bfcf9-4ecb-43fb-8943-0b246d7bc484**.

## Działające widoki

- [Home](https://rexbid-auth-test.tedn828.workers.dev/)
- [Katalog zapisanych ofert](https://rexbid-auth-test.tedn828.workers.dev/?catalog=1#results)
- [Copart LOT 58307896](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=58307896&platform=copart)
- [IAAI LOT 44140937](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=44140937&platform=iaai)
- [Kontakt](https://rexbid-auth-test.tedn828.workers.dev/kontakt.html), [panel klienta](https://rexbid-auth-test.tedn828.workers.dev/panel), [administracja](https://rexbid-auth-test.tedn828.workers.dev/administracja).

## Widoczne zmiany i własne QA

| Obszar | Wykonano i sprawdzono | Ograniczenie |
| --- | --- | --- |
| Home | Spójna granatowo-czerwona nawigacja, wyszukiwarka i cztery sekcje. Puste stany prowadzą do zapisanych ofert. | Obserwacje są stare; żadnej sekcji nie wypełniano sztucznie jako bieżącej. |
| Katalog | Wszystkie znane oferty domyślnie, dokładny VIN/LOT, platforma, chipy filtrów, usuwanie i reset, mobilne rozwijanie, poprawna odmiana liczby ofert, 20 → 40 rekordów bez duplikacji. Powrót z auta zachowuje filtry i URL. | Znane metadane, partial; brak deklaracji pełnego rynku. |
| Karty | Copart i IAAI renderują D1; odpowiednio 13 i 22 zdjęcia, lightbox/next/Escape oraz dostępne wideo IAAI (readyState 4, bez błędu). Dokładny TITLE i typ sprzedającego, zapisane ceny i brak fałszywego countdownu. | Nie potwierdzano obecnego stanu tych aukcji u providera. Historyczny timestamp nie jest aktualnym terminem. |
| Historia | Brak confirmed events jest pustym stanem, nie fikcyjną sprzedażą. Observed snapshots pozostają odrębne. | Zapisana próbka nie stanowi pełnej historii VIN. |
| Calculator V4 | Czytelne koszty uwzględnione / szacowane / brakujące; potwierdzona klasa, preferowany terminal, warianty 4/3; wynik częściowy nie jest ceną pod dom. | Podatki, fees, zakres frachtu i obsługa wymagają właściwych danych/konfiguracji. |
| Kontakt | Dane auta i kontekst ceny przechodzą do formularza; widoczny kontakt@rexbid.pl. Przygotowanie treści jest lokalne i nie wysyła maila. | Nie wykonano wysyłki ani zlecenia importu. |
| Ulubione gościa | Dodanie → przejście → reload → usunięcie własnej pozycji QA. Naprawiona regresja starej ceny: „Ostatnia zapisana oferta”, źródłowa data obserwacji. Legacy bez metadanych nie deklaruje aktualności. | Nie powtarzano zalogowanego cloud merge; jego regresje są automatyczne. |
| Konta | Aktualna stylistyka i mobilny układ; pusty submit kieruje fokus do e-maila, aria-invalid i powiązany komunikat. Panel anonimowy kończy bootstrap i prosi o login; API odmawia 401/private no-store. | Bez credentiali nie wykonano nowego loginu ani owner MFA. Nie wysłano recovery/confirmation. |

Desktop 1024×768 i mobile 390×844; brak poziomego overflow (mobile document 375 px przy viewport 390 px). Konsola sprawdzanych stron bez error/warn. Pierwszy preview `544d7d7c-3582-40ac-b20b-756c4fc9706d` posłużył do wykrycia złej etykiety zapisanej ceny ulubionych, pluralizacji i starej nazwy CTA kontaktu. Poprawki przeszły regresje i ponowny staging deploy; nie maskowano ich pustym catch lub spinnerem.

Końcowe screeny poza Git: `C:/Users/nowic/Documents/Codex/REXBID_QA_PROFESSIONAL_20261007/`: `home-desktop-final.jpg`, `home-mobile-final.jpg`, `catalog-desktop-final.jpg`, `catalog-mobile-final.jpg`, `calculator-mobile-final.jpg`, `calculator-mobile-result-final.jpg`, `favorites-desktop-final.jpg`, `login-mobile-final.jpg`, `panel-mobile-guest-final.jpg`. Pozostałe screeny bez suffixu final dokumentują wcześniejsze QA tego samego sprintu na preview, nie nową produkcję. Prawdziwe obrazy aukcyjne są renderowane z URL; nie utworzono permanentnego archiwum binarnych zdjęć.

Punkty odniesienia organizacji informacji: [BidCars](https://bid.cars/pl/) (search VIN/LOT, platforma/status/filtry) i [DreamBid](https://dreambid.pl/en) (ścieżka importu i kontakt). Nie kopiowano marki, UI, opinii, liczników klientów ani ich modelu licytacji. Cennika nie zastępowano danymi tych serwisów.

## Portal — trwałe nieprzeczytane i bezpieczeństwo

Addytywna stagingowa `0007_portal_message_reads.sql`, po backupie. Per-message receipt ma osobny audience `client` / `team`, wybierany przez serwer. Licznik dotyczy wiadomości przychodzących, a odczyt wyłącznie rzeczywiście załadowanych wiadomości własnej realizacji. Pagination, identyczny timestamp, nowa wiadomość podczas odczytu, reload, role spoofing i cudze realizacje mają regresje. Brak e-mailowych powiadomień.

Wybór klienta opiera się na rzeczywistym profilu; UUID pomocniczy. Nadal wymagana jest tożsamość VIN albo LOT+platforma, z uczciwymi etykietami i komunikatem. Wykonane etapy wynikają wyłącznie z potwierdzonych zdarzeń; wcześniejsze nie są automatycznie ukończone. Dokumenty klientowskie/wewnętrzne i autorzy Klient/REXBID pozostają rozdzieleni. Nie zmieniono historycznych nadawców ani MFA.

- **Własne automatyczne:** server isolation, cross-client files/messages, owner AAL2, unread receipts i rzeczywisty HTML/JS panelu PASS.
- **Własne rzeczywiste:** anonimowy portal 401/private no-store i mobilny login prompt PASS; odczyt schematu/indeksu 0007 oraz zachowane dane stagingu PASS.
- **Wcześniej potwierdzone ręcznie przez właściciela:** osobny klient, poprawni nadawcy, aktualizacja etapu, internal file ukryty, client file pobrany/otwarty. Stagingowy recovery E2E dotyczył testowego klienta: nowe hasło działa, stare odrzucone; nie zmiany hasła właściciela.
- **NOT VERIFIED w tym etapie:** nowy unread E2E w dwóch zalogowanych sesjach, nowe logowanie/challenge MFA i produkcyjne mailowe E2E. Nie utożsamiać testów syntetycznych z tymi działaniami.

## D1, źródło pierwszej publikacji i brak wywołań providera

Odseparowane `rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d` otrzymało wyłącznie publiczne sources/listings/snapshots/events, ze statycznej whitelisty i zapisu stagingu. SQL bind, offline rehearsal, checkpoint każdego batcha; dokładna tożsamość `(platform, LOT)`, bez cross-platform VIN dedupe. Addytywne 0004 (z media columns) i 0007 wykonano tylko tu; nie stosowano 0005 ponownie.

| Stan po operacji | Staging | Izolowany preflight |
| --- | ---: | ---: |
| Copart listings / sources | 352 / 352 | 352 / 352 |
| IAAI listings / sources | 227 / 227 | 227 / 227 |
| Razem listings / sources / snapshots | 579 / 579 / 584 | 579 / 579 / 584 |
| Auction events / vehicle entities / duplikaty platform+LOT / FK errors | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Listings z URL mediów / HTTPS references | 281 / 8063 | 281 / 8063 |
| Users / favorites / orders / messages / files | 2 / 2 / 2 / 4 / 3 | 0 / 0 / 0 / 0 / 0 |
| Runs / page commits / request reservations | 32 / 45 / 291 | 0 / 0 / 0 |

Scope importu: 2 partial, cursor NULL, last_success/complete NULL; nie udaje ukończonego discovery. Źródłowe daty obserwacji **29 września → 5 października**, bez odświeżenia przy imporcie. Wszystkie starsze niż 24 h. 0 raw payloadów i binary images w modelu. Publiczny seed nie jest kopią prywatnego stagingu.

Public paths stagingu mają fallback `disabled`. Przyszły `worker.publication.js` exact apex + exact isolated target + mode stored ma to samo zachowanie, podczas gdy globalny stary production D1-primary pozostaje OFF. Missing daje 404, schema failure bezpieczne 503; nie pobiera automatycznie providera. API/UI pokazują partial i last-known. Dostęp do klucza Apibara potwierdzono **tylko nazwą secret w metadanych**, nie poprawnością wartości ani live fetch.

**Apibara requests = 0. Discovery/backfill = 0. Nowe maile = 0.** Provider reservations stagingu pozostały 291; runs i page commits również bez zmiany. Nie wykonano nowego produkcyjnego runtime.

## Cache i HTTP

Publiczny cache ma maks. 30 s, klucz obejmuje host, pełne query/platformę oraz oddzielny namespace bazy. Cookie/auth/range/private/Set-Cookie nie trafiają do cache. TTL nie przekracza granicy świeżości; cache nie podmienia source timestamps. Konta i portal pozostają private/no-store.

Własny HTTP smoke **16/16 PASS**: health/ready 200, cars/filters 200, dokładny VIN/LOT po 1 rekordzie, oba detail/history z D1, missing 404 bez providera, me/portal guest 401; robots blokuje staging. Powtórka katalogu cache HIT 81 ms; ciepłe filter 100 ms, Copart 103 ms, IAAI 119 ms, history 162 ms. Pierwsze health/ready/catalog miały 6–7 s całego fetch; nie diagnozowano ich jako samego czasu D1. To pojedyncze obserwacje sieciowe, nie benchmark ani SLA.

## Testy, kopie i checkpoint

`node --test`: **749/749 PASS**, bez fail/skipped; partner package osobno **14/14 PASS** (powtórka, nie suma z repo). Parity **125663/125663**, oba generatory --check, config validators, staging i publication dry-run, syntax **143 JS + 12 inline**, diff-check PASS. Rate set **rex-partner-v4-f0a67460b203286f**, 610 lokalizacji / 24 sea rates bez zmian.

Kopie przed migracją i po seedzie zaszyfrowano DPAPI/ACL poza Git; pełny local SQLite restore po operacji PASS/FK0. Nie wykonano remote restore w miejscu. Pięć pozycji Bitwarden same-computer/no-DPAPI PASS jest zgłoszeniem właściciela; drugie urządzenie niezweryfikowane. Pozostałe SMTP/DB/Apibara sekrety mają wyłącznie ręczne potwierdzenie zapisu. [Szczegóły backupu](BACKUP_RECOVERY.md).

Sanitizowane receipts poza Git: `REXBID_PROFESSIONAL_SMOKE_FINAL_20261007.json`, `REXBID_PROFESSIONAL_READONLY_AFTER_20261007.json`, `REXBID_PROFESSIONAL_AFTER_RESTORE_20261007.json`, `REXBID_PUBLIC_CATALOG_SEED_20261007.json`, suite i dry-run logs, Documents/Codex. Lokalny commit końcowy odczytać przez `git log -1`; SHA w raporcie końcowym, nie nadpisywać istniejącego checkpointu/cache. Prywatne backupy i sekrety nie należą do Git.

## Blokery i konkretna akceptacja

1. Właściciel musi zaakceptować pierwszy **katalog zapisanych, częściowych danych**, treści prawne i dokładny zakres DNS/deployu. Jeśli start ma obiecywać bieżące aukcje, potrzebne będą osobno zatwierdzone świeże dane; ten sprint nie dawał zgody na nowe requesty.
2. TLS, runtime apex/www i produkcyjny mail E2E możliwe dopiero po osobnym zatwierdzonym oknie. Parent DS pełny wcześniejszy PASS zachowany; nowe powtórzenie nie zakończyło się na obu serwerach — świeży odczyt przed delegacją obowiązkowy.
3. Produkcyjny owner subject/MFA i aktywacja Auth/portalu są odrębną fazą. Pliki OFF; brak globalnego billing capu R2. Nie importować kont, MFA ani realizacji stagingu.

Pierwszy mały formularz partnera: [port/kraj odprawy, zakres frachtu, cena i zakres port/broker/dokumenty](CALCULATOR_PARTNER_FORM.html). Braki nie blokują uczciwego kalkulatora częściowego, ale blokują twierdzenie o pełnej cenie pod dom.

[Jedyna kolejność publikacji i rollback](PRODUCTION_CUTOVER_RUNBOOK.md). Obecny `mtbid / rexbid-db` bez zmian, DNS/delegacja bez zmian, push 0. **READY FOR OWNER REVIEW OF LIMITED PUBLICATION SCOPE.**
