# REXBID V5.3 — kontynuacja portalu i weryfikacja

Data: 6 października 2026. Baza: zachowany V5.2 `8e2984a705c4a14cf9573042bb3f85814914a3db`. Gałąź `rexbid-professional-v5`; ten sam projekt `Ted-82/mtbid`. Wynik: lokalny kandydat do kontrolowanego stagingu. Nie wdrożono go na `rexbid.pl`.

## Co zmieniono

1. `/konto.html` pobiera eksport siedmiu sekcji: konto, profil kontaktowy, ulubione, własne importy, widoczna historia, rozmowy i metadane plików. Nowe `/api/portal/export` używa kluczy stronicowania i szyfrowanych kursorów związanych z zalogowanym kontem; każde zapytanie sprawdza własność danych. Właściciel wymaga AAL2 i również eksportuje wyłącznie importy, w których sam jest klientem.
2. Eksport w przeglądarce zbiera wszystkie strony sekcji po 50 rekordów. Błąd, powtórzony kursor, niezgodna tożsamość, przekroczenie czasu lub limitu przerywają pobranie; częściowy plik nie jest zapisywany jako kompletny. Wylogowanie, zmiana konta i opuszczenie strony anulują oczekujące odpowiedzi. Jeśli `/api/portal/config` jawnie zwraca `enabled:false`, plik zawiera tylko konto i ulubione oraz opis pominiętych sekcji. Błąd aktywnego portalu nie powoduje tego fallbacku.
3. Historia, rozmowy i materiały mają przyciski pobierania starszych stron i poprawne `has_more`. Dopisywane są wyłącznie odpowiednie listy; niezapisana wiadomość i formularz właściciela zostają w miejscu. Odpowiedź poprzednio wybranego pojazdu nie może trafić do nowej sprawy.
4. Wygaśnięcie sesji lub `pagehide` unieważniają oczekujące odczyty panelu i czyszczą także podsumowania. Późny sukces albo błąd nie przywraca prywatnych danych i nie zastępuje bramki logowania.
5. Szkice korzystają z klientowskich wpisów filtrowanych przed limitowaniem. Starszy, jawny wpis potwierdzenia płatności może być użyty nawet poza pierwszą stroną. Notatka wewnętrzna ani późniejszy etap transportu nie zastępują potwierdzenia płatności. Niepełne źródła szkicu otrzymują ostrzeżenie.
6. Wersje zmienionych skryptów w serwowanych stronach otrzymały nowe hashe, aby stary cache nie ukrywał poprawek. V5.2 i jego dowody pozostają w repozytorium.

## Zakres i ograniczenia eksportu

API zwraca wyłącznie dane zapisane w REXBID. Nie jest eksportem całego konta zewnętrznego Supabase, logów infrastruktury ani binariów R2. Metadane plików wskazują prywatne adresy pobrań wymagające zalogowania; zdjęcia i PDF pobiera się osobno z panelu.

Manifest ma `as_of`: rekordy utworzone później są pomijane, ale istniejące wartości są odczytywane na żywo. Zmiany, usunięcia i zmiana widoczności w trakcie eksportu mogą zmienić kolejne strony. To nie jest zamrożona kopia bazy. Liczby w manifeście są obserwacją, a nie gwarancją snapshotu. Kursory wygasają po 30 minutach. Klient ma maksymalnie 100 MiB i 10 000 stron; przekroczenie daje błąd i wymaga obsługi większego eksportu, bez cichego ucinania. Historia w panelu ma ograniczony offset 10 000 z jawnym komunikatem; pełny eksport używa niezależnego keyset pagination.

## Weryfikacja

| Kontrola | Wynik |
| --- | --- |
| Pełny pakiet `node --test` | 613/613 PASS, 0 failures/skipped |
| Panel DOM: rzeczywisty HTML/JS w jsdom | 30/30 PASS; historia, zachowanie formularzy, race odpowiedzi i zmiany wybranego auta |
| Backend importów | 28/28 PASS; widoczność, paginacja, konflikt, starsze potwierdzenie płatności |
| Backend eksportu | 16/16 PASS; 123 rekordy i trzy strony na sekcję, izolacja klientów, AAL2, tamper/expiry, nagłówki, brak sekretów/kluczy obiektów |
| Eksport DOM i rzeczywisty przycisk konta | 18/18 PASS; stronicowanie, zakres, błędy, późne odpowiedzi i wylogowanie |
| Integracja Worker + portal | 6/6 PASS; router, realna kryptografia i SQLite/R2 fixture; uwierzytelnianie podpisanej sesji testowane oddzielnie |
| Kalkulator | 125 663 porównania PASS; 610 lokalizacji, taryfy i obliczenia niezmienione |
| Konfiguracja Worker / release / commercial intake | PASS; model pełnej ceny nadal `review_required` |
| Wrangler staging dry-run | PASS; 45 assets, 515,89 KiB / gzip 106,62 KiB |
| Wrangler release dry-run | PASS; 45 assets, 415,35 KiB / gzip 87,56 KiB; release nadal wyłączony/read-only |
| Podgląd HTML | Rzeczywiste komponenty, przykładowe dane, formularze i wysyłka zablokowane; jsdom PASS, bez claimu renderowanego browser QA |
| Składnia / diff | PASS |
| Cloudflare dostęp | CLI `You are not authenticated`; dwie próby przeglądarki zakończone server timeout |
| Zdalny browser E2E, Supabase TOTP, R2, recovery/SMTP | NOT VERIFIED |

Dowody: `docs/qa/v5-3-import-portal-2026-10-06/`. Przegląd niezależny wykrył przypadek eksportu podczas opóźnionego wylogowania; poprawiono natychmiastowe anulowanie i dodano test, który odtwarza ten porządek odpowiedzi. Nie wprowadzono nowych tabel ani migracji w V5.3.

## Ledger i następne kroki

0 push, 0 deploy, 0 zmian DNS/MX, 0 zdalnych zapisów/migracji D1, 0 utworzonych bucketów/skrzynki, 0 wysłanych wiadomości, 0 requestów Apibara. Testy używają lokalnych fixture, dry-run wyłącznie buduje kod. Wygaśnięta prośba o zatwierdzenie została zastąpiona ponowną próbą dostępu; obecna przeszkoda to brak sesji i timeout, nie odmowa automatycznej oceny zgody.

Do uruchomienia kont pozostają: zweryfikowane środowisko staging, rzeczywiste testy właściciela i dwóch klientów, backup/restore D1+R2+kluczy, retencja/usuwanie, SMTP z recovery, awaryjna procedura MFA oraz wspólny produkcyjny profil katalogu i kont. Nie wdrażać wyłączonego `wrangler.release.jsonc` na działający `mtbid`: zwróci 503. Portal jest domyślnie OFF, a SQL `0006` pozostaje propozycją poza automatycznymi migracjami.

Przed większym ruchem potrzebne są limity storage, idempotencja mutacji i kolejka powiadomień. Obecne formularze blokują podwójne kliknięcia i nie ponawiają automatycznie zapisu; utrata odpowiedzi na udany zapis nadal wymaga sprawdzenia historii przed ponowieniem. Ograniczona rola operatora wspólnika nie jest jeszcze wdrożona.

Kalkulator zachowuje sprawdzone stawki. Następne dane partnera: port UE i kraj odprawy, zakres frachtu oraz opłaty portowe/rozładunku/agencji po dopłynięciu, waluta i netto/brutto. Brakuje też treści zakładki Additional Services. Szczegółowa kolejność jest zachowana w `docs/REXBID_PRODUCTION_NEXT_STAGE_2026-10-06.md`.
