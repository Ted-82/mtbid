# Świeży katalog i ciągła synchronizacja — stan 1.11.2026

Stan: **kod wdrożony; pełny świeży katalog nadal oczekuje na źródło od Apibara**. Nie jest to odbiór synchronizacji end-to-end.

## Ukończone i sprawdzone

- 2173/2173 testów repozytorium oraz 8/8 prywatnego operatora. Niezależny review publicznej listy, kart, cache i paginacji:64/64 PASS; bundling obu publicznych Workerów bez Node.
- Migracja0014 na staging/produkcji: trzy dodatkowe tabele baseline/membership/pointer, wskaźnik NULL/revision0. TimeTravel przed zmianą; osiem tabel kont/realizacji bez zmian, FK bez błędów. Nie usunięto starego katalogu ani historii.
- Import pełnego zrzutu wznawialny, weryfikacja całego gzip/SHA/liczby rekordów i źródła przed pierwszym zapisem, membership z kanonicznym checkpointem w jednej transakcji. Poprawne nowsze dane są chronione; odrzucone/niejednoznaczne rekordy wymagają przeglądu dokładnego zbioru.
- Odtworzenie całego zachowanego pliku do nowego baseline bez transportu API, 128 bucketów, do40 hydracji/3partii/8bucketów na wywołanie; ograniczone dowody/CAS. Mały rzeczywisty prefiks API jest dopuszczony wyłącznie z pełnym dowodem ciągłości.
- Aktywacja operatora wymaga faktycznie zweryfikowanego UUID/nazwy D1 i właściwego zakresu. Jednoczesny wybór baseline + globalnego kursora dopiero na końcu rzeczywiście odtworzonego pliku. Normalny Worker uznaje dokładne pokwitowanie aktywacji i kontynuuje membership; stare pending/raw/liczniki pozostają.
- Publiczne listy/taksonomia/paginacja/cache uwzględniają rewizję wskaźnika; szczegóły/historia pozostają osiągalne. Oferta poza baseline ma oznaczenie archiwalne i nie udaje aukcji live. NULL zachowuje dotychczasowy katalog częściowy. Kanoniczne upserty mogą w nim pojawiać się stopniowo przed przełączeniem; nie obiecujemy niewidoczności wszystkich danych w czasie importu.
- Produkcyjny HTTP i przeglądarka: tylko rocznik od/do działają, odwrotny zakres400; katalog→karta i panel200, prywatne strony no-store. To weryfikacja działania wdrożenia, nie nowego zrzutu.

## Wdrożenia

- rexbid.pl/public: 8be47a98-788c-49b5-aceb-ea4e03cc53f2
- prywatny executor: 8a264894-32ba-4ba5-85a5-dfb0c6661649
- pobieranie/queue: 1737688d-7fbe-4ba7-ae3d-2b7c9cce84d9
- staging public89bee177-3976-4bab-82ab-467e698a9845, executor8331761e-f759-4fe6-af2a-1c78891372ed, capturecf858566-90a8-4b8b-8f0e-58285d34bb4f. StagingCron[]/kolejka wstrzymana nadal.
- Flaga membership enabled, aktywny wskaźnik NULL, globalny kursor46465827; nie przełączono katalogu ani nie skasowano luki. Produkcyjna kolejka wznowiona, Cron5/15min zachowany.

## Dostawca i brakujące źródło

Właściciel osobno zatwierdził wysłanie prośby do pomocy Apibara. Odpowiedź w Sync Center potwierdza jednorazowy świeży Open+Live JSONL.gz bez dopłaty/bez zużycia zwykłej puli API, bez usuwania feed20, zmiany permanentURL/tokena, harmonogramu30min lub planu. Potwierdzenie rozpoczęcia zostało wysłane i zachowało się po ponownym otwarciu czatu. Dopytano o postęp. **Nie otrzymano jeszcze nowego generationID, punktuN, czasów i linku ani potwierdzenia rozpoczęcia.** Nie oznaczać starego4548 jako świeżego; nie wyliczaćN z dat/generationID. Prywatny zapis czatu poza repo.

## Koszty i ochrona

Brak nowej usługi/abonamentu/opłaty. Workers5+Apibara70+ResendFree0=75USD/mies. osobnoOVH/tax/FX/metered excess. Pomiar2026-11-01T11:54:23.882Z: ostatnie31dni 10652738 zapisów i3806986140 odczytów, zapas do włączonych50Mwrite=39347262. To pomiar, nie twardy limit całej faktury.

Normalny importer1Mwrite/50Mread dziennie bez zmian. Dawny wyjątek12Mwrite/200Mread NIEZATWIERDZONY/OFF. Jednorazowy operator świeżego zrzutu ma przygotowany opcjonalny dowód pracy w opłaconym pakiecie (6Mwrite/200Mjobread, do1Baccountdayread ze względu na odczyty publicznej strony), lecz **nie uruchomiono go ani nie utworzono rzeczywistego budżetu**. Wymaga konkretnego nowego źródła, świeżego pomiaru headroom, dokładnych SHA i dziennika bez resetów. Nie rozszerzać starej puli12kAPI poza jej zamrożony cel.

## Zamknięta ścieżka odbioru — następne czynności

1. Odebrać nowy plik i autentyczny checkpointN sprzed generacji; przypiąć źródło/hash/generation/times. Pobranie nie jest importem.
2. Streaming intake do prywatnego folderu; cały plik/manifest/identyfikatory, zakresy źródła i dokładny zbiór odrzuceń. Nie używać hardcodedoperator4548.
3. Mały stagingimport/próbka, koszt rzeczywistych partii, potem pełny zweryfikowany import; odtworzyć cały plikN→T, seal i aktywacja, sprawdzić publiczne wyniki oraz izolację archiwum.
4. Przed produkcyjnym importem: aktualny backup/bookmark, zatrzymanie WYŁĄCZNIE wykonywania kolejki D1, poczekać na cudzą lease; captureCron dalej zabezpiecza R2. Przypiąć expectedRemote po pause. Dziennik budżetu/progress i wznowienia bez zerowania; własny lease odnawiany, cudzego nie przejmować.
5. Po odtworzeniu do rzeczywistego końca plikuT atomowo aktywować baseline/kursor; wznowić normalny automat. Wymaga dwóch kolejnych rzeczywistych plików zastosowanych do końca i porównania ofert/cen/terminów z własnymi surowymi źródłami.
6. Dopiero te dowody zamykają etap aktualnego katalogu. Dotychczasowy kod nie gwarantuje nieprzerwanej pracy bez błędów/limitów dostawcy; każdy brak ciągłości musi być widoczny, a raw chroniony.

Dowody lokalne: C:/Users/nowic/Documents/Codex/REXBID_BOOTSTRAP_20261101/. Operator i schemat wejścia są w tym folderze, defaultdry-run bez sesji/sieci. READMEoperatora opisuje stop po nieznanym zapisie oraz porównanie danych klientów. Rollback na obecnymNULL: poprzednie kompatybilne wersje kodu w production-release-before.json; nie odtwarzać całej D1 nad nowszymi danymi. Po aktywacji wymagany kod zgodny z membership/pokwitowaniem; cofnięcie pointera nie cofa kanonicznych cen ani globalnego kursora.


## Punkt wznowienia 4.11.2026 — swieze zrodlo odebrane, import jeszcze niewykonany

Apibara potwierdzila w czacie zrzut feed20 generation8731: 215470 Open+Live, checkpoint N=61093436 sprzed generacji, start2026-11-04T08:44:28Z, ready09:04:45Z, zachowanie feedu/permanentURL/30min/Pro, bez nowej oplaty. Po odswiezeniu panel ponownie DURABLE CURSOR; przejsciowy RECONCILIATION nie jest juz stanem biezacym. Zachowano rzeczywista odpowiedz dostawcy i screenshot poza repo.

Pobrano i zabezpieczono SHA-pinned oba oryginalne gzip w Documents/Codex/private-data/rexbid-fresh-bootstrap-20261104. Pelny odczyt gzip/JSON oraz istniejacy inspectFeedFile PASS: snapshot8731 200933802B compressed/2574422400B expanded, 215470 rekordow (Copart145742/IAAI69728), wszystkie updated_at, zakres2026-05-20T11:20:28.000Z..2026-11-04T09:04:30.000Z. 1865 unresolvedVins wymaga normalnej jawnej polityki rozstrzygania; nie sa uprawnieniem do pomijania/naprawiania VIN. Snapshot SHA d4da3d208c715cf47864e25fea51f629d199001f8268a8df4a24600a88f21b7e.

Rzeczywista paczka8741 takze pobrana/zweryfikowana kontraktem: 46500 zdarzen, sequence61093437..61139979, porzadek rosnacy/unikalne event_id, SHA a121077d9b3020296c1d7e4facf66329d569ce54181a8c19a0017ff05f163f54. Dostawca potwierdza cursor_start61093436/end61139979 i dostepnosc zmian podczas generacji. 43 nieuzyte numery w zakresie nie dowodza same w sobie utraty zdarzen; wyslano jedno doprecyzowanie semantyki oraz dokladnego UTC capture timestamp N (nie podano go jeszcze osobno). Nie wymyslac czasu capture.

Nie wykonano DB importu/replay/aktywacji, nie zmieniono limitow lub harmonogramu, nie zerowano kursora/licznikow i niczego nie zakupiono. Produkcyjny kod f701ed72-d4db-4743-a7d8-529fa92f9fbd bez zmian. Dowody: provider-source-confirmation-8731-20261104.*, snapshot-8731-verified*.json, replay-8741-verified*.json, provider-source-followup-8731.* i stage-checkpoint.json w C:/Users/nowic/Documents/Codex/REXBID_BOOTSTRAP_20261101/.

Nastepne: przypiac autentyczne fakty w planach/manifescie, uzupelnic tylko brakujace metadane bez ich wymyslania, staging import/przeglad odrzucen/replay; przed produkcja swiezy backup i pomiar headroom, pause tylko executor queue przy zachowaniu capture, import/replay/aktywacja w przygotowanej procedurze; odbior dwoch kolejnych zastosowanych plikow. Pobranie i walidacja nie oznaczaja aktualnego katalogu na rexbid.pl.

---
