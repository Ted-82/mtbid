# Timed, Polestar i brakujące marki — 9.10.2026

## Wynik i aktualne wydanie

Staging: https://rexbid-auth-test.tedn828.workers.dev

- Version ID: **6c7d016d-a822-4a4f-9868-b46d111f20be**, 100% ruchu; utworzona 13:03:43 UTC. Odczyt deployments po ponownej autoryzacji potwierdził wdrożenie. CLI przerwało dopiero końcową kontrolę subdomain; nie wykonano zbędnego drugiego deployu.
- Poprzednia wersja / rollback kodu: **3e8a742c-a013-46b7-b5df-a32f26740a0d**.
- D1: wyłącznie `rexbid-auth-test-db`, `acb3cb8e-69a2-459f-8a46-0f2f5b9004be`. Wiązanie prywatnego R2 stagingu zachowane; fallback `disabled`, legacy sync `false`, D1 reads `true`. Subdomain enabled, HTTP health/ready/cars PASS.
- Produkcja, preflight, DNS, MFA, schemat, plany i uprawnienia bez zmian. Push: 0.

## Przyczyna — poprawka wcześniejszego wniosku

Brak ofert w zapisanej D1 nie oznaczał braku ofert na rynku. Pierwotne pobieranie było częściowe (historyczny STOP 56). Kampania z 8.10 odświeżyła istniejące 1638 pozycji, nie odkrywała nowych. Poprzednie Timed przestały spełniać warunek czasu; automatyczny sync i fallback są wyłączone. Wcześniejszy raport opisuje stan lokalnego zbioru, nie pełną dostępność u źródła.

Odczyt 9.10, 14:52–14:54 CEST potwierdził:

- IAAI `lot_status=Timed`, `lot_sub_status=Open`: **4839** ofert, pierwsza strona 20. Copart przy tych samych filtrach: 0. To wynik konkretnego zapytania i czasu, nie zapewnienie stałej dostępności.
- Polestar: **11 surowych rekordów Copart + 1 IAAI**. Jeden rekord Copart (`69411076`) ma typ `TRAILERS`, więc nie został dodany jako samochód. Zapisano **10 samochodów Copart + 1 IAAI**.
- Metadane zawierają 678 surowych nazw producentów, również przyczep, łodzi i sprzętu. Porównano 50 typowych marek aut ze zbiorem lokalnym; nie przedstawiamy 678 jako liczby marek samochodów ani tej kontroli jako pełnego odczytu rynku.

Kontrakt: [oficjalna dokumentacja Apibara](https://apibara.tech/en/products/vehicle-auction-data-api/docs), [oficjalna lista filtrów](https://github.com/apibara-tech/apibara-vehicle-auction-api-examples/blob/main/docs/filters-reference.md). Użyto GET `vehicles/filters`, `vehicles` z filtrami platform/make/lot_status/lot_sub_status, `upcoming=all`, `per_page=20`, `include_total=true` oraz odczytu usage przed/po. Plan Basic; bez rozszerzeń.

## Uzupełnione dane i wyszukiwanie

Zapisano **179 nowych ofert: 105 Copart + 74 IAAI**. Żadnej istniejącej oferty nie nadpisano. Zachowano daty faktycznego odczytu, ceny/null, platformę/LOT/VIN i dostępne URL-e mediów. Każda partia miała kontrolę zapisu, trwały checkpoint, bez ponownego transportu.

| Zakres | Wynik źródłowego zapytania | Zapisane w tym etapie |
| --- | ---: | ---: |
| Timed IAAI | 4839 | 20 |
| Polestar — samochody obu platform | 11 po wyłączeniu przyczepy | 11 |
| Aston Martin | 19 | 19 |
| Bentley | 64 | 20, pierwsza strona |
| Ferrari | 9 | 9 |
| Fisker Automotive | 2; literalne Fisker: 0 | 2 |
| Lamborghini | 17 | 17 |
| Lotus | 5 | 4 |
| Lucid / Lucid Motors | 9 / 18 | 27 |
| McLaren | 1 dla tej literalnej nazwy | 1 |
| Rolls-Royce | 11 | 9 |
| Saab | 26 | 20, pierwsza strona |
| Smart | 26 | 20, pierwsza strona |

Trzy klasyczne auta z krótkim identyfikatorem (Lotus 65483046; Rolls-Royce 68678756, 68869456) pozostawiono poza zapisem do osobnej weryfikacji identyfikacji. Krótki numer nie jest tu uznany za dowód nieprawidłowości pojazdu. Czwarty pominięty rekord to wspomniana przyczepa.

Naprawiono wyszukiwanie rodzin nazw: Lucid/Lucid Motors, Fisker/Fisker Automotive, McLaren/McLaren Automotive oraz Mercedes/Mercedes Benz/Mercedes-Benz. Jawne aliasy zamiast dopasowania prefiksem; pierwotne nazwy i dokładny VIN/LOT pozostają w danych. Metadane deduplikują te rodziny i modele. Nie dodawano fikcyjnych ofert do listy marek.

## Audyt D1

Readback po przywróceniu dostępu: **13:19:50 UTC**, końcowe liczniki **13:21:12 UTC**.

| Dane | Przed | Po |
| --- | ---: | ---: |
| Copart | 840 | 945 |
| IAAI | 798 | 872 |
| Razem oferty | 1638 | 1817 |
| Snapshoty | 3074 | 3253 |
| Wydarzenia aukcyjne | 19044 | 19044 |
| Rezerwacje providera w D1 | 291 | 291 |

Kontrola platforma/LOT/VIN, ceny i observedAt po każdym zapisie PASS. Duplikaty i FK: 0. Wszystkie **18 chronionych tabel** identyczne hash/count; wszystkie wcześniejsze wydarzenia oraz niezwiązane rekordy ofert zachowane. Nie modyfikowano kont, ulubionych serwerowych, realizacji, wiadomości, plików ani MFA.

Backup przed zapisem: `C:/Users/nowic/Documents/Codex/private-backups/rexbid/coverage-before-20261009`, 12:55:37 UTC, SQL 29306211 B. SHA256 plaintext `fef941c953debf1809ce0f91a34bd22f0544c41c53a993ac1f5ef73c3d4e9eb6`. DPAPI CurrentUser + ACL, roundtrip PASS, jawny plik usunięty. Kopia poza Git; ten test nie jest odtworzeniem na drugim komputerze.

## Testy i realna przeglądarka

- **884/884 repo PASS + 14/14 pakiet partnera PASS**. Oba generatory repo, generator pakietu partnera, trzy walidatory, składnia 159 JS + 5 inline, diff i staging dry-run PASS. Stawki V4 niezmienione.
- Dwie nowe regresje SQLite sprawdzają aliasy, modele i dokładny LOT; test historii otrzymał stały zegar zamiast zależności od godziny uruchomienia. Zachowano wszystkie asercje i ochronę przed starszym receipt.
- HTTP: health/ready, Polestar, Timed oraz obie nazwy Lucid 200. Listy `read_source=d1`, fallback false. Nowych requestów Apibara podczas QA: **0**.
- Desktop 1366×900: Polestar 60132756 — 14200 USD, poprawny VIN/LOT, obserwacja 14:52, termin 21:00, 13 zdjęć, lightbox 1→2, Geico i zielony typ ubezpieczyciela. Historia jawnie niepobrana. Katalog Polestar: 11 samochodów. Home: cztery rzeczywiste karty Timed.
- Mobile 390×844: IAAI Kia 45512277 — 525 USD, Timed, koniec **10.10.2026 00:41 CEST** (źródło 9.10 22:41 UTC), poprawny countdown; nie mylić daty polskiej z datą widoczną w strefie IAAI. Galeria 18 pozycji, dwie niedostępne miniatury mają stan zastępczy. Brak poziomego overflow.
- Polestar V4 na desktop/mobile: po ręcznym wyborze testowego założenia SUV standardowy transport 1735 USD (4 auta) / 2075 USD (3 auta), w tym BEV 150 USD. Zakup + znany transport 15935 / 16275 USD. To suma częściowa, bez nieznanych opłat/podatków/Polski; klasa wymaga potwierdzenia dla realnej wyceny. Preferowany terminal Los Angeles. Kia: transport 920 USD, subtotal 1445 USD, terminal Elizabeth.
- Nie powtarzano E2E loginu/MFA/portalu ani wysyłki poczty. Wideo w nowej Kii wykryto jako dostępny materiał; odtwarzania nie zaliczamy do wykonanych testów.

Dowody poza Git: `C:/Users/nowic/Documents/Codex/REXBID_COVERAGE_AUDIT_20261009/`: `polestar-desktop.jpg`, `timed-desktop.jpg`, `home-timed-desktop.jpg`, `home-timed-mobile.jpg`, `timed-card-mobile.jpg`, `polestar-calculator-mobile.jpg`, `polestar-subtotal-mobile.jpg`, test log, ledger, odczyty metadanych i audytu.

## Zużycie Apibara

**20 prób i 20 odpowiedzi HTTP 200**, retry 0; licznik ciągły **1754 → 1774**. W tym dwa odczyty usage. Osobny licznik dostawcy: **5816 → 5833/30000**, przyrost 17, pozostało 24167. Nie utożsamiać liczników. Historyczny STOP 56 i zakończona poprzednia kampania zachowane. Ten etap zakończył transport; nie uruchamiać automatycznie kolejnych stron.

## Alert D1 i autoryzacja — rzeczywiste ustalenia

Właściciel przekazał alert przekroczenia 100000 rows written z resetem 9.10 o 00:00 UTC (02:00 CEST). Odczyt GraphQL Analytics o **13:18:16 UTC** potwierdził:

| Dzień UTC / baza | Rows written | Rows read |
| --- | ---: | ---: |
| 8.10 — staging | 129544 | 3198114 |
| 8.10 — odseparowany preflight | 21013 | 305847 |
| 8.10 — istniejąca produkcja | 264 | 442 |
| 8.10 — całe konto | **150821** | **3504403** |
| 9.10 do odczytu — całe konto, ruch w stagingu | **2763** | **1317965** |

To metryki konta, a nie przypisanie każdego zapisu tej kampanii. Duży zapis historii w stagingu był istotnym obciążeniem; wcześniejsze zestawienie tylko prób Apibara nie kontrolowało osobnego limitu D1. Limit obejmuje tabele i indeksy, wszystkie bazy konta. Nie usuwać indeksów w celu obchodzenia limitu. Nie należy kontynuować masowych zapisów bez osobnego budżetu D1, bieżących metryk konta i trwałej sumy `meta.rows_written`. Taki automatyczny limiter D1 nie został w tym etapie wdrożony; dalszy import pozostaje zatrzymany. Nie włączono Workers Paid.

Źródła: [limity i sposób naliczania D1](https://developers.cloudflare.com/d1/platform/pricing/), [metryki D1](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

Autoryzacja: obie strony używają Wrangler **4.149.0** i `XDG_CONFIG_HOME=C:/Users/nowic/AppData/Roaming/xdg.config`. Kod 10001 pojawił się przy subdomain i memberships; token według lokalnej daty nie był wtedy jeszcze wygasły, więc nie przypisujemy tego wyłącznie upływowi czasu. Następny login o13:07 skończył się timeoutem oczekiwania na authorization code; zrzut właściciela pokazuje odrzucenie zgody przez stronę Cloudflare. Brak dowodu, że spowodował to limit D1, konflikt portu lub EPERM. Alternatywny `login --device` zakończył się zgodą właściciela o15:16 CEST, potem API/metadane/audyt PASS. Nie zmieniano uprawnień, cache, haseł ani MFA. To przywrócenie sesji, nie dowód trwałej naprawy usługi OAuth.

## Linki i ograniczenia

- [Polestar](https://rexbid-auth-test.tedn828.workers.dev/?catalog=1&make=POLESTAR#results)
- [Timed](https://rexbid-auth-test.tedn828.workers.dev/?catalog=1&category=timed#results)
- [Polestar Copart 60132756](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=60132756&platform=copart)
- [IAAI Timed 45512277](https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=45512277&platform=iaai)

Katalog nadal częściowy. Nie pobrano dalszych stron Timed/Bentley/Saab/Smart ani osobnej historii nowych 179 aut; UI mówi o niepobranej historii. Znane 167 problemów poprzedniej kampanii nie zostało rozwiązane tym importem. Same URL-e zdjęć nie gwarantują dostępności. Aukcje wygasną zgodnie z czasem, a nowe nie pojawią się automatycznie przy wyłączonym sync/fallback. Nie przedstawiać tej naprawy jako pełnego pokrycia rynku.

Rollback wyłącznie kodu do 3e8a742c po potwierdzonej regresji. Nie usuwać nowych publicznych danych ani nie nadpisywać aktualnej D1 starym backupem. Ewentualne odtworzenie najpierw do osobnej bazy i porównanie chronionych danych, po osobnej zgodzie. Publikacja pozostaje odłożona.
