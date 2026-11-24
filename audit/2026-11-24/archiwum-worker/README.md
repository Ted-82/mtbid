# Archiwum REXBID — pakiet do odbioru

W tym katalogu znajduje się komplet źródeł potrzebnych do zbudowania osobnego archiwizatora oraz źródła i wyniki lokalnego stagingu. Produkcyjny proces aktywnych ofert jest osobnym Workerem i nie wchodzi do tego pakietu.

## Próba operacyjna

Zdalny kod archiwizatora `85aa5440-f186-43bc-ae45-f5139f381de1` (100% ruchu) i zachowana skompilowana wersja sprzed zmiany były identyczne bajt w bajt. Publiczny skrót SHA-256 zapisano w pliku [pochodzenie-wdrozenia.json](pochodzenie-wdrozenia.json). [Lista plików źródłowych i odpowiednie sumy](pochodzenie.json).

Próby uruchamiają prawdziwy harmonogram Workera w lokalnym silniku Cloudflare, z odizolowanym D1 i dwoma magazynami R2. Na wejściu jest zachowana pełna paczka 9987 z 74 550 faktycznymi zdarzeniami Apibary. Przygotowana lokalna baza szczegółów celowo zawiera 42 różne pojazdy z tej paczki. Test sprawdza każdą przekazaną cenę i VIN. Dane giełdowe i ich sekwencje są rzeczywiste. Lokalne wiersze z rokiem modelowym i zdjęcia są danymi kontrolnymi. Próba nie kontaktuje się z serwerami zdjęć ani z produkcją. Drugi scenariusz używa trzech jawnie sztucznych zmian do sprawdzenia dwóch sprzedaży jednego auta oraz uzupełnienia ceny.

| Pomiar pełnej paczki | Wersja produkcyjna na kopii | Kandydat na kopii |
| --- | ---: | ---: |
| Źródłowe wyniki zapisane w dostępnej grupie | 42/42 | 42/42 |
| Wywołania harmonogramu do zakończenia | 7 | 7 |
| Pobrania oryginalnego pliku R2 | 7 | 2 |
| Odczytane bajty oryginalnego pliku | 23 406 173 | 6 687 478 |
| Odczytane bajty głównego indeksu | 127 641 | 391 985 |
| Zapisane bajty głównego indeksu | 405 919 | 1 643 935 |
| Suma tych trzech mierzonych wielkości | **23 939 733** | **8 723 398** |
| Odczyty/zapisy w docelowym R2 | 28 / 148 | 28 / 148 |
| Pobrane próbne zdjęcia | 84 | 84 |

Nowa wersja oszczędza **63,6% zmierzonego transferu danych źródła i indeksu**. Pomocnicza lista do 115 zdarzeń znajduje się w istniejącym prywatnym indeksie. Weryfikujemy sumę kontrolną listy, tożsamość generacji oraz skrót wejściowej paczki. Uszkodzenie listy powoduje powrót do oryginału. Gdy paczka waży mniej niż 1 MiB lub tekst pomocniczy miałby być za duży w stosunku do paczki, Worker ponownie odczytuje oryginalny plik. W kontrolnej próbie małego pliku obie wersje wykonały po pięć odczytów i przeniosły tyle samo bajtów. W teście 132 zdarzeń umyślnie uszkodzono kopię pomocniczą. Weryfikacja końcowych cen przeszła, a każda pełna porcja nadal liczyła dziesięć galerii. [Pełna paczka, przed](wynik-pelna-przed.json) · [po](wynik-pelna-po.json) · [mała paczka, przed](wynik-przed.json) · [po](wynik-po.json) · [dwa wyniki jednego VIN](wynik-syntetyczny.json).

To pomiar bajtów i operacji w wybranym zakresie. Czas na produkcji zależy także od rozmiaru rzeczywistych zdjęć, opóźnień dostawcy i liczby równoczesnych żądań. Liczba wywołań harmonogramu potrzebnych do przetworzenia tej paczki pozostała taka sama. Limit dziesięciu galerii na pięć minut nadal daje najwyżej 2 880 dziennie.

## Odtworzenie

Pracę należy zacząć w tym katalogu. Zestaw wymaga Node 24, zależności są przypięte w `package-lock.json`. Standardowy tryb testowy używa silnika Miniflare z datą 1 października. Końcową próbę pełnej paczki oraz dwóch cykli powtórzono na oficjalnym listopadowym workerd, z datą zgodności 17 listopada i bez dodatkowych flag, dokładnie jak w działającej konfiguracji. [Próba pełnej paczki](wynik-zgodnosci-pelna.json) · [dwa wyniki tego samego LOT](wynik-zgodnosci.json) · [wersja i sumy kontrolne silnika](silnik-listopadowy.json).

```sh
npm ci
npm test
npm run test:cycles
node test-staging.cjs --baseline genuine
npm run build
node weryfikuj-wydanie.cjs
```

Listopadowy tryb w Windows x64 można odtworzyć przed poniższymi testami, używając `node pobierz-silnik.cjs C:/temp/rexbid-workerd`, ustawiając `MINIFLARE_WORKERD_PATH` na `C:/temp/rexbid-workerd/package/bin/workerd.exe` i `REXBID_TEST_PROD_COMPAT` na `yes`. Pobierany jest oficjalny bezpłatny plik, a dwie sumy kontrolne są sprawdzane przed wykonaniem.

Przy teście pełnej paczki podaje się lokalną ścieżkę zabezpieczonego przez REXBID pliku `9987.jsonl.gz`. Program sprawdza SHA-256 przed użyciem. Wycinek 42 zminimalizowanych zdarzeń jest w pakiecie. Pełny prywatny plik zachowuje się w miejscu istniejącej kopii. W Windows PowerShell, po podstawieniu własnej ścieżki:

```powershell
node test-staging.cjs --baseline full wynik-bazowy.json C:/kopie/9987.jsonl.gz
node test-staging.cjs ./src full wynik-kandydata.json C:/kopie/9987.jsonl.gz
```

`build.cjs` sprawdza skróty zależności i wykonuje wyłącznie lokalny `deploy --dry-run` z konfiguracją aktualnego archiwizatora. Testowy adapter `staging.mjs` i testowe dane nie wchodzą do kodu wydania. [Parametry i suma kandydata](wynik-budowy.json). Poprzednią wersję o tym samym zestawie plików można złożyć przez testowy przełącznik `--baseline`, który izoluje źródła i sprawdza sumę każdego pliku.

## Odbiór, publikacja i cofnięcie

1. Przed przekazaniem do wydania sprawdzić `node weryfikuj-wydanie.cjs`. Osobne `node weryfikuj-wydanie.cjs --live-read` przy dostępnej zmiennej środowiskowej `CLOUDFLARE_API_TOKEN` robi tylko odczyt. Wymaga zgodności aktywnego wydania, bajtów kodu, daty zgodności, nazw zasobów, ustawienia włączenia i harmonogramu. Każda rozbieżność oznacza konieczność ponownego złożenia kandydata z aktualnego źródła.
2. Przed decyzją produkcyjną operator zapisuje bieżący główny indeks z etagiem, listę wskazywanych niezmiennych segmentów, wersję Workera i stan kursora. Publikacja następuje wyłącznie po akceptacji właściciela, na istniejącym Workerze archiwum i z jego dotychczasowymi zasobami.
3. Po publikacji sprawdzić przesunięcia kursora dwóch porcji, ceny i galerie znanych VIN, brak wzrostu błędów oraz zapas lokalnego budżetu. Kryterium cofnięcia stanowi utrata opublikowanych wyników, pomieszany VIN/cykl/cena, błąd odczytu indeksu lub brak postępu pomimo kwalifikującej się paczki.
4. Cofnięcie wydania Workera do zapamiętanej wersji nie usuwa galerii. Nie przywracać starego indeksu w ciemno po nowych zapisach. Przy błędnym wpisie zachować późniejsze galerie i odtworzyć konkretne metadane po niezależnej kontroli. Test odwrotnej łatki odtworzył bajty trzech zmienionych plików. [Test rollbacku](../archiwum-regresja-i-rollback.json)
