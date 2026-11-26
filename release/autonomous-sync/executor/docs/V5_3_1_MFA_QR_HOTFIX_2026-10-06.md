> Raport źródłowy paczki Work. Aktualne uzupełnienie dla Supabase REST, wyniki 618/618 i staging Version ID: [lokalna weryfikacja](V5_3_1_LOCAL_STAGING_VERIFICATION_2026-10-06.md).

# REXBID V5.3.1 — zgodność QR i ręczna konfiguracja TOTP

Baza Work: `6e1864e2231dd59f0e35e9bc523d229a482d5ad3`, kod paczki V5.3. Lokalny Codex według raportów właściciela scalił tę paczkę z V4 bez nowych commitów i aktywował staging `b4d44103-574e-47b4-94de-8b89e766a32b`. Jego bieżący checkout może mieć dodatkowe zmiany konfiguracji. Zachować je i scalać wyłącznie ten hotfix.

## Zgłoszenie i ustalenia

Właściciel widzi klucz konfiguracji oraz pole na kod, bez obrazu QR. Klucz jest sekretem TOTP do ręcznego dodania konta w aplikacji; pole oczekuje sześciocyfrowego kodu wygenerowanego przez tę aplikację. Nie należy przesyłać żadnego z tych danych w czacie ani logach. Ręczna konfiguracja jest wspierana przez Supabase: https://supabase.com/docs/guides/auth/auth-mfa/totp.

Lokalnie potwierdzono lukę kompatybilności: adapter `/enroll` przyjmował wyłącznie raw SVG, mimo że frontend potrafi bezpiecznie obsłużyć również SVG data URI. Backend normalizuje teraz raw SVG i dokładne SVG data URI (percent/base64, opcjonalny UTF-8) do jednego, ograniczonego rozmiarem źródła obrazka. Nie przyjmuje zewnętrznych adresów ani obcego MIME. Nie ma wstrzykiwania markup. Dotychczasowa whitelist elementów i atrybutów frontend oraz CSP pozostają zachowane. Deklaracje XML, DTD, entities i processing instructions nadal odrzucane; nie rozszerzono ich obsługi bez rzeczywistego źródła/kontraktu.

To potwierdzona luka kodu, nie ustalony format faktycznej odpowiedzi użytkownika. Work nie odczytał jego payloadu enrollment, QR ani sekretu. Ostateczną przyczynę należy potwierdzić na stagingu, bez zapisu wrażliwej treści. SDK Supabase opisany w dokumentacji i direct REST `/factors` naszego adaptera należy rozróżniać.

UI podpisuje osobno klucz na telefon i pole na sześć cyfr. Brak QR lub błąd wczytania obrazu wyświetla instrukcję ręcznego dodania konta; nie tworzy dodatkowego faktora. Nowy hash `/rexbid-owner-mfa.js` odświeża skrypt administracji.

## Weryfikacja

- 617/617 Node tests PASS, 0 failed/skipped. Backend MFA 9/9; komponent DOM MFA 15/15.
- Testy siedmiu akceptowanych formatów i dwunastu odrzucanych/błędnych/za dużych wejść. Błędne QR zachowuje poprawny klucz do ręcznej konfiguracji.
- Testy DOM: brak QR oraz błąd obrazu, wyraźne rozdzielenie klucza/kodu, zakończenie challenge/verify, usunięcie klucza po AAL2, brak ponownego enrollment po błędzie obrazu.
- Wrangler staging dry-run PASS, 45 assets. Składnia i diff-check PASS. Kalkulator, taryfy, D1 schema, bindingi i flagi R2 bez zmian.
- Testy transportu Supabase i obrazu wykorzystują fixture. Skanowanie aparatem, prawdziwy enrollment, 2FA i aktualny cloud staging wymagają kontroli lokalnego Codexa/właściciela.
- Work: 0 deploy/push/zdalne migracje/zmiany DNS/R2/requesty Apibara. Nie odczytano i nie usunięto faktorów użytkownika.

## Kontynuacja przez lokalnego Codexa

Porównaj pięć zmienionych plików funkcji/testów z własnym checkoutem i scal hotfix. Sprawdź patch `git apply --check`; nie nadpisuj całego V5.3 ani działającej konfiguracji. Używaj stagingowego Supabase/Workera.

Przyczyna runtime: odnotuj tylko klasyfikację formatu QR (`raw_svg`, `svg_data_uri`, `xml_svg`, `missing`), ewentualnie rozmiar, kategorię odrzucenia sanitizera oraz skuteczność `img-src` w rzeczywistym CSP. Nigdy nie dumpuj payloadu `/enroll`, tekstu SVG/data URI, secret, otpauth URI, kodu, cookie ani tokenów. Nie używaj zewnętrznych generatorów QR lub usług konwersji z sekretem. Nie usuwaj/nie resetuj istniejących faktorów; ponowny enrollment tylko jeśli konieczny i nie ma potwierdzonego faktora, przez jawne działanie właściciela w UI.

Po testach wdroż wyłącznie staging, zachowaj wszystkie aktywne bindingi/sekrety/config spoza hotfixa. Potwierdzenie AAL2 wykona właściciel. Produkcja, DNS, SQL i R2 billing poza zakresem tej poprawki.
