# REXBID — dokumenty i demonstracja, QA 8.10.2026

**DEMO READY FOR OWNER REVIEW — PUBLICATION NOT AUTHORIZED.**

Punkt wyjścia: **2dda72e056ba6d88602faf563cf4257a9f499161**. Zachowano wcześniejsze rezultaty, cache, dane i konfigurację. SHA końcowego lokalnego checkpointu jest w raporcie dla właściciela oraz w git log; dokument nie zawiera samoodwołującego się SHA.

## Wdrożenie i zakres

- Wyłącznie [staging rexbid-auth-test](https://rexbid-auth-test.tedn828.workers.dev/), Version **69d632c2-4f53-4d08-9602-6cd60de43d8e**. Wersja sprzed etapu: **0dd0ea83-6777-4df8-a30b-7ba74a0664f3**.
- Potwierdzone dane LLC i wariant A są w O nas, kontakcie, stopkach i dokumentach. Warunki i prywatność mają po dziewięć kompletnych sekcji. Pięć szkiców docs/legal odpowiada pierwszemu zakresowi publikacji. Oznaczenie DRAFT pozostaje; nie dopisano NM Entity ID, EIN ani danych z faktur.
- Przygotowano tabelę retencji, przegląd prawny zakresu, jedną kartę publikacji i scenariusz 5–10 minut; zaktualizowano istniejący runbook i handoff.
- Nie zmieniano źródłowych cen, obserwacji, 610 stawek lokalizacji, 24 stawek frachtu, algorytmu podatków, ról, sekretów ani MFA.

## Znalezione problemy i naprawy

| Problem | Przyczyna | Naprawa i dowód |
| --- | --- | --- |
| Świeża karta nie pokazywała daty obserwacji | Warunek UI pomijał freshness=fresh | Data odczytu jest zawsze widoczna dla D1; stale/unknown nadal ostrzegają. Regresja i rzeczywiste karty Tesli/Hondy: PASS. |
| Historia pomijała zapisane obserwacje D1 | Renderer konsumował wydarzenia aukcyjne, pomijając rex_history.snapshots | Osobna sekcja „Zapisane obserwacje”, ceny/null, deduplikacja i paginacja. Bez fabrykowania zdarzenia sprzedaży. Testy i obie karty: PASS. |
| Kontakt → karta → katalog gubił VIN/LOT/filtry | Kontekst zapytania nie przenosił bezpiecznego return_to | Wspólny walidator lokalnej ścieżki powrotu i oba odnośniki; kontekst nawigacji nie trafia do e-maila. Regresja odrzucająca obcą domenę oraz rzeczywisty powrót do dokładnego VIN Hondy: PASS. |
| Własny logger mógł zapisać nieznaną, dowolną ścieżkę | safeRoute zwracał surowy pathname poza znanymi API | Dozwolona lista i stałe szablony tras. Test handlera z syntetycznym VIN, e-mailem i tokenem potwierdza ich brak we własnym logu. Nie jest to deklaracja redakcji ani retencji logów platformy Cloudflare. |

## Rzeczywista przeglądarka — własne sprawdzenia

Przeglądarka Codex: **desktop 980 × 900 i mobile 390 × 844**. Część wcześniejszych sprawdzeń wykonano przy 1440 × 1000; końcowych zrzutów desktopowych nie przedstawiamy jako 1440 px. Powrót z kontaktu i końcowe wyszukiwanie VIN sprawdzono ponownie na wersji 69d632c2.

| Ścieżka | Wynik |
| --- | --- |
| Home | PASS: Aktualne, Timed, Kup teraz i Elektryczne, po cztery kafelki; polska informacja o częściowym katalogu. Sekcje poniżej ekranu ładują się po przewinięciu przez IntersectionObserver. |
| Filtry | PASS: desktop Copart/TESLA; mobile BEV/IAAI/TESLA. Trzy aktywne filtry, usunięcie marki pozostawia dwa, reset usuwa wszystkie; URL zgodny. |
| Dokładne wyszukiwanie | PASS: LOT 57660876, VIN 5YJ3E1EA3PF683202 i VIN SHHFK7H51JU428898; właściwe platformy i karty. Dodatkowo LOT 43806658. |
| Powrót | PASS: karta ↔ katalog oraz kontakt → karta → katalog z zachowanym VIN w wyszukiwaniu. Pozycję przewijania chronią istniejący kod i regresje; nie wykonano osobnego pomiaru pikselowego całej sesji. |
| Copart 57660876 | PASS: zapisana oferta 5000 USD, brak Kup teraz, źródłowy title i Geico. Obserwacja 8.10, 11:52 CEST. Po upływie 16:00: „Termin minął · wynik do potwierdzenia”, bez fałszywego countdownu lub sprzedaży. |
| IAAI 44593083 | PASS: oferta 25 USD oraz Kup teraz 2000 USD obok siebie, czytelne także na telefonie. Wybór Kup teraz zmienia podstawę V4. Title SALVAGE, Progressive Casualty Insurance. |
| Galerie i lightbox | PASS: główne/następne zdjęcie Tesli 1280 px i Hondy 845 px; Escape zamyka lightbox. Ostatnie, 17. zdjęcie Hondy jest niedostępne: pojawia się czytelny stan zastępczy, a powrót do pierwszego zdjęcia działa. Nie sprawdzano wszystkich URL-i. |
| Zapasowe BEV 43806658 | PASS: główne zdjęcie i lightbox 845 px, Electric, brak ceny nie daje zera. „Typ sprzedającego: Ubezpieczyciel”, obserwacja 11:53 CEST. |
| Historia | PASS: na obu głównych kartach jedna rzeczywista obserwacja, bez potwierdzonych wydarzeń aukcyjnych. Brak ceny pokazuje „Brak danych”. |
| V4 — Tesla | PASS: transport standardowy 1055 USD, ostrożny 1130 USD; zakup + znany transport 6055/6130 USD. Ląd 330, morze 575/650, BEV 150 jednorazowo. Niepełna suma i brakujące składniki czytelne desktop/mobile. |
| V4 — Honda | PASS uczciwego braku: Hatchback nie ma automatycznej klasy transportowej; transport „do potwierdzenia”. Kup teraz 2000 USD przekazane poprawnie. Nie wymuszano klasy Sedan dla uzyskania wyniku. |
| Lokalne ulubione | PASS: dodanie Tesli, widok Ulubione i odświeżenie. Wcześniej zapisana Honda zachowana. Test dotyczy przeglądarki, nie chmurowych ulubionych. |
| Kontakt | PASS: fikcyjny szkic bez danych klienta, poprawny LOT/VIN/cena/data, „Nie wysłano”. Nie wysłano e-maila ani nie otwarto mailto. |
| Dokumenty | PASS: dziewięć sekcji warunków i prywatności, firma/adres/kontakt, oznaczenie wersji do przeglądu oraz odnośniki. Czytelne na desktopie i telefonie. |
| Panel | Bramka anonimowa „Zaloguj się do swojego konta”: PASS. Brak gotowych sesji: nowy pokaz realizacji/rozmowy oraz dwukontowe E2E nieprzeczytanych wiadomości **NOT VERIFIED**. |
| JS i szerokość | Brak przechwyconych wyjątków JS. Przy mobile 390 px szerokość dokumentu 375 px, bez poziomego przepełnienia na sprawdzonych widokach. Nie jest to pełny audyt WCAG. |

Wcześniejsze ręczne potwierdzenia właściciela pozostają osobnym dowodem: poprawni nadawcy wiadomości, etap widoczny u osobnego klienta, ukryty plik wewnętrzny, pobranie i otwarcie pliku klientowskiego. Recovery przez e-mail potwierdzono na **koncie testowego klienta**, nie przez zmianę hasła właściciela. Nie powtarzano poczty ani MFA.

## Dane i koszt requestów

Przed i po: staging users/favorites/orders/messages/files **2/2/2/4/3**, sources/listings/snapshots **1638/1638/1682**. Końcowy readback 8.10 około **16:13 CEST**: rows_written=0, changed_db=false. Zgodność liczników nie zastępuje porównania hashów każdej prywatnej tabeli. Nie wykonywano zapisów danych aplikacyjnych do chmury, migracji ani operacji R2/MFA.

Zbiór zawiera **840 Copart + 798 IAAI**, 1682 obserwacje i 1363 oferty z URL-ami mediów. Aktywność 1098 ofert potwierdzono w obserwacjach z 8.10; 540 ma starsze obserwacje. Poprzedni audyt potwierdził brak duplikatów, wydarzeń i sztucznych encji pojazdów; ten etap nie pisał do katalogu.

Końcowy SELECT budżetu w odseparowanej D1 potwierdził **56/1000, Copart 25 / IAAI 31, reserved=0, retry=0**. Lokalny licznik ma 56 wpisów i STOP. Staging korzystał z D1 przy wyłączonym fallbacku. **Nowe requesty Apibara: 0.** Zwykłe pobranie zdalnego obrazu w przeglądarce nie jest requestem Apibara ani archiwizacją oryginału.

## Testy i wydanie

| Rzeczywiście wykonana kontrola | Wynik |
| --- | --- |
| node --test | **824/824 PASS**, zero fail/skipped/cancelled |
| Partner validate-package.test.cjs, osobno | **14/14 PASS** |
| build-calculator-v4-rates --check | 610 lokalizacji / 24 stawki frachtu, **rex-partner-v4-f0a67460b203286f**, bez zmiany |
| partner-transport-rates --check | 610 lokalizacji / 4 warianty kontenera / USD: PASS |
| validate-worker-config, prepare-production-publication --check, validate-production-preflight | **3/3 PASS**; kontrola statyczna nie jest potwierdzeniem wdrożenia produkcji |
| Składnia | **152 pliki JS + 12 skryptów inline PASS** |
| Wrangler dry-run | Staging oraz końcowy profil publication: PASS. Profilu publication nie wdrożono |
| git diff --check | PASS |
| Staging | **69d632c2-4f53-4d08-9602-6cd60de43d8e** |
| Końcowe HTTP | **19/19 PASS**: sześć stron HTML, health, ready, cars/search, filters, trzy karty, dwie historie, me i auth config. /api/me: prawidłowe 401; pozostałe: 200 |

Ostatnie pojedyncze pomiary: cars 110 ms, filters 138 ms, Copart detail 99 ms, IAAI detail 124 ms, historia 124–126 ms. To orientacyjne pomiary, nie benchmark ani SLA. Publiczny JSON ma cache do 30 s; me jest private/no-store; health/ready no-store; stagingowy HTML private/no-store/noindex.

## Dowody lokalne — poza Git

Folder **C:/Users/nowic/Documents/Codex/REXBID_VARIANT_A_QA_20261008/**:

- home-desktop-final.jpg, home-mobile-final.jpg, home-electric-mobile.jpg;
- catalog-filters-mobile.jpg;
- copart-lightbox-desktop.jpg, calculator-copart-desktop.jpg, calculator-copart-mobile.jpg;
- iaai-buy-now-mobile.jpg, alternative-bev-lightbox-mobile.jpg;
- contact-draft-desktop.jpg;
- privacy-desktop-final.jpg, privacy-mobile-final.jpg, terms-desktop-final.jpg.

Zredagowane wyniki i logi obok: REXBID_DEMO_FINAL_HTTP.json, REXBID_DEMO_D1_FINAL.json, REXBID_DEMO_CAMPAIGN_READONLY.json, REXBID_DEMO_FULL_TESTS.log, REXBID_DEMO_FINAL_DEPLOY.log, REXBID_DEMO_PUBLICATION_DRY_FINAL.log. Backupy prywatnych danych i sekrety pozostają osobno, poza Git. Screeny dokumentują datowany stan UI, nie przyszłą dostępność zdjęć.

## Gotowość i nierozstrzygnięte punkty

1. Pokaz katalogu jest gotowy. 12.10 bieżące sekcje Home mogą być puste; używać zapisanych przykładów według [scenariusza](PARTNER_DEMO_2026-10-12.md).
2. Dokumenty i retencja czekają na końcową akceptację. Warunki obecnej poczty OVH → Gmail, role odbiorców i transfery wymagają oceny opisanej w [przeglądzie](LEGAL_SCOPE_REVIEW.md). Nie deklarować niezweryfikowanego DPA. Nie wdrożono proponowanego kasowania danych.
3. Publikacja i DNS nie są zatwierdzone. [Karta](FINAL_PUBLICATION_APPROVAL.md) i [runbook](PRODUCTION_CUTOVER_RUNBOOK.md) określają nowy Worker/D1, wyłączone Auth/portal/pliki/Cron/Sync/fallback oraz TLS i aktualny DS dopiero w oknie uruchomienia. Dowody pięciu DS=0 i 12/12 rekordów z 8.10 zachowano; timeout a-dns pozostaje jawny.
4. Niepełne koszty V4, część niedostępnych mediów, odtworzenie sejfu na drugim urządzeniu i nowe E2E panelu pozostają ograniczeniami. Nie są dowodem awarii pierwszego zakresu katalogu.

**Bez pusha, publicznego deployu, nowych płatnych usług, migracji, DNS/NS, rotacji sekretów, zmiany haseł/MFA/uprawnień i nowych maili.**

## Zmienione pliki

- PROJECT_HANDOFF.md
- ROADMAP.md
- docs/BACKUP_RECOVERY.md
- docs/DATA_RETENTION_REVIEW.md
- docs/FINAL_ACCEPTANCE_QA_2026-10-08.md
- docs/FINAL_PUBLICATION_APPROVAL.md
- docs/LAUNCH_READINESS.md
- docs/LEGAL_SCOPE_REVIEW.md
- docs/PARTNER_DEMO_2026-10-12.md
- docs/PRODUCTION_CUTOVER_RUNBOOK.md
- docs/legal/AUCTION_DATA_DISCLAIMER_DRAFT.md
- docs/legal/CALCULATOR_DISCLAIMER_DRAFT.md
- docs/legal/COOKIES_ANALYTICS_DRAFT.md
- docs/legal/PRIVACY_POLICY_DRAFT.md
- docs/legal/TERMS_OF_SERVICE_DRAFT.md
- public/administracja.html
- public/car.html
- public/index.html
- public/jak-to-dziala.html
- public/kontakt.html
- public/konto.html
- public/logowanie.html
- public/o-nas.html
- public/panel.html
- public/prywatnosc.html
- public/rejestracja.html
- public/reset-hasla.html
- public/rexbid-brand.css
- public/rexbid-inquiry.js
- public/ulubione.html
- public/warunki.html
- tests/history.test.cjs
- tests/inquiry-dom.test.cjs
- tests/inquiry.test.cjs
- tests/launch-infrastructure.test.cjs
- tests/publication-company.test.cjs
- tests/vehicle-experience.test.cjs
- worker.js
