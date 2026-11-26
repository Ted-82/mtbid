# Timed Auction — naprawa 26.10.2026

## Przyczyna i dowody

Zgłoszenie: pusta sekcja Timed Auction na Home. Produkcyjne `/api/cars?category=timed` zwracało 0; zapisane stare Timed miały 96 open i 10 finished, ostatnie odczyty z 20.10.2026. Nie zmieniono filtrów świeżości ani nie pokazano archiwum jako aktualnych ofert.

Sprawdzone 7451 stron pełnego pobrania Open/Live (148961 rekordów) nie zawierało `auction.is_timed=true`. Osobne żądanie `lot_status=Timed&lot_sub_status=Open` zwróciło Copart 0, IAAI 148. Odpowiedzi dostawcy i dokumentacja potwierdzają osobny filtr; nie zakładać, że poprzedni bootstrap All/Open pokrywa Timed.

## Wykonanie

- Pobrano 9 stron: Copart 1 pusta, IAAI 8, razem 148 unikalnych LOT. Pierwsze odpowiedzi diagnostyczne użyte ponownie, bez ponownego pobrania. Dodatkowo 1 odczyt usage. Łącznie 10 requestów operatora.
- Staging i produkcja: 148 nowych zapisów każdy, 148/148 odczytów kontrolnych cen, czasów obserwacji, statusów i snapshotów. Każdy rekord ma zdjęcia, open, Timed i przyszły koniec aukcji. Bez odrzuceń/duplikatów i błędów FK; 8 tabel prywatnych każdego środowiska bez zmian.
- Nowy `sync/timed-refresh.cjs`: osobny trwały kursor obu platform, walidacja odpowiedzi/filtrów, wykrywanie cykli kursora, 24h horyzont skanu. Maksymalnie 2 strony na przebieg, co najmniej jeden request pozostawiony dla reszty. Kolejne strony po 15min, nowy skan po 30min od zakończenia. Nie jest to gwarancja odświeżenia całej kategorii co 15min.
- Zero nowych środków w budżecie nowych ofert nie blokuje odświeżania znanych aut; pominięcie nowego wpisu zatrzymuje przesunięcie kursora. Pusty wynik nie usuwa zachowanych ofert.
- Produkcyjna flaga `REXBID_AUTO_REFRESH_TIMED_ENABLED=enabled`. Generator profilu zachowuje ją. Limity 500 requestów/dzień, 12000/miesiąc i 970 SQL bez zmian. Bez flagi dotychczasowy scheduler zachowany.
- Cron nadal co 15min. Globalna dzierżawa pełnego importu czasowo wstrzymuje Cron. Stream zmian ma pierwszeństwo; jeśli zużyje zapas SQL, Timed nie pobiera strony, której nie może bezpiecznie zapisać. Wymaga kontroli po uruchomieniu streamu.

## Weryfikacja

- 1610/1610 testów automatycznych PASS. Pierwsze uruchomienie miało EPERM w systemowym katalogu tymczasowym; uruchomienie w dozwolonym katalogu roboczym i aktualizacja generatora nowej flagi dały pełny PASS. Nie usuwano testów.
- Rzeczywisty przebieg operatora tego samego schedulera na produkcyjnej D1: 7/7 odpowiedzi, 0 retry, 44 aktualizacje, w tym 20 Timed, 488 SQL. Odczyt kursora i dat po zapisie; 8 tabel prywatnych bez zmian. To kontrolowane uruchomienie operatora, nie dowód samodzielnego zdarzenia Cron.
- Publiczne API obu środowisk: 3 strony po maks.50, 148/148 unikalnych świeżych Timed/open, 148 z mediami. UI Home i przejście „Zobacz wszystkie” sprawdzone w przeglądarce. Dalsze wyniki UI w dowodach.
- Produkcyjna przeglądarka: Home pokazuje 4 karty Timed; „Zobacz wszystkie” zachowuje category=timed i wyświetla 20 ofert pierwszej strony. Karta IAAI43083856 ma poprawny status Timed, cenę4700USD, termin,18zdjęć i powrót do Timed. Widok mobilny390px (layout375px) ma 4karty bez poziomego przepełnienia. Brak ostrzeżeń/błędów konsoli. Dowody: browser.json, timed-produkcja.png, timed-mobilny.png. To kontrola responsywna, nie fizyczny iPhone.

## Wydania i kopie

- Staging: `151b6846-fa39-4254-80ea-320e8b4ef2df`.
- Produkcja: `d8d254d5-6be9-4a95-ba11-e1b4ec7d36e6`.
- Poprzednia produkcja: `b2fffc59-3188-4503-a943-bd10bf985fd0` (rollback kodu bez kasowania zapisanych ofert).
- Zaszyfrowane kopie obu D1, DPAPI CurrentUser/NTFS owner+SYSTEM: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/timed-before-20261026`. Odszyfrowanie/hash i strumieniowe odtworzenie do SQLite w pamięci PASS, integrity/FK/duplicates poprawne. Przed zmianami 117777 ofert produkcji i 4535 staging. Produkcyjny SQL ma 667MB; nie ładować go w pojedynczy string Node (limit V8).
- Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_TIMED_20261026` (download, import/readback, http, automatic-result, testy, logi deployu, screenshot). Pliki eksportu zawierają dane prywatne i pozostają chronione.

## Koszty i ciągłość

Brak nowego abonamentu/zakupu, DNS, sekretów, uprawnień i zmian kalkulatora lub portalu. Ostatnie usage dostawcy przed pozostałymi stronami: 7728/30000 wykorzystane, 22272 dostępne, Basic. Nie deklarować aktywnego Pro.

W trakcie diagnozy wykryto zakończony proces głównego importu z nierozliczonym timeoutem. Agent potwierdził COMMIT60/60 i rozliczył rezerwację, bez replay. Następnie import wznowiony 15:51:10Z, runId `926970be-aa2f-4689-8a5c-c8e1a259ff0f`, sesja `42334`, od kursorów Copart2916/IAAI2914. Nie uruchamiać drugiego importera. Bieżący checkpoint w `REXBID_INVENTORY_20261026/import-checkpoint-20261026.json`. Timed148 są osobnym uzupełnieniem. Zakończenie pełnego katalogu i catch-up/stream wymagają dalszej kontroli.

Ostatni checkpoint agenta po53partiach wznowienia: globalnie5991/7451stron,118364readback; kursoryCopart2995/IAAI2994. Proces42334 pozostawiony aktywny, import nieukończony. Używa pobranych plików bez kolejnych requestów dostawcy.
