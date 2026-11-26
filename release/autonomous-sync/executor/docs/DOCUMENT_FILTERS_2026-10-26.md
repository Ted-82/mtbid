# Dokumenty sprzedaży i podpowiedzi według platformy — 26.10.2026

## Wdrożone

- Produkcja: https://rexbid.pl — Worker `rexbid-production-preflight`, Version ID `ed11f566-ff4b-4786-8491-745fe1da2ceb`.
- Staging: https://rexbid-auth-test.tedn828.workers.dev — Version ID `83b69ba5-e88e-4aa3-9f7f-477876a1ac1b`.
- Punkt wyjścia: `27c06a9cb221148d8ac82e8bb2800efb127541e1`. Checkpoint tego etapu: commit dodający ten raport, `git log -1 --format=%H -- docs/DOCUMENT_FILTERS_2026-10-26.md`. Bez pusha.

## Przyczyna i zmiana

Dotychczas filtr dokumentu korzystał z `document_type`, gdzie dostawca zapisuje m.in. techniczne kody `success`, `danger`, `other`. Poprzednie wydanie prawidłowo ukrywało te kody przed wyborem, ale nie udostępniało faktycznych nazw dokumentów. Nazwy istniały już w D1 w polu `document_name`.

Nowy filtr `sale_document_name` korzysta z tego pola, przed stronicowaniem. Zachowuje pełne oznaczenia źródłowe, np. `BILL OF SALE` oraz `BILL OF SALE - PARTS ONLY` są oddzielnymi wyborami. Porównanie ignoruje wielkość liter ASCII i skrajne spacje; nie łączy różnych dokumentów ani nie wnioskuje o możliwości rejestracji. Parametry SQL są wiązane, nazwa ograniczona do 256 znaków; nieprawidłowe wejście HTTP zwraca 400.

Stare linki z `sale_document_type` zachowują poprzedni predykat. W interfejsie mają osobny usuwalny znacznik „Starszy kod dokumentu”. Nie przekształcamy kodu koloru w nazwę dokumentu. Awaria D1 przy nowym filtrze nie powoduje fallbacku do niefiltrowanej listy providera.

Podpowiedzi metadanych i ich 30-sekundowy cache pamięci strony są teraz rozdzielone według platformy. Zmiana marki nadal korzysta z potwierdzonych danych D1 bez dodatkowego requestu w obrębie tej samej platformy. Opóźniona odpowiedź poprzedniej platformy nie nadpisuje bieżących opcji. Zmiana platformy, jej usunięcie, czyszczenie filtrów i powrót do katalogu odświeżają właściwy zakres. Wybrana jawnie nazwa pozostaje w linku, nawet jeśli nowa platforma jej nie udostępnia; wynik może wtedy być pusty.

## Rzeczywiste dane

SELECT wykonano na obu środowiskach. Wyniki są identyczne:

| Platforma | Oferty | Z zapisaną nazwą dokumentu | Różne nazwy po normalizacji |
| --- | ---: | ---: | ---: |
| Copart | 2106 | 2105 | 117 |
| IAAI | 2429 | 2429 | 92 |
| Razem | 4535 | 4534 | 203 wspólne unikalne nazwy |

Jeden rekord Copart nie ma nazwy dokumentu. Nie uzupełniano jej zgadywaniem. Liczba nazw wspólnej listy nie jest sumą platform, ponieważ część nazw występuje w obu.

Bezpośredni readback nowego repozytorium D1 porównano z osobnym SELECT: Copart `BILL OF SALE` **75/75** (4 strony), IAAI `BILL OF SALE - PARTS ONLY` **67/67** (4 strony), na każdym środowisku. Identyczne identyfikatory i kolejność, zero duplikatów. Zestaw nazw, typów, liczebności i przykładowych LOT po kontroli jest identyczny z wynikiem przed etapem.

## Kontrole

- **1286/1286 testów repo PASS**: rzeczywisty SQLite, nazwy vs kody, paginacja, platformy, cache i wyścigi odpowiedzi, stary URL, oba parametry razem, puste i nieprawidłowe wartości, escaping, brak fallbacku, pierwsze wyświetlenie katalogu. 11 testów więcej od poprzedniego checkpointu.
- **Staging: 22/22 kontrole ogólne HTTP + 10/10 kontrole dokumentów. Produkcja: 25/25 + 10/10.** Kontrole dokumentów zawierają wielostronicowe odczyty wszystkich 75 i 67 wyników, metadane obu platform, stare kody, oba parametry, pusty wynik i 400.
- Generator menu: 14 stron zgodne. Generator V4: 610 lokalizacji / 24 stawki morskie, identyczny pakiet `rex-partner-v4-f0a67460b203286f`. Walidacja profilu `portal-no-files` i `git diff --check` PASS.
- Przeglądarka staging desktop: 92 nazwy IAAI, załadowanie 20→40 unikalnych ofert; karta IAAI LOT 46032294 → kontakt → karta → katalog przywraca dokument, platformę i 40 ofert.
- Przeglądarka staging 390×844: zmiana IAAI→Copart, 117 nazw, wybór `BILL OF SALE`, 20 wyników, bez poziomego przepełnienia.
- Przeglądarka produkcja desktop/mobile: wybór `CERTIFICATE OF TITLE`, następnie `BILL OF SALE`, poprawny URL i 20 wyników; bez przepełnienia i bez zarejestrowanych błędów konsoli.
- To kontrola mobilnego viewportu, nie fizycznego iPhone'a. Wcześniejsze potwierdzenie pinch/pan na realnym urządzeniu pozostaje otwarte.

## Dane, usługi i koszty

**0 nowych wywołań Apibara.** Nie odczytywano quota wygasłego planu. Końcowy SELECT produkcji `2026-10-26T07:33:40.632Z`: `OPERATOR_STOP`, lease_owner/lease_until=null, automat **3254**. Dotychczasowy ledger **7293**, ręczna kampania **2262** zachowane. `/ready` nadal `refresh: blocked`.

Nie wykonano zapisów/migracji D1, zmian DNS, sekretów, ról, MFA ani zakupów. Nie tworzono nowego backupu danych, ponieważ ten etap wykonuje tylko SELECT i wdrożenie kodu; wcześniejsze zweryfikowane kopie pozostają właściwe. Nie deklarujemy ponownego audytu zawartości wszystkich tabel prywatnych. Konta, portal, wyceny i flagi usług nie były modyfikowane. Automatyczne e-maile i załączniki produkcyjne pozostają OFF; E2E dwóch kont nadal odłożony przez właściciela.

Aktualność danych aukcyjnych nie uległa zmianie. Ceny, dostępność i nazwy dokumentów są ostatnimi zapisanymi obserwacjami. Katalog nie jest kompletnym, aktualnym rynkiem.

## Przykłady

- [Copart — BILL OF SALE](https://rexbid.pl/?catalog=1&platform=copart&sale_document_name=BILL+OF+SALE)
- [IAAI — BILL OF SALE - PARTS ONLY](https://rexbid.pl/?catalog=1&platform=iaai&sale_document_name=BILL+OF+SALE+-+PARTS+ONLY)

## Dowody, wycofanie i dalsza praca

Dowody lokalne: `C:/Users/nowic/Documents/Codex/REXBID_DOCUMENT_FILTERS_20261026/`: before.json, readback.json, tests.log, document-http-*.json, public-check-*.json, provider-stop-after.json, logi wdrożeń i zrzuty staging-mobile/production-desktop/production-mobile.png. Skrypty kontroli `rexbid-document-*-20261026.cjs` obok katalogu dowodów, bez sekretów.

Rollback kodu: poprzednia produkcja `d2099ce5-a45c-4951-8ce7-ee98828c3934`, staging `1e8672e3-7f55-414f-bcff-cd8086618f78`; przypięty Wrangler 4.149.0, te same profile i XDG_CONFIG_HOME. Pozostawić najnowszą D1 oraz STOP. Cofnięcie kodu usuwa obsługę nowego parametru; po rollbacku sprawdzić również zapisane linki nowych filtrów. Nie cofać bazy.

Następny niezależny etap: uprościć orientację w długim katalogu (przejrzystość listy, sortowanie wyłącznie po właściwych zapisanych polach, zachowanie filtrów i powrotu), zaczynając od audytu obecnego kontraktu i zachowania strony. Wznowienie Apibara dopiero po odnowieniu planu. Wysyłka zapytania bezpośrednio do panelu wymaga osobnego spójnego etapu danych i ochrony przed spamem; obecny kontakt jawnie przygotowuje wiadomość e-mail.
