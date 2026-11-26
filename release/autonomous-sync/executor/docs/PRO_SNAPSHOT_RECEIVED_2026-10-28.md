# Rzeczywisty snapshot Pro — odbiór 28.10.2026

## Potwierdzone

Provider naprawił subskrypcję: API usage 2026-10-28T17:42:33.053Z: Pro, limit 100000, used 8710, left 91290. Wznowiono istniejący feed REXBID — Copart + IAAI, bez utworzenia drugiego ani nowego zakupu. UI ACTIVE i RECONCILIATION; znaczenie tego drugiego trybu wymaga sprawdzenia formatu następnego pliku. #4948 ostatnio Incremental RUNNING; #4566 FAILED. To ostatni odczyt, nie potwierdzenie ciągłości.

Przeglądarka zapisała `Downloads/apibara-feed-20-4548.jsonl (1).gz`, mimo błędu narzędzia pobierania/ERR_BLOCKED_BY_CLIENT przy próbie otwarcia adresu. Właściciel nie musi pobierać pliku ponownie.

Weryfikacja #4548:

- 203226 rekordów, 139855 Copart / 63371 IAAI; brak duplikatów platform+LOT.
- 197299 Open / 5927 Live; ten plik nie zastępuje osobnego mechanizmu Timed.
- 1824 niepełne/brakujące VIN wymagają normalnej kontroli tożsamości importera.
- 186687793 bajty gzip, 2378205174 bajty po rozpakowaniu.
- SHA256 `b67ed57173a830ab6f4732f979ae209ba593168d9a3dea3e3a0d88ce3651f235`.
- Wszystkie rekordy mają poprawne UTC updated_at: min 2026-05-20T11:20:28.000Z, max 2026-10-27T16:12:55.000Z.
- UI nie dostarczyło jednoznacznych metadanych czasu zebrania z dokładnością/strefą pozwalającą przypisać wszystkim rekordom nową datę obserwacji.

Prywatny, niezmienny plik i manifest: `C:/Users/nowic/Documents/Codex/private-data/rexbid-pro-feed-20261027/files/<SHA>/`. Oryginał i pierwsza kopia pozostają zachowane. Dowody bez klucza API: `C:/Users/nowic/Documents/Codex/REXBID_PRO_ACTIVE_20261028/initial-snapshot-manifest.json`, inspection/shape i pro-provider-usage.json. Adres /latest zabezpieczony DPAPI poza repozytorium; nie wypisywać.

## Zmiany kodu i testy

`ingestLocalFeed` używa tej samej kontroli i atomowego publikowania plik+manifest co pobranie HTTP: gzip CRC, UTF8, JSONL, zakres, licznik, duplikaty i hash, bez zapisu bazy. Strumienie odrzucone przed odczytem są zamykane. Limit rozpakowania 3 GiB, nadal maksymalnie 512 MiB skompresowane, 1 mln rekordów, 2 MiB na linię i 10 minut. Podniesienie z 2 GiB było konieczne dla zmierzonego pliku 2,38 GB; pamięć nie buforuje całości.

Importer/reader mają jawny `observationTimeBasis: source_updated_at`: każda oferta zachowuje własną datę źródła; wspólne observedAt jest wyłącznie zweryfikowaną górną granicą. Reader przed pierwszą stroną sprawdza daty wszystkich rekordów i zgodność maksimum. Braki, niepoprawne daty i daty późniejsze niż granica nie stają się świeżymi obserwacjami. Dotychczasowy tryb capture oraz istniejące checkpointy pozostają zgodne. Zmiana trybu w trakcie wznowienia tego samego pliku jest zabroniona. Chronione są nowsze obserwacje i wersje dostawcy.

34/34 testy PASS: intake, source-time reader, import, identity, nowsze dane, rollback, wznowienie, duplikaty, timeout i anulowanie zbyt dużego body. Log `snapshot-tests.log`. Nie uruchamiano ponownie pełnej regresji UI, bo nie zmieniono strony ani Worker.

## Stan i następne działanie

**databaseApplied=false, continuityVerified=false.** Aktualny etap nie zmienił produkcji ani staging D1. Wcześniejsza próba 200 rekordów/4834 oferty staging jest opisana w PRO_SYNC_2026-10-28.md i dotyczyła archiwalnej próbki API z 26.10, nie pliku #4548.

1. Odczytać stan #4948, zachować nowy plik i jego metadane. Nie zakładać, że /latest to snapshot lub że etykieta Incremental oznacza format zdarzeń; sprawdzić zawartość. Ustalić ciągłość po nieudanej #4566 i retencję.
2. Świeży backup staging z odtworzeniem. Przygotować małą próbę rzeczywistych rekordów Copart i IAAI z zachowaną proweniencją SHA pliku głównego. Nie oznaczać całego pliku jako zastosowanego po próbce.
3. Sprawdzić kontrolowany import, odczyt zapisanych danych i zachowanie chronionych tabel, a następnie produkcyjny backup, bieżące zużycie D1 i plan pełnego importu z budżetem oraz catch-up.
4. Dopiero po weryfikacji kompletności i opóźnienia podłączać automat. 30-minutowe pliki nie są każdą zmianą ceny na żywo ani funkcją licytacji REXBID.

Potencjalna korzyść dla klienta to szerszy katalog i uzupełnione szczegóły. 203226 nie oznacza tylu dodatkowych aut ani gwarancji wszystkich aukcji rynku. Plik jest z 27.10, a część wersji źródła starsza. Wydanie go jako „aktualne dzisiaj” bez kolejnych zmian byłoby błędem. Bez nowej płatnej usługi.
