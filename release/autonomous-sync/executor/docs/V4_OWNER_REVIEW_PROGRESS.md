# V4 Owner Review — postęp sprintu

## Stan bieżący — 2026-10-05

- Repo: `C:\Users\nowic\Desktop\stona_auta-www`; HEAD `5c781c7`.
- Zachowano istniejący, niezacommitowany WIP V4. Kopia sprzed edycji: `%TEMP%\rexbid-owner-review-pre-20261005` (bez sekretów, cache i `node_modules`).
- Ostatni znany staging przed tym sprintem: `4f207454-3c67-457a-9595-1e458818a2ee`; trzeba zweryfikować aktualny runtime po wdrożeniu.
- Ostatnie przekazane wyniki: 339/339 testów repo i 14/14 testów pakietu partnera. Nie są jeszcze uruchomione ponownie w tym sprincie.
- Przeczytano specyfikację Owner Review, manifest źródeł i metadane pakietu V4. Źródłowe stawki V4 pozostają aktywnym źródłem danych.
- Odczyt pozostałego stagingowego limitu upstream nie jest dostępny lokalnie. Nowe requesty Apibara w tym sprincie: **0**; nie wykonuj live fallbacków, discovery ani backfillu.
- Wygenerowano osobny przezroczysty asset Corvette na podstawie zdjęcia właściciela; jeszcze nie skopiowano/nie zoptymalizowano w `public/`.

## Zrobione

- Potwierdzono brudny working tree i zachowano kopię istniejących zmian.
- Potwierdzono staging target z konfiguracji: `rexbid-auth-test` → `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`).
- Sprawdzono, że V4 używa preferowanego terminalu i wylicza warianty standard/ostrożny z rozdzielonymi stawkami.

## Aktywne usterki / zakres do domknięcia

- Nowy owner visual direction (granat/czerwień/biel, jasne karty) i zatwierdzone hasło nie są wdrożone.
- Kalkulator V4 nie ma jeszcze stagingowego ekranu preview z syntetycznymi fixture; normalny Home nie może dostarczyć kontrolnych danych bez providera.
- EV Home → katalog filtr, filtr BEV w API/URL, miniatury/ceny oraz formularz auto → kalkulator wymagają behavioral QA.
- Brak wiarygodnego, odtworzonego live budżetu ogranicza ocenę świeżości aktualnych ofert; historyczne/stare dane nie będą oznaczane jako aktualne.

## Następna czynność

1. Zaimplementować staging-only owner review preview host+flag gated, używające produkcyjnych komponentów i lokalnych fixture bez fetch/API.
2. Domknąć transport binding, EV/filter/query state, ceny i semantykę UI.
3. Zmienić Home design na prawdziwe elementy interfejsu z odrębnym Corvette asset.
4. Uruchomić regresje i pełny suite, staging dry-run/deploy, następnie real browser QA nowego Version ID.

## Owner Review V4 — końcowy staging review, 2026-10-05

- **Staging only:** Worker `rexbid-auth-test`, D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Końcowy Version ID po poprawce mobile catalog shortcuts: `da5fde1c-41f6-4251-8ea8-4e9dfca02d4f`. Brak migracji. Produkcja, `mtbid` i `rexbid-db` nie były dotykane.
- **UI verified in real browser (synthetic review cases):** Home → osobny staging-only owner preview → zwykłe kliknięcia między fixture cases; Calculator V4. Linki podglądu są odseparowane od normalnego katalogu, jawnie oznaczone jako syntetyczne/nieaktualne i nie zapisują danych do D1 ani nie wołają providera.
- **Kontrolne kalkulacje USD:** Houston base ICE: land 205 + sea 675 = 880 standard / 205 + 850 = 1055 ostrożnie. Houston BEV: +150 raz na auto = 1030 / 1205 transport; przy cenie auta 5000 znany subtotal wynosi 6030 / 6205. Portland–Gorham IAAI / preferowany terminal Elizabeth: 450 + 575 = 1025 / 450 + 650 = 1100 transport. Nie są to pełne koszty pod dom.
- **Klikalne zachowania sprawdzone:** Kup teraz 5000 pozostaje osobne od bieżącej oferty 1550, a „Policz dla tej ceny” zmienia podstawę na 5000. IAAI HEV nie otrzymuje dopłaty BEV; dokładny `ME Salvage Title` i typ sprzedającego „Ubezpieczyciel” są czytelne bez sfabrykowanej nazwy. Copart fixture z nieustalonym terminem nie pokazuje daty ani countdownu. Brak zdjęć daje sensowny pusty stan, a kontrolki lightbox/nawigacji nie są widoczne bez mediów.
- **Normalny Home/catalog:** Herosekcja i cztery wymagane sekcje są widoczne; wszystkie sekcje rozwiązują się do prawdziwego pustego stanu przy obecnym starym/partial D1. EV „Zobacz wszystkie” otwiera `?catalog=1&fuel_type=Electric`, chip Elektryczne/BEV pozostaje aktywny także po odświeżeniu; wynik to 0, bez zwracania ogólnych ofert. Ten stagingowy zestaw ma 260 Copart + 120 IAAI historycznych/nieświeżych rekordów; nie wykonano odświeżenia ani backfillu.
- **Mobile:** końcowy deploy sprawdzony na 375 CSS px. Skróty kategorii zawijają się do dwóch wierszy bez wewnętrznego poziomego paska; wynik pusty jest czytelny. Poprzedni review obejmował desktop, ale końcowego buildu po ostatnim CSS nie zweryfikowano przy 1440×900. Dokładne viewporty 390×844 i 360 px nie były dostępne w tym przeglądarkowym kontekście.
- **Fixy w kontynuacji:** ukryte martwe galerie-controlsy bez zdjęć, zawijanie staging preview navigation, prawidłowe selektory szczegółów kalkulatora, zawijane mobile catalog shortcuts. Regresje: `tests/media-gallery.test.cjs`, `tests/calculator-v4.test.cjs`; istniejący suite Home/EV/price semantics pozostaje zielony.
- **Budżet/upstream:** Apibara live requesty w tej kontynuacji = **0**. Nie wykonano Home refresh/backfill, realnego detail/history ani danych dostępnych wyłącznie provider fallbackiem. Nie da się w tym odczycie potwierdzić pozostałego limitu kampanii; brak live QA nie jest zaliczony jako brak upstream usage w całej wcześniejszej kampanii.
- **Końcowe automatyczne sprawdzenia:** `node --test` 353/353 PASS; partner package 14/14; oba generatory `--check`, config validator, składnia wszystkich zmienionych modułów JS/Worker i `git -c core.whitespace=cr-at-eol diff --check` PASS. Pierwsza komenda składniowa z PowerShell nie obsługiwała operatora `<`; właściwe sprawdzenie przez pipeline PowerShell → `node --input-type=module --check` zakończyło się PASS.
- **Pozostałe niezweryfikowane:** normalna karta z aktualnym realnym listingiem i zdjęciami, rzeczywisty aktualny Buy Now/Upcoming/EV katalog, lightbox z live zdjęciami, LOT 58307896 live source, 1440×900 końcowego buildu, 390×844/360 mobile, cloud Auth. Brak realnej treści wynika ze starego/partial staging D1; nie zmieniano filtrów, by ukryć to.

### Kryteria odbioru — status

1. Katalog→auto→kalkulator/anchor: klik „Otwórz kalkulator kosztów” przenosi do jednego widocznego V4 panelu na fixture card; mobile PASS. Końcowy desktop 1440×900 oraz back/forward: NOT VERIFIED.
2. Znany transport pokazany jako wartości ląd/morze/suma: PASS (syntetyczne przypadki na prawdziwym V4 UI).
3. BEV 1030/1205 i HEV bez automatycznego +150: PASS.
4. Buy Now osobny, właściwy kafelek/karta i wycena po kliknięciu; własna cena po odświeżeniu: klik Buy Now PASS; persistence własnej ceny po real browser refresh: NOT VERIFIED.
5. Home EV→katalog, aktywny filtr po odświeżeniu, wyłącznie BEV albo uczciwe 0: PASS na normalnym staging UI.
6. Home sekcje/puste dane/partial: PASS dla prawdziwego empty state, brak świeżych ofert.
7. Kafelki bez ciężkich status overlay: code/tests PASS; świeży live Buy Now card: NOT VERIFIED.
8. Navy/red/light UI, oddzielne elementy, zatwierdzony slogan i brak niepotwierdzonych claims: PASS na aktualnym Home.
9. Seller/title/upcoming/gallery empty fallback: PASS na synthetic fixture; live gallery/history unavailable without risking provider fallback.
10. Mobile 375 no page overflow and functional visible filters/calculator details: PASS. 360/390 plus 1440 final viewport: NOT VERIFIED.

### Linki do widoków stagingowych

- Home: https://rexbid-auth-test.tedn828.workers.dev/
- Katalog elektrycznych (jawne zero wyników w aktualnym partial D1): https://rexbid-auth-test.tedn828.workers.dev/?catalog=1&fuel_type=Electric
- Podgląd testowy — transport bazowy Houston: https://rexbid-auth-test.tedn828.workers.dev/__staging/owner-review?case=transport&lot=OWNER-V4-HOUSTON
- Podgląd testowy — BEV Houston: https://rexbid-auth-test.tedn828.workers.dev/__staging/owner-review?case=bev&lot=OWNER-V4-BEV-HOUSTON#importCalculator
- Podgląd testowy — aktualna oferta + Kup teraz: https://rexbid-auth-test.tedn828.workers.dev/__staging/owner-review?case=buyNow&lot=OWNER-V4-BUY-NOW
- Podgląd testowy — IAAI HEV / TITLE / typ sprzedającego: https://rexbid-auth-test.tedn828.workers.dev/__staging/owner-review?case=hybrid&lot=OWNER-V4-HEV-IAAI
- Podgląd testowy — Copart Upcoming bez terminu: https://rexbid-auth-test.tedn828.workers.dev/__staging/owner-review?case=unassigned&lot=OWNER-V4-UNASSIGNED
- Podgląd testowy — brak potwierdzonej stawki: https://rexbid-auth-test.tedn828.workers.dev/__staging/owner-review?case=unmatched&lot=OWNER-V4-UNMATCHED

**Wniosek:** stagingowy kandydat do oceny właściciela dla nowego UI i kalkulatora na syntetycznych, jawnie oznaczonych przypadkach. To nie jest potwierdzenie aktualności publicznego katalogu ani pełny live product QA.
