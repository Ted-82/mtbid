# Weryfikacja ponownie wystawionych pojazdów

Nakładkę `executor/` składa się z pełną kopią źródeł wykonawcy odpowiadającą wdrożeniu `11ee319d-be35-47c4-a06f-49da0464ae98`. W archiwum roboczym jest to `master-rollout-runtime-20261124/executor`. Umieszczony tu moduł obsługuje zwykłe aukcje Copart i IAAI. Dowód historyczny zawiera jawne dane pojazdu i pochodzi ze źródła i publicznego katalogu.

## Uruchomienie na kopii

1. Skopiuj pełne drzewo źródeł potwierdzonej wersji do nowego katalogu. Zastosuj pliki z nakładki z zachowaniem ścieżek. Zachowaj osobny katalog bazowy do porównania.
2. Uruchom `node --test tests/feed-known-relist.test.cjs tests/feed-sparse-repair.test.cjs tests/feed-iaai-rescheduled-reset.test.cjs`. Integracja używa SQLite w pamięci, schematów aplikacji, pełnych transakcji i odpowiedzi utrwalonych podczas odczytu Apibary. Próba techniczna wykorzystuje wejście z normalnej kolejki. Lokalny test ma własną bazę.
3. Na osobnym stagingu upewnij się, że proces zapisu korzysta z osobnych D1, kolejki i R2. Proces ma sprawdzanie tożsamości wiązań. Próba na danych zapisanych jako przykłady może korzystać z lokalnego Workers i izolowanej bazy. Ustawienie nazwy stagingu przy wiązaniu z D1 produkcji nie zapewnia izolacji.
4. Odzysk z już zapisanych paczek jest jednorazową opcją wykonawcy. Dla tej kontroli użyj `REXBID_FEED_RELIST_REVIEW_GENERATION=23248`, `REXBID_FEED_RELIST_REVIEW_THROUGH=23316` i `REXBID_FEED_RELIST_REVIEW_START_BUCKET=72`. Przegląd czyta wszystkie zachowane generacje zakresu w kolejności sekwencji w danej partycji, następnie przechodzi do następnej z 128 partycji. Brak manifestu lub przerwa sekwencji zatrzymuje wyłącznie ten przegląd i zostawia przyczynę w jego potwierdzeniu. Bez dowodu zostaje zachowana dotychczasowa widoczność oferty.
5. Standardowa obsługa przyszłych zdarzeń działa przy już używanej opcji `REXBID_FEED_OPEN_COVERAGE=enabled`. Nowe zmiany trafiają do kolejki z tego samego zatwierdzenia transakcji co import. Rozstrzygnięcie sprawy następuje w wolnym przebiegu automatu lub po zakończeniu pliku z wykorzystaniem istniejącego mechanizmu liczenia wszystkich wywołań dostawcy.
6. Przy odbiorze na serwerze porównaj źródłowy numer paczki i sekwencję, najnowszy zakończony plik, wynik wyszukiwania po VIN i LOT, zachowaną historię oraz dwie kolejne dostawy. Bieżące i potwierdzone ceny zakupu oceniaj osobno.

## Zachowanie przy awarii

Dla wcześniej zakończonego, rozpoznanego pojazdu przyszły termin planuje sprawdzenie pełnej oferty. Odczyt po LOT wymaga zgodności platformy, LOT i VIN. W przypadku innego rekordu lub odpowiedzi 404 wykonawca może wykorzystać jeszcze jeden liczony odczyt po VIN. Oba wyniki wymagają tej samej zgodności. Odczyt źródłowy sprzeczny z następnym terminem, bez potwierdzenia stanu lub ze starszą wersją danych pozostawia ofertę do weryfikacji. Nowsze zdarzenie kończące i nowszy zapis w katalogu mają pierwszeństwo. Istniejąca kwota wyniku w bieżącym rekordzie, której utrwalenie osobno wymaga sprawdzenia, pozostaje chroniona.

Każde zadanie dotyczy jednej platformy i jednego LOT. Odrębny zakres kluczy w istniejącej tabeli utrwala sprawy nawet przy 128 oczekujących zadaniach standardowego uzupełniania ofert. Wyczerpanie budżetu wstrzymuje potwierdzenia źródłowe. Ponowne uruchomienie kontynuuje zapisane zadania. Potwierdzenie dla tej samej sekwencji eliminuje ponowne odpytywanie i zapis. Późniejszy sygnał umożliwia nowe sprawdzenie.

Dla dotąd nieznanego pojazdu przyszły termin kwalifikuje sprawę do pobrania kompletnego rekordu z taką samą kontrolą tożsamości i wyniku. Pełny rekord wchodzi przez istniejący mechanizm zapisu nowych ofert. Dla rekordów już obecnych potwierdzenie zapisuje zakres zweryfikowanych pól i chwilę sprawdzenia. Cena bieżąca, cena Kup teraz i cena sprzedaży mają osobne znaczenie. W tym źródle REST wartość zerowa wskazanych kwot nie stanowi rzeczywistej kwoty według schematu PricingInfo dostawcy. Informacji podanej bezpośrednio przez aktualną obserwację Live nie przetwarza ten moduł. [Schemat dostawcy](https://apibara.tech/openapi/v1.json)

W próbie z 24 listopada cztery godziny IAAI zostały skorygowane dopiero w późniejszych paczkach 23271 i 23316. Rekordy przeszły zwykłe wyszukiwanie na izolowanej D1 po ponownym przyjęciu wszystkich dowodów. [Pomiary i zakres odbioru](../../audit/2026-11-24/NAPRAWA-PONOWNYCH-AUKCJI.md)

## Ograniczenia i rollback

Przegląd zachowanych plików odczytuje wybraną generację ze składu R2. Zniknięcie manifestu lub przerwanie zapisu wymaga odczytu statusu pracy. Jedna weryfikacja obsługuje aukcję z regularnym terminem. Inne przypadki, np. Timed Auction, pozostają w obecnej obsłudze.

W razie regresji zatrzymaj przegląd zaległej generacji przez usunięcie jego opcjonalnego ustawienia i przywróć poprzednią wersję wykonawcy. Zapisane już potwierdzenia i dane zachowaj. Porównaj stan pojazdów przy użyciu historii, identyfikatora sekwencji oraz kopii sporządzonej przed ewentualnym wdrożeniem produkcyjnym. Powrót oprogramowania nie cofa transakcji danych. Przy migracji środowiska potwierdź działanie normalnego harmonogramu i konsumenta kolejki poprzez obserwację kolejnych rzeczywistych paczek.
