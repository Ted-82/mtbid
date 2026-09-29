# Konwencje nazewnictwa Rex.Bid

## Nazwy produktu i kodu

- Publiczna marka: **Rex.Bid**. W znaku graficznym zapis `REX` jest biały, a `.Bid` żółty.
- Krótki identyfikator techniczny: `rexbid`.
- Nowe nazwy klas, zmiennych, plików CSS/JS i selektorów powinny używać prefiksu `rexbid-`, gdy prefiks jest potrzebny.
- Widoczne teksty, tytuły, metadane i dokumentacja produktu używają `Rex.Bid`; nie używają dawnych nazw jako marki.

## Legacy identyfikatory zachowywane celowo

Poniższe identyfikatory są związane z istniejącą infrastrukturą, kompatybilnością lub historią. Nie zmieniać ich w zwykłej pracy nad brandingiem:

- Cloudflare production Worker `mtbid` i jego obecny `workers.dev` origin.
- Produkcyjna D1 `rexbid-db`, jej ID, istniejące klucze i historia migracji.
- Staging Worker/D1 `rexbid-auth-test` / `rexbid-auth-test-db` oraz ich originy i callbacki.
- Legacy localStorage key `mtbid_favorites`, potrzebny do migracji lokalnych ulubionych.
- Repozytorium GitHub `Ted-82/mtbid`, istniejące Git references/commits i nazwa archiwalnego pliku ignorowana przez `.gitignore`.
- Lokalny fallback session-secret `mtbid-local-development-secret-change-me`: zachować kompatybilność istniejących lokalnych sesji; produkcja/staging muszą używać skonfigurowanego sekretu.

Originy, callback URL-e, canonical URL-e, Worker/D1 nazwy i identyfikatory zmieniać wyłącznie w osobnej, skoordynowanej migracji domeny/środowiska, z aktualizacją allowlist, konfiguracji, testów, SEO i procedury rollback.

`stona_auta-www` występuje w lokalnej ścieżce checkoutu, której nie zmieniamy. Nazwa metadanych pakietu npm została ujednolicona do `rexbid`; ścieżka katalogu repozytorium pozostaje nietknięta.
