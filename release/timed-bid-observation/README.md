# Cena IAAI Timed w ostatniej paczce

Poprawka obejmuje publiczny odczyt Timed oraz istniejącego wykonawcę paczek. Zmiana kwoty powstaje w procesie importu. W katalogu obok znajduje się pojedyncza migracja dodająca opcjonalną kolumnę tekstową do istniejącej tabeli. Publiczny kod wykorzystuje dotychczasowe R2 i aktywny katalog D1.

## Odtworzenie próby

Test odtwarza rzeczywiste zdarzenie sekwencji 118801774. Skrypt sprawdza sumy SHA-256 dwóch modułów wejściowego wykonawcy. Zalecana wersja wejściowa Roboczej kopii wykonawcy ma identyfikator wdrożenia 11ee319d-be35-47c4-a06f-49da0464ae98. Pełny kod wykonawcy znajduje się w katalogu master-rollout-runtime-20261124/executor. Skrypt składa jego moduły z nakładką executor w katalogu tymczasowym i uruchamia istniejące oraz nowe testy w izolacji. Nowy test ładuje publiczny czytnik z katalogu release/public-site.

```powershell
node prepare-test.cjs C:/Users/nowic/Documents/Codex/REXBID_BOOTSTRAP_20261101/master-rollout-runtime-20261124/executor
```

Dodatkową próbę obsługuje lokalny silnik Cloudflare z D1 i R2, przy zablokowanym ruchu z Workera do dostawców. Zależności i sprawdzony silnik w tej przestrzeni są opisane w [pakiecie testów archiwum](../../audit/2026-11-24/archiwum-worker/README.md).

```powershell
$env:NODE_PATH='C:/Users/nowic/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules'
$env:MINIFLARE_WORKERD_PATH='C:/Users/nowic/Documents/Codex/REXBID_BOOTSTRAP_20261101/master-audit-20261124/evidence/archive-workerd-20261124/package/bin/workerd.exe'
node tests/local-worker.cjs "$env:TEMP/rexbid-timed-proof-result.json"
```

## Wydanie po zgodzie na produkcję

1. Zweryfikować wdrożoną wersję wykonawcy i serwisu publicznego. Zachować identyfikatory obu wydań, aktualne powiązania D1 oraz R2, harmonogramy i punkt Time Travel. Sprawdzić zapas odczytów i miejsca w bieżącym okresie rozliczeniowym. Porównać obie sumy źródeł z source-sha256.json. Jeżeli inna poprawka modyfikowała te same pliki, złożyć zmiany i ponowić testy.
2. W odizolowanym stagingu powtórzyć testy z jego bazą. Następnie dla zaakceptowanego wdrożenia zaaplikować pojedynczy ALTER TABLE po sprawdzeniu PRAGMA table_info. Wdrożenie byłoby addytywne. Zachowanie istniejących danych potwierdzić kontrolą dwóch przykładowych rekordów i próbą odczytu.
3. Wykonawcę z nakładką uruchomić w jego istniejącej usłudze. Przy następnej pierwotnej zmianie ceny zgodnego IAAI Timed zapisze kwotę i jej dowód w tym samym UPDATE oraz transakcji z kursorem. Publiczny Worker rexbid-production-preflight z modułami sync/timed-iaai-read.cjs, sync/timed-bid-read.cjs i sync/timed-iaai-refresh.cjs zawiera zarówno czytnik, jak i cykliczne tworzenie pliku. Zgodność z dotychczasową migawką schematu 1 sprawdzono w testach. Producent utrwala identyfikator cyklu podany przez źródło, kiedy jest dostępny.
4. Odebrać na dwóch kolejnych opublikowanych paczkach rzeczywistą zmianę na poziomie pola. Porównać platformę, LOT, VIN, cykl, termin, sekwencję, czas i kwotę w pliku z D1, kartą po VIN/LOT oraz listą. Przy niezmienionej cenie odnotować brak próbki i poczekać na pierwszą nową zmianę. Dla tej paczki z 24 listopada wpis już przeszedł bez nowej kolumny. Bieżące działanie zaczyna się od nowej zmiany i nowych migawek. Zapisywanie sztucznej ceny, przewijanie kursora i ręczne odtwarzanie katalogu są zbędne.
5. Cofnięcie wydania polega na powrocie do wcześniejszych identyfikatorów obu Workerów. Poprzedni kod pomija dodaną kolumnę. Przy zwykłym wycofaniu pozostawić jej wartości, dane klientów i aktualne kursory. Przywracanie całej D1 z kopii wymaga osobnego zdarzenia utraty danych i oceny wpływu na późniejsze zapisy.
