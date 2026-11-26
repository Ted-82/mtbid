# V5.3.1 — lokalne scalenie i staging, 2026-10-06

## Wynik

- Staging: `https://rexbid-auth-test.tedn828.workers.dev/administracja`.
- Worker Version ID: **3b14561e-c624-45a8-b7f9-fbab60ef468f**.
- Poprzednia wersja: `b4d44103-574e-47b4-94de-8b89e766a32b`.
- Konto Cloudflare Tedn828, `7ff5a57444667c4eda2a6a7f0fc4120d`.
- Binding: `rexbid-auth-test-db`, `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`.
- Zachowano cały lokalny V4/V5.3, konfigurację, sekrety, materiały i `.codex-wrangler-cache`. Bez resetu, commitu/pusha, migracji, zmian produkcji/DNS i operacji na rzeczywistych faktorach TOTP. Apibara: **0 requestów**.

## Diagnoza — co potwierdzono

Paczka V5.3.1 poprawia obsługę SVG data URI (percent/base64), ręczny wariant konfiguracji i błąd ładowania obrazka. Sprawdzono manifest i zgodność patcha z lokalnymi plikami. Sama paczka nie pokrywała jednak formatu generatora używanego przez bezpośrednie REST API Supabase. Nasz `auth/supabase.js` nie używa SDK modyfikującego QR: przekazuje wynik `/auth/v1/factors` do normalizatora backendu.

[Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/mfa.go) generuje surowy SVG przez goqrsvg/SVGo. [goqrsvg w wersji wskazanej przez Supabase](https://github.com/aaronarduino/goqrsvg/blob/17e843f1dd40/goqrsvg.go) emituje prostokąty z dwoma stałymi stylami koloru. [SVGo w wersji wskazanej przez Supabase](https://github.com/ajstarks/svgo/blob/1546f124cd8b/svg.go) dodaje deklarację XML, komentarz generatora i deklarację przestrzeni xlink. Powodowało to:

1. Backend odrzucał preambułę, bo wymagał początku `<svg` i odrzucał każde `<?`. Zwracał `qr_code=null`, zachowując ręczny klucz — zgodne z obserwowanym objawem.
2. Nawet bez preambuły frontend odrzucał `xmlns:xlink` oraz `style` prostokątów.
3. Dotychczasowe limity 128 000/180 000 znaków nie mieściły realistycznego SVG z prostokątem na każdy moduł.

To odtworzone błędy zgodności z opublikowanym generatorem REST. **Nie zachowano ani nie odczytano wrażliwego payloadu wcześniejszej próby właściciela, więc nie potwierdzamy jej konkretnego formatu ani rozmiaru.** Nie wykonano nowego rzeczywistego enrollment w celach diagnostycznych. CSP stagingu dopuszcza `img-src data:`; polityka CSP nie jest blokadą w przeprowadzonym teście.

## Uzupełnienie poprawki

- Backend usuwa wyłącznie rozpoznaną deklarację XML 1.0 (opcjonalnie UTF-8) i komentarz SVGo. DTD, encje i inne processing instructions nadal są odrzucane.
- Limity: wejście do 1 MiB, zdekodowany SVG do 512 KiB, wynik data URI do 1,5 MiB. Frontend ogranicza także liczbę węzłów do 10 000.
- Frontend usuwa wyłącznie prawidłową, nieużywaną deklarację xlink z korzenia oraz zamienia dokładne style `fill:black;stroke:none` / `fill:white;stroke:none` na atrybuty prezentacyjne. Ogólne CSS, href/use/image, skrypty, event handlers i zewnętrzne zasoby pozostają niedozwolone.
- QR jest obrazem `<img>`, nie aktywnym SVG w DOM. Instrukcja ręczna odróżnia klucz konfiguracji od sześciocyfrowego kodu; błąd obrazka nie powoduje ponownego enrollment.
- Hash assetu: `rexbid-owner-mfa.js?v=45fcf13c5825`.
- SHA256 `wrangler.staging.jsonc` przed i po: `6f576cdb6a04ca93aa0bc8a208b7791e7dfd0d7b0b87b65d520f306cd0129db1`.

## Weryfikacja wykonana lokalnie

- **618/618** pełnych testów Node PASS, 0 failed/skipped; MFA 25 testów.
- Nowa regresja: syntetyczny SVG w formacie REST (57×57 modułów) → rzeczywisty adapter i handler BFF → rzeczywisty frontend w DOM. Test przekracza stare limity, sprawdza wszystkie prostokąty i brak dodatkowego enrollment/usuwania faktora.
- Zachowane testy istniejącego TOTP, AAL2, CSRF, owner isolation, odrzuconych obrazów, ręcznej konfiguracji i usuwania wrażliwych danych po weryfikacji.
- **125 663** porównania kalkulatora PASS; 610 lokalizacji i oba generatory `--check` PASS.
- Walidatory konfiguracji i release PASS (release nadal nieaktywny), syntax checks oraz diff-check PASS.
- Staging Wrangler dry-run i deploy PASS.

## Weryfikacja zdalna i przeglądarka

- `/health`, `/ready`, `/administracja`: **200**.
- `/api/portal/config`: **200**, portal nadal włączony; pliki pozostają wyłączone zgodnie z poprzednim stanem R2.
- Anonimowe `/api/portal/me`, `/api/portal/security`, `/api/portal/orders`: **401**, `private, no-store`.
- Kod assetu pobrany ze stagingu jest bajtowo zgodny z lokalnym plikiem. Administracja wskazuje nowy hash.
- Prawdziwa przeglądarka: lokalny, syntetyczny harness używa rzeczywistego handlera i UI oraz CSP odczytanego ze stagingu. Kliknięcie → obraz obecny i zdekodowany, naturalna szerokość 325 px; brak aktywnego SVG w DOM. To test renderowania, **nie skanowanie rzeczywistego kodu TOTP**. Harness pozostaje poza `public/` i nie został wdrożony.
- Rzeczywista administracja stagingowa: nowy skrypt, poprawna bramka logowania bez ujawnienia danych.

## Pozostałe ograniczenia i użycie

Nie zweryfikowano skanowania QR ani AAL2 z rzeczywistą sesją właściciela. Nie pobrano ani nie zapisano jego klucza/QR, nie wykonano challenge/verify na jego koncie. Istniejący, potwierdzony TOTP nadal wymaga aktualnego kodu z przypisanej aplikacji; nie trzeba konfigurować go ponownie. Portal nie odzyskuje sekretu już utworzonego faktora z Supabase.

R2 pozostaje wcześniejszym, osobnym blockerem załączników (usługa nieaktywna na koncie); poprawka QR nie zmienia flagi plików ani nie tworzy bucketa.

Raport `V5_3_1_MFA_QR_HOTFIX_2026-10-06.md` i katalog `docs/qa/v5-3-1-mfa-2026-10-06/` pochodzą z paczki Work: dokumentują testy pakietu sprzed powyższego uzupełnienia, nie aktualny staging.
