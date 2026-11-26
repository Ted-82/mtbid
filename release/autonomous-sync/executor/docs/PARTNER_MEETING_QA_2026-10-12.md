# QA przygotowania spotkania wspólnika — 12.10.2026

## Wynik

- Spotkanie: wtorek13.10 wieczorem. Excel przygotowano już dziś; dane ofert wymagają krótkiego odświeżenia przed pokazem.
- Staging: https://rexbid-auth-test.tedn828.workers.dev/ ; Version ID **5079f5f9-75ed-4231-869e-292157d0167e**.
- Zakres tego wdrożenia: tylko public/rexbid-inquiry.js i odnośnik assetu public/kontakt.html. Bez migracji i operacji na danych klientów. Poprzednia wersja rollbacku kodu:49453c6c-71a5-4303-b428-8a97320ec8b9.

## Dwie znalezione i naprawione regresje

1. buildDraft doklejał na sztywno https://rexbid.pl, także w zapytaniu przygotowanym na stagingu. Link prowadził poza pokazywaną aplikację. Obecnie mount podaje origin strony, a buildDraft akceptuje tylko rexbid.pl, www.rexbid.pl i zatwierdzony staging; nie bierze domeny z query string. VIN/LOT/platforma zachowane, return_to nie trafia do maila.
2. normalizeContext używał >0 dla purchase_usd. Jawne 0 znikało z zapytania. Obecnie >=0, z nadal ścisłą walidacją liczby; null/undefined/puste/ujemne/nieskończone pozostają brakiem. Nie zmieniono zasad brakujących opłat kalkulatora. Daty snapshotów zachowane.

## Rzeczywiście wykonane sprawdzenia

| Rodzaj | Wynik |
| --- | --- |
| Repo, node --test | 909/909 PASS |
| Partner V4 | 14/14 PASS |
| Celowane inquiry + DOM | 25/25 PASS, w tym3 nowe regresje |
| validate-worker-config / generator V4 --check | PASS;610 lokalizacji,24 stawki morskie |
| git diff --check | PASS |
| Browser na wdrożeniu | Honda44593083/IAAI → formularz → lokalny draft: właściwy link stagingu, VIN, LOT,25 USD z datą08.10.2026T20:16:57.891Z |
| Desktop1280 / mobile390 | Formularz i gotowy draft czytelne, overflow=false; rzeczywiste zrzuty |
| Zero/null/ceny i odrzucenie obcej domeny | Regresje syntetyczne; nie nowe dane od providera |
| Wysyłka maila | Niewykonywana, przygotowanie lokalne |
| Excel | 10 arkuszy;171 punktów;42 pozycje V4;24 formuły,13 walidacji,9 tabel z zamrożeniem2kolumn/5wierszy;0 błędów komórek |
| Excel: edycja statusu | Licznik zwiększył się o1, następnie przywrócono stan; pusta opłata pozostała pusta, BEV150 zachowane |

Excel zrenderowano do podglądów wszystkich zakładek i sprawdzono wizualnie. Kontrola struktury eksportu ZIP/XML bez błędów; nie uruchamiano natywnego Microsoft Excel. Pola bankowe i telefoniczne mają format tekstowy. To formularz ustaleń, nie gotowa umowa/porada prawna ani wycena konkretnego importu.

## Pliki poza Git i dowody

- Excel: C:\Users\nowic\Documents\Codex\REXBID_PARTNER_MEETING_20261013\outputs\REXBID_Pakiet_wspolnika_2026-10-13.xlsx
- SHA256: 11d14ab2a523762623c24061f83b80ab56e9fac0ba90387b357afbfe6496fd83
- Builder i źródła kontroli: C:/Users/nowic/Documents/Codex/REXBID_PARTNER_MEETING_20261013/build.mjs (dołączony runtime arkuszy).
- Logi: repo-tests.log, partner-tests.log, deploy.log; formula-check.json i workbook-summary.json.
- Zrzuty: contact-desktop.png, contact-mobile.png, preview-*.png.
- Konto/MFA/realizacje/wiadomości/pliki nietknięte. Apibara0 nowych odczytów; kampanie i liczniki niezmienione. Nie wykonano publicznego deployu, zmian DNS, zakupu ani pusha.

## Kolejny krótki etap przed pokazem

Po wznowieniu13.10: potwierdzić dostęp i quota, backup przed zapisami, odświeżyć oszczędnie wybrane reprezentatywne auta z istniejącym mechanizmem oraz trwałym licznikiem, readback i media, uaktualnić ten sam scenariusz/Excel. Nie odświeżać całego katalogu bez potrzeby. Jawnie oznaczyć błędy źródłowe i dawne obserwacje. Publiczny pokaz nie wymaga konta; panel tylko osobno na testowych danych z właścicielem. Publikacja i delegacja pozostają osobną zgodą.
