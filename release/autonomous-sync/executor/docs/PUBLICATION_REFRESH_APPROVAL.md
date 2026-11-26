# REXBID — zatwierdzone odświeżenie i przygotowanie publikacji

**2026-10-08: APPROVED — maksymalnie 1000 requestów Apibara łącznie na cały bieżący etap, retry 0.** Właściciel jawnie zastąpił niezatwierdzony plan 64 requestów. Kontynuacja aktualnego projektu od checkpointu `6457d52742ec80e96caa095767c0ea69be2d3aa0`, z zachowaniem późniejszych zmian. Ten zatwierdzony zakres jest nadrzędny wobec historycznej propozycji z 7 października zachowanej poniżej.

## Zamknięcie wykonania — 2026-10-08

**Wykorzystano56/1000 prób, Copart25/IAAI31, retry0; kampania STOP, bez dalszego transportu.** Bramka2stron/40activePASS,55commitów/1100obserwacji. 1059nowych ofert,39wcześniejznanychLOTodświeżonych w listach. Publikacyjna i stagingD1:840/798listings,1682snapshots,1363media,1098dzisiejszychactive. Przy drugiej stronie IAAITimed200 nie potwierdzono D1commit; po leaseodzyskano stanD1_STATE_WRITE_INTERRUPTED, cursor/budgetzachowane. Dokładny pierwotny błąd nie zachowany; nie zgadywać. campaign-stop.json pozostaje aktywny. Staginge4e54eaa-3438-4619-a4c4-aa6648262afb,812/812PASS i realdesktop/mobileQA. [Pełny wynik](PUBLICATION_REFRESH_QA_2026-10-08.md).

Poniższa kolejność opisuje zatwierdzony plan historyczny; **nie jest poleceniem dalszego wykonania po STOP**. Publikacja i DNS nadal wymagają osobnej zgody.

## Aktualne upoważnienie i trwały budżet

- Kampania operatora: **publication-20261008**. Odseparowany target pozostaje **rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d**. Przed transportem wymagane są sprawdzona tożsamość rzeczywistego zasobu, backup i kontrola odtwarzalności oraz poprawny preflight atomowego zapisu.
- **Globalne twarde maksimum: 1000**, wspólne dla obu platform i wszystkich operacji etapu. Trwała rezerwacja następuje przed każdą próbą; licznik i checkpoint są zapisane w D1. Restart lub wznowienie używa tej samej kampanii i nie tworzy nowej puli.
- Dodatkowy twardy limit platformy: **Copart 650 / IAAI 650**, zawsze pod limitem globalnym 1000. Nie oznacza to upoważnienia do 1300. Podział zależy od wyników; dostępna pula jest maksimum, nie celem do wykorzystania.
- Limit obejmuje każdą próbę sieciową Apibara, także błędy, timeouty, ewentualne ponowienia oraz QA wywołujące providera. **maxAttempts=1, automatyczne retry=0**. Rozliczenie łączy trwały ledger D1 z transport-ledger.ndjson; QA bez providera nie zużywa tej puli.
- Bez zakupu, zwiększenia abonamentu, obchodzenia ograniczeń lub zmiany publicznych limitów w celu wykonania operatorowego przebiegu.

## Bramka dwóch pierwszych stron — PASS, wynik po bramce

Po backupie i preflight pobrano jedną stronę Copart oraz jedną IAAI. Kontrola odpowiedzi, dokładnej platformy/LOT, zapisu i direct readback przeszła; **2 rzeczywiste requesty, 40 potwierdzonych aktywnych ofert w odpowiedziach bramki (20+20), retry 0**. Po bramce duplikaty i FK violations=0; tabele prywatne odseparowanej D1 pozostają puste. Oba scope mają status partial i zachowane osobne cursory. To wynik pierwszych dwóch stron, nie końcowy rozmiar ani pełne pokrycie katalogu.

Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_REFRESH_GATE_20261008.log`, `REXBID_REFRESH_PREFLIGHT_20261008.log`, `REXBID_REFRESH_BEFORE_RESTORE_20261008.json` oraz katalog `REXBID_REFRESH_20261008/` z gate/preflight/run receipts i transport-ledger.ndjson. Wartości sekretów nie są częścią raportu. Po poprawnej bramce kontynuacja jest już autoryzowana i nie wymaga kolejnej zgody właściciela między poprawnymi partiami.

## Bieżąca kolejność operatora

1. Kontynuować aktualne listy obu platform z filtrem `lot_sub_status=Open`, `upcoming=all`, przy obecnym adapterowym `per_page=20`, zachowując scope/cursor kampanii. Każda atomowo zapisywana partia ma **maksymalnie 4 strony**. Najbliższy plan to do 20 dalszych stron Open na platformę, pod warunkiem poprawnych odpowiedzi, dalszej paginacji i dostępnego wspólnego budżetu.
2. Po wynikach Open dobierać priorytetowe znane LOT-y oraz warunkowe uzupełnienia Timed, Kup teraz i Elektryczne. Oddzielny filtr ma własny scope/cursor. Nie pobierać ponownie zakresu, który zapewnia już użyteczne potwierdzone pokrycie; nie zakładać dostępności kategorii tylko z obecności ceny lub nazwy modelu.
3. Szczegóły i media pobierać dla exact LOT-ów wtedy, gdy poprawia to ofertę; preferować URL-e już obecne w list/detail. Zachować historię istniejących obserwacji. Nie pobierać masowo zakończonych aukcji ani dodatkowej historii bez celu dla tego etapu.
4. Po poprawnej partii kontynuować samodzielnie. Przy końcu scope, wystarczającym pokryciu lub wykorzystaniu limitu części zakończyć tę część. Nigdy nie deklarować pełnego rynku na podstawie ograniczonej liczby stron.
5. Przy błędach autoryzacji, rate limit, mismatch tożsamości, niebezpiecznej odpowiedzi lub błędzie zapisu zatrzymać transport, zachować checkpoint/ledger i wykonywać niezależną pracę. Obecny runner stosuje konserwatywny STOP także przy 404, timeout i 5xx; 404 zachowuje poprzednie obserwacje i nie fabrykuje ended. Brak automatycznych ponowień.

Aktualizacja odbywa się po platformie i LOT, z prawdziwymi datami obserwacji i historią. Brak nowej ceny nie przenosi starej kwoty pod nową datę. Active, ended i unknown pozostają odrębne; nieweryfikowana dostępność nie jest aktywną ofertą. Media bez dostępnego zdjęcia otrzymują czytelny stan zastępczy. Końcowe zużycie, counts i zakres odświeżenia zostaną podane po zakończeniu kampanii, a nie przewidywane z limitu.

Po kontroli danych zatwierdzony etap obejmuje aktualizację katalogu stagingowego i wdrożenie gotowych lokalnych poprawek, z zachowaniem stagingowych kont, MFA, ulubionych, realizacji, wiadomości i plików. Dane klientów nie są importowane do D1 publikacyjnej. Sprawdzenie desktop/mobile oraz rzeczywistej ścieżki Home→kategoria→filtry→VIN/LOT→karta→galeria→kalkulator→powrót należy do bieżącego QA. Unread na dwóch istniejących kontach wykonuje się przy dostępnych sesjach; brak loginów pozostawia jeden krótki ręczny test i nie blokuje katalogu.

Pierwsza przygotowana publikacja obejmuje katalog, karty, obserwacje historii, Calculator V4, lokalne ulubione i kontakt. Produkcyjne Auth, portal, załączniki, Cron i automatyczny fallback do providera pozostają OFF. Podłączenie rexbid.pl/www, DNS i nameservery nadal oczekują osobnego okna; nie modyfikować mtbid ani jego produkcyjnej D1, bez pusha i aktywacji płatnych usług. Aktualne dowody DNS: [DNS_READINESS_REFRESH_2026-10-08.md](DNS_READINESS_REFRESH_2026-10-08.md). Runbook i handoff aktualizuje główny operator etapu.

---

## Archiwum planu z 7 października — SUPERSEDED / NIEAKTYWNY

**Cała poniższa propozycja 64, jej podział 32/32, status NOT APPROVED i opisy przyszłej aktywacji dotyczą historycznego przygotowania. Nie obowiązują w zatwierdzonej kampanii publication-20261008.** Zachowano je jako historię projektu, wraz z wcześniejszym opisem mechanizmu i ręcznym testem unread; nadrzędne są aktualne upoważnienie i limity powyżej.

# REXBID — świeży katalog przed pierwszą publikacją

**2026-10-07. PROPOSAL — NOT APPROVED / NO LIVE API CALLS.** Kontynuacja `e00604f408efd3e7de7eecb1b3ebe2ddc4fb7986`. Propozycja właściciela „do rozważenia 200” nie jest upoważnieniem do pobrania danych. Ten etap nie wywołuje endpointów danych Apibara, nie zapisuje danych zdalnych i nie zmienia publikacji/DNS.

## 1. Źródła i rozdzielenie operacji

Sprawdzono [oficjalną dokumentację](https://apibara.tech/en/products/vehicle-auction-data-api/docs), [OpenAPI v1](https://apibara.tech/openapi/v1.json) (odczyt 7.10.2026, `info.version=1.1.0`) oraz rzeczywisty `providers/apibara.js`. Publiczny odczyt dokumentacji nie używa API key i nie jest live wywołaniem endpointu danych.

- **Odkrywanie / odświeżenie strony listy:** `GET https://apibara.tech/api/v1/vehicle-auction/vehicles`. Jedna odpowiedź zawiera do 20 rekordów przy obecnym adapterze. Nowe `(platform, LOT)` otrzymują initial observed snapshot; już znane są aktualizowane bez duplikatu. Brak LOT-u na częściowej stronie nie potwierdza zakończenia ani usunięcia aukcji.
- **Odświeżenie konkretnego znanego LOT-u:** `GET …/vehicles/{identifier}`. Preferować zapisany, zwrócony przez providera identyfikator/slug; wynik musi ponownie potwierdzić dokładną platformę i LOT. Sam VIN nie upoważnia do aktualizacji innego wpisu/relistingu. Inny wynik, 404 lub błąd nie oznaczają „sprzedano”.
- **Późniejsze incremental:** list + `updated_within_minutes` (1–525600). Dokumentacja opisuje rekordy z `updated_at` zmienionym w tym oknie. Filtr nie oznacza listy wszystkich nadal aktywnych aukcji i nie jest dowodem zakończenia znanych, nieobecnych rekordów. Pierwszy świeży zakres nie użyje tego filtra; później wymagane będzie okno z nakładką i własny checkpoint.
- **Media:** wykorzystywać URL-e obecne w list/detail. Osobne detail enrichment tylko jeśli wcześniejsza odpowiedź nie dostarczyła wymaganych mediów. Nie pobierać binarnych zdjęć.
- **Historia:** istniejące snapshots zachować. Nie potrzeba dodatkowych `/history` do tego celu; nowy snapshot to obserwacja, nie potwierdzona sprzedaż. Nowe opcjonalne `include=history,vin_lots` z OpenAPI nie są obsługiwane przez obecny adapter i nie będą użyte bez osobnej implementacji/regresji.

OpenAPI opisuje plan-dependent `per_page` (20/30/40), ale adapter ma twarde 20. Nie zwiększamy go na podstawie samej dokumentacji. Nie znaleziono udokumentowanego batch odczytu listy LOT-ów. Pełne odświeżenie 579 znanych wpisów po jednym detail wymagałoby co najmniej 579 requestów, więc nie mieści się w propozycji 200.

## 2. Proponowany budżet: maksymalnie 64, nie 200

**Do zatwierdzenia: 64 rzeczywiste requesty łącznie, maksymalnie 32 na platformę; automatyczne ponowienia 0.** To limit, nie cel do wykorzystania. Błędy i timeouty po rozpoczęciu fetch również zużywają budżet. Każde przyszłe ponowienie musiałoby mieć osobną zgodę i zmieścić się w tym samym limicie — nie otrzymuje dodatkowej puli.

| Operacja / parametry | Copart | IAAI | Razem / maksymalny rezultat |
| --- | ---: | ---: | --- |
| `/vehicles?platform=…&lot_sub_status=Open&upcoming=all&per_page=20` | 10 stron | 10 stron | 20 requestów / do 400 rekordów |
| `/vehicles?platform=…&lot_status=Buy%20Now&lot_sub_status=Open&upcoming=all&per_page=20` | do 2 stron | do 2 stron | do 4 / 80 rekordów |
| `/vehicles?platform=…&lot_status=Timed&lot_sub_status=Open&upcoming=all&per_page=20` | do 2 stron | do 2 stron | do 4 / 80 rekordów |
| `/vehicles?platform=…&fuel_type=Electric&lot_sub_status=Open&upcoming=all&per_page=20` | do 2 stron | do 2 stron | do 4 / 80 rekordów |
| `/vehicles/{identifier}` — priorytetowe znane, nadal nieodświeżone LOT-y | do 12 | do 12 | do 24 zweryfikowanych wpisów, także zakończonych jeśli source to potwierdzi |
| `/vehicles/{identifier}` — wyłącznie potrzebne uzupełnienie mediów | do 4 | do 4 | do 8 wpisów; pomijane po wcześniejszym uzupełnieniu |
| **Twardy limit** | **32** | **32** | **64, w tym retry 0; history/filter/related/shipping 0** |

Kategorie są opcjonalnymi uzupełnieniami, a nie ponownym pobieraniem wszystkich stron. Jeśli podstawowe strony zapewnią wystarczające potwierdzone oferty danej kategorii (co najmniej 4, z URL-em zdjęcia, gdy dostępny), odpowiednią pulę pomijamy. Jeśli provider nie zwraca Timed/EV/Buy Now, zostaje uczciwy pusty stan. EV nadal wymaga jednoznacznego source Electric/BEV; nie klasyfikujemy po modelu.

Do 640 wyników listy to górna granica **przetworzonych rekordów**, nie obietnica 640 unikalnych nowych aut. Kategorie mogą się pokrywać. Wpisy nieodświeżone w tym przebiegu pozostają zapisanymi starymi obserwacjami i nie trafią do sekcji aktualnych na podstawie samego importu. Nie obiecujemy pełnego rynku ani potwierdzenia aktualności wszystkich 579 poprzednich LOT-ów.

## 3. Kolejność i zatrzymanie

1. Po zgodzie: świeży backup odseparowanej publikacyjnej D1 i read-only preflight identity/schema/private counts, sprawdzenie dostępnej puli Apibara bez ujawnienia klucza. Cel **wyłącznie** `rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d`. `mtbid`, `rexbid-db` i staging bez zapisów.
2. Początkowy gate: jedna strona Copart + jedna IAAI z podstawowej puli. Po każdym fetch policzony ledger; po zapisie direct readback tożsamości, observation time, snapshot, cursor i budget. Przy błędnej strukturze/identity/niezgodnej semantyce STOP, bez dalszego wykorzystania limitu.
3. Kontynuować tylko prawidłowy zakres. Osobny scope dla platformy, rodzaju zapytania i parametrów; świeży sweep zaczyna od pierwszej strony. Nie używać starych cursorów importu/stagingu. Cursor jest opaque; checkpoint po każdej atomowo zapisanej stronie. Max 4 strony w jednej wykonanej partii; automatyczna orkiestracja bounded partii, bez ręcznego klikania co dwie strony.
4. Gdy wystarcza pokrycie kategorii, osiągnięto koniec paginacji lub limit danej puli/platformy/kampanii — STOP tej części. Limit lokalny nie oznacza complete. Kolejny filtr ma osobny scope/cursor, nigdy cursor skopiowany z innej kategorii.
5. Detail tylko dla zaplanowanych exact LOT-ów jeszcze nieodświeżonych przez listę; enrichment tylko bez mediów. Zatrzymanie kampanii przy 401/403/404/429/timeout/5xx, mismatch, błędzie D1 lub lease. 404 pozostawia poprzednie dane, nie potwierdza zakończenia aukcji. Brak automatycznych retry.
6. Po każdej partii: rzeczywiste counts, snapshots/events, private counts0, media URL count i request ledger. Po zakończeniu ocena aktualności; żadnej publikacji automatycznej. Nie podnosić publicznych globalnych limitów ani włączać Cron/discovery tras w celu wykonania operatorowego przebiegu.

## 4. Wykonanie offline a przyszła aktywacja

Nowy mechanizm jest przygotowany i testowany na dependency-injected adapterze oraz lokalnej SQLite. Nie jest endpointem publicznym, Cronem ani aktywnym runnerem stagingu. Wykonanie sieciowe wymaga jawnie zaakceptowanego planu/campaign ID, tego samego targetu i trwałej rezerwacji przed każdym fetch. Wspólny limit kampanii obejmuje wszystkie platformy/operacje, również retry.

Przyszły driver musi otworzyć bazę po stałym UUID z `PUBLICATION_DB`, porównać rzeczywiste metadane zasobu i używać tego samego połączenia do zapisu. Sam obiekt `target` przekazany bibliotece nie dowodzi tożsamości wstrzykniętego bindingu D1. Brak takiego dowodu oznacza STOP przed transportem. Pule 32 list / 24 known / 8 media egzekwuje przyszła orkiestracja; biblioteka już egzekwuje trwałe maksimum kampanii i platformy. W tym etapie nie podłączono transportu sieciowego ani nie uznano planu za zatwierdzony.

Licznik biblioteki jest konserwatywnym licznikiem rozpoczętych prób transportu; przed raportem z rzeczywistego przebiegu trzeba zestawić go z adapterowym `upstream_request`, rezerwacjami i commitami. Odmowa przed fetch nie oznacza wywołania Apibara. Nie dodawać dodatkowych requestów dla samej kontroli ledgeru.

Świeżość `observed_at/last_seen_at` wynika z rzeczywistego pobrania lub zapisanej daty odpowiedzi przy replay. `source_updated_at` pozostaje datą providera. Offline replay starej odpowiedzi nie nadaje jej dzisiejszej świeżości. Error nie przesuwa freshness ani observation; 404 nie fabrykuje ended. Nieznana/konfliktowa dostępność nie jest ofertą aktywną. Brak aktualnej ceny w nowej odpowiedzi nie otrzymuje starej ceny z nową datą: poprzednie kwoty pozostają w istniejących snapshots, a nowe bieżące pola są nieustalone. Dane opisowe, media i wcześniejsza historia pozostają zachowane. Powtórzenie identycznej treści nie tworzy nowego snapshotu; zaobserwowana zmiana i późniejszy powrót do poprzedniego stanu są odrębnymi obserwacjami, bez sztucznych auction events. Błędna struktura `data` nie jest poprawnie pustą stroną i nie kończy scope.

Ukończenie `detail_refresh` oznacza jedynie obsłużenie zatwierdzonej listy znanych LOT-ów. Nie nadaje całemu katalogowi `catalog_complete=true`; coverage wyliczane z discovery pozostaje odrębne.

### Rollback odświeżenia

Każda ukończona strona jest osobnym checkpointem. Błąd przed commit cofa tylko jej transakcję, a zużyty request nadal pozostaje policzony. STOP zachowuje wcześniejsze poprawne strony; nie kasuje listingów ani snapshots. Jeżeli wykryto wadliwą normalizację, wstrzymać kampanię i publikację, zachować ledger oraz odtworzyć backup do osobnej bazy testowej w celu walidacji. Zastąpienie danych lub bindingu publikacyjnego wymaga osobnej zgody i sprawdzenia allowlisty targetu; nie jest automatycznym destrukcyjnym rollbackiem. W tej zmianie nie dodano migracji schematu.

Dokładne wyniki testów, ograniczenia i dostępność sesji panelu: bieżący `PROJECT_HANDOFF.md`. Po zaakceptowanym odświeżeniu warunki publikacji i rollback nadal określa [runbook](PRODUCTION_CUTOVER_RUNBOOK.md); refresh nie jest zgodą na DNS/deploy.

## 5. Jeden ręczny test nieprzeczytanych — tylko staging

W dostępnej sesji przeglądarki `/panel` zakończył bootstrap komunikatem „Zaloguj się do swojego konta”; nie ma dwóch zalogowanych sesji. **Nowy rzeczywisty E2E unread nadal NOT VERIFIED.** Zachowano wcześniejsze potwierdzenia właściciela dotyczące nadawców, etapu i plików; nie zastępują one unread E2E.

Użyj dwóch istniejących kont testowych w oddzielnych profilach przeglądarki. Nie podawaj haseł ani kodu MFA agentowi:

1. Właściciel w [administracji](https://rexbid-auth-test.tedn828.workers.dev/administracja), klient w [panelu](https://rexbid-auth-test.tedn828.workers.dev/panel). Na tej samej istniejącej testowej realizacji wyślij z właściciela `TEST unread — REXBID` i odśwież listę klienta. Licznik klienta ma wzrosnąć, licznik nadawcy nie.
2. Klient otwiera rozmowę, klika **„Oznacz wczytane wiadomości jako przeczytane”**. Po odświeżeniu strony stan pozostaje przeczytany; pozostałe realizacje nie zmieniają liczników.
3. Klient wysyła `TEST unread — Klient`; właściciel odświeża listę, sprawdza licznik, oznacza wczytane wiadomości i odświeża ponownie. Nadawcy pozostają Klient/REXBID. Odczyt w jednej sesji nie zmienia drugiego audience.
4. Jeśli istnieje realizacja należąca do innego klienta, na koncie testowym klienta otwórz jej adres: dane i wiadomości mają być niedostępne. Nie twórz nowego konta ani nie resetuj MFA tylko dla tego testu. Brak drugiej cudzej realizacji oznacz osobno jako niewykonany realny test; istniejące automatyczne regresje izolacji pozostają dowodem lokalnym.

Zgłoś wyłącznie PASS/FAIL tych punktów; bez treści prywatnej rozmowy, UUID, screenshotów QR lub danych kont. Panel nie wysyła tych wiadomości e-mailem.
