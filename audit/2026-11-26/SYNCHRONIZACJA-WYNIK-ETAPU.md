# REXBID — naprawa synchronizacji, wynik etapu 26.11.2026

Stan: **niepełny odbiór całego zlecenia**. Wprowadzono rzeczywiste zmiany i sprawdzono pracę produkcji. Nie potwierdzono pełnej aktualności całego katalogu, stabilności przez siedem dni ani likwidacji wszystkich kolejek. Aktualny kod produkcji i niewdrożona optymalizacja są rozdzielone.

**Co było przyczyną potwierdzonych braków**

Główny importer publikował paczki, lecz osobna kolejka ponownych wystawień zatrzymywała się na wewnętrznym przydziale 400/450 dziennych wywołań. To nie był limit opłaconego Pro. Copart dominował w kolejce. Dodatkowo limit wieku ostatniej paczki 75 minut zatrzymywał niezależną weryfikację przez API. Subaru 46496930 i Hyundai 46528339 były w źródle, ale nie w wynikach. Kontrola samego kursora paczek ukrywała ten problem.

W tym etapie wykryto też obniżanie wspólnych przydziałów przez stare inicjalizatory, dodatkową rezerwę 30 tys. wywołań, stały limit 2000 nowych wpisów oraz blokowanie zdjęć/historii przez rezerwowanie zapisów z góry na wszystkie pozostałe dni miesiąca. Te bariery były w naszym kodzie. W uwierzytelnionym panelu Apibary znaleziono źródło PAUSED i nieudaną generację 24953 przy aktywnym Pro. Wznowienie istniejącego źródła przywróciło harmonogram; nowa paczka 25281 jest gotowa od 16:34 UTC i została samoczynnie odebrana. Przyczyna pierwotnej pauzy nie została ustalona. Nie zmieniono abonamentu.

**Co działa na produkcji**

- Wspólny, trwały licznik API i blokada transakcyjna. Restart ani północ nie zerują przydziału nadrabiania. Zużyte wywołania pozostają policzone również po błędzie odpowiedzi.
- Przydział zależy od uwierzytelnionej pozostałej puli, terminu subskrypcji i kolejki. Połowa dostępnej puli może zasilać nadrabianie; druga połowa zostaje na dalsze operacje. Dodatkowo pozostaje rezerwa 10% opłaconej puli. Nie przyznano nowej puli u dostawcy.
- Licznik przydziału nadrabiania jest rozliczany atomowo razem z licznikami dziennym i miesięcznym. Nie ma obowiązku czekania na północ po wykorzystaniu dawnego progu około 3 tys. wywołań.
- Copart i IAAI mają niezależne kursory oraz ważony podział według liczby i wieku zadań, z minimalną możliwością obsługi obu źródeł. Niewykorzystana możliwość może przejść do drugiego źródła.
- Zbiorczy odczyt filtrowanych auction.rescheduled dostarcza pełne rekordy i ma własny trwały kursor. Próba rzeczywista zwróciła 50 rekordów w jednym wywołaniu. Nie przestawia głównego kursora importu.
- Do 20 znanych, sprawdzonych ofert można zapisać w jednej transakcji. Konflikt wycofuje cały zestaw. VIN, platforma, LOT, źródłowa wersja i historia nadal są sprawdzane.
- Starsza paczka nie powinna nadpisywać nowszej sprawdzonej wersji API. Nie przenosi się starej ceny sprzedaży jako bieżącej oferty.
- Starsza ukończona paczka nie blokuje już niezależnej naprawy ponownych wystawień ani zdjęć. Trwające publikowanie i niezgodny punkt nadal blokują niebezpieczny zapis.
- Zdjęcia z już sprawdzonej odpowiedzi o ponownym wystawieniu mogą wypełnić pustą galerię bez kolejnego wywołania API. Istniejąca galeria ma pierwszeństwo. Priorytet zdjęć obejmuje aukcje do siedmiu dni.
- Zdjęcia i historia mają rezerwę dwóch największych zmierzonych dni z ostatnich trzech zamiast blokady na wszystkie przyszłe dni miesiąca. Obecna rezerwa to 4 846 620 zapisów. Twardy budżet okresu pozostaje osobno.
- Monitoring w Cloudflare zapisuje próbki co 15 minut i rozpoznaje horyzonty 1/6/24/72/168 godzin od pierwszej próbki. Działa bez laptopa i otwartego czatu. Nie oznacza to, że 7 dni obserwacji już minęło.
- Panel właściciela pokazuje kolejki, stany obu źródeł, wiek dostawy, pulę i przydziały. Odpowiedź jest chroniona istniejącą autoryzacją i MFA. Kontrola anonimowa zwróciła 401. Zielony status kompletności nie jest nadawany na podstawie samej paczki.
- Alerty korzystają z istniejącego Resend i osobnej szyfrowanej kolejki, mają deduplikację i limit czterech prób dziennie. Potwierdzono jeden wysłany alert; nie kontrolowano folderu odbiorcy.

**Rzeczywiste wyniki**

Pomiar 2026-11-26T20:07:15.792Z: kolejka ponownych wystawień spadła z 26 431 do **19663**. Copart: 13206; IAAI: 6457. To liczba zadań weryfikacji, a nie liczba udowodnionych braków.

Kolejne automatyczne próbki: 15:00 UTC — 23 596; 15:15 — 23 486; 15:30 — 22 384; 15:45 — 21 900. W ostatnim pełnym kwadransie ubyło 484, czyli 1936/h netto. Wcześniejszy kwadrans dawał 4408/h. Zmienność jest duża, a pliki nie napływały. Ekstrapolacja 21,9 tys. / 1936/h daje około 11,3 godziny, lecz **nie jest terminem ukończenia**: zadania niepotwierdzone wracają później, a wznowione pliki mogą dodać pracę. Nie zmierzono jeszcze normalnego dopływu po naprawie. Nie wykazano trwałej dwukrotnej nadwyżki wydajności.

Subaru Forester VIN JF1SG63648G714701 / LOT 46496930 oraz Hyundai Elantra VIN KMHDH4AE0DU637914 / LOT 46528339 przywrócił normalny automat po nadaniu priorytetu istniejącym zadaniom. Nie wpisywano ręcznie danych aut. Kontrola publiczna 15:39 UTC znalazła obie prawidłowe tożsamości i termin **1 grudnia 17:30 PL**. Powtórzona próba równoległa również znalazła obie oferty.

Mobilny Chrome 390×844 o 15:31 UTC: cztery sekcje po cztery oferty, 16/16 zdjęć odkodowanych, VIN Dakoty prowadzi do LOT 65917836. Zmiana 1100 → 2500 USD zmieniła kalkulator 13 891 → 20 567 zł. Sprawdzono reakcję kalkulatora, nie przeprowadzono ponownego audytu taryf. Nie wysyłano wiadomości ani wpłat i wyłączono rejestrowanie wizyt testowych.

Próba równoległa 2026-11-26T20:07:21.537Z: Subaru 2025+ zwróciło 20 aut, wszystkie spełniały rocznik; elektryczne 20 aut, następna strona kolejne 20 bez powtórzeń. Czasy całego odczytu JSON: 3163–3661 ms przy czterech równoległych zapytaniach; kolejna strona 353 ms. To pojedynczy test, nie porównywalny benchmark przed/po ani wynik Core Web Vitals. Wcześniejsza próba 15:53 UTC miała 1165–1547 ms i 356 ms kolejnej strony; różnicy nie przypisano automatycznie konkretnej przyczynie.

**Zdjęcia w szerszym zakresie**

Pomiar 2026-11-26T16:41:40.967Z: Copart 16687/47261 (35.31%) aktywnych wpisów z datą bez adresów zdjęć w dwóch kolumnach mediów; IAAI 4/33061. Do siedmiu dni brakuje adresów w 15055/42725 Copart i 1/29153 IAAI. To pomiar adresów w zapisanej bazie, nie test działania każdego zewnętrznego pliku. Ogólna liczba braków może wzrosnąć przy przywróceniu kolejnych aut, mimo uzupełnień.

Po usunięciu blokady wieku paczki normalny automat 15:47 UTC uzupełnił m.in. Copart 67754256 — 12 zdjęć i 11 miniatur. Dodatkowy moduł wypełniający media również pozostałych aktywnych ofert z całej już pobranej strony API przeszedł testy, lecz **nie został jeszcze wdrożony**. Jego publikację zatrzymał odczyt zarządzania Cloudflare: HTTP503, kod10001, Unable to authenticate request. D1 i produkcyjny automat w tym czasie pracowały. Nie ustalono, czy to usterka autoryzacji czy usługi; nie przedstawia się tego jako wygaśnięcia konta ani awarii całej strony.

**Limity i koszty**

| Obszar | Potwierdzone warunki / decyzja |
|---|---|
| Apibara | Uwierzytelniony Pro: 100 tys. na okres, następny termin 26.12; listy 20 rekordów. Publiczny cennik: 70 USD/mies., 40 żądań/s, burst40, jeden feed i live w planie. Faktycznej płatności USDC nie weryfikowano. |
| Przydział nadrabiania | 43584 łącznie w bieżącym okresie, bez zerowania o północy. Ostatni pomiar wykorzystania 2365. Po zakończeniu kolejki tryb przechodzi do zwykłego rozdziału. |
| D1 opłacony | 50 mln zapisów, 25 mld odczytów i 5 GB łącznie; dodatkowo 1 USD/mln zapisów, 0,001 USD/mln odczytów, 0,75 USD/GB-mies. |
| Zgoda właściciela | Dodatkowo do 8 USD/mies. Wybrano do 5 USD na dodatkowe zapisy D1 i 3 USD rezerwy na inne zużycie. Brak nowego abonamentu. |
| Reguła D1 | Dopuszcza 5 mln dodatkowych zapisów względem poprzedniej polityki, nie zeruje historii zużycia. Gdyby wszystkie były poza pakietem, odpowiadają 5 USD. Jeśli zmieścimy się w pakiecie, dopłata za nie wynosi 0 USD. |
| Dostępny wewnętrzny zapas | 10 470 615 zapisów oraz 18 797 986 192 odczytów, po uwzględnieniu zadeklarowanych rezerw. |
| Katalog D1 | 2.617 GB; 5.375 GB do zatwierdzonego sufitu 8 GB po 8 MB rezerwy roboczej. |
| Konto Cloudflare | Rzeczywisty odczyt GraphQL 15:16 UTC: 40 026 331 zapisów i 1 082 181 520 odczytów od 6.11. Workers: 230 560 wywołań w tym okresie; w ostatniej dobie 6001 i zero błędów w tej agregacji. |

Osiem dolarów jest zatwierdzonym dodatkowym budżetem, **nie techniczną blokadą całej faktury Cloudflare**. Twardo ograniczono dodatkowy przydział D1; pozostałe usługi nadal mają wcześniejsze własne mechanizmy ochronne. Nie wykonano jeszcze wspólnego automatycznego rozliczenia pieniężnego całego konta. Stałego kosztu całej strony i zerowych dopłat nie można deklarować wyłącznie na podstawie tych liczników.

Przy powtórzeniu ostatniego szczytu 2,42 mln zapisów dziennie przez dalszych 10 dni potrzeba około 24,2 mln zapisów; dostępne wewnętrzne 10,6 mln nie wystarczy na taki nieprzerwany szczyt. To scenariusz, nie prognoza. Ostatnie dni obejmują nadrabianie i sprzątanie. Obecnie nie ma dowodu, że trzeba kupić wyższy abonament; nie ma też dowodu, że ta konfiguracja wytrzyma bez zmian obciążenie 10×. Konieczny jest pomiar po odzyskaniu normalnego dopływu plików.

Próbki zachowanych plików pokazały 1129–3537 sygnałów zmiany terminu na półgodzinną paczkę podczas szczytu i 154 w spokojniejszej próbce rano. Nie wolno ekstrapolować tego szczytu na cały miesiąc. Punktowo 400 wywołań/dobę nie wystarczało. Zbiorcze rekordy, deduplikacja i wykorzystanie raz opłaconych danych ograniczają potrzebną liczbę wywołań.

Źródła cen i kontraktów: [Apibara pricing](https://apibara.tech/en/pricing), [OpenAPI](https://apibara.tech/openapi/v1.json), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Dane konta i skuteczne limity stron sprawdzono również bezpośrednio. Publiczny opis limitu 2000 zmian nie zastępuje pomiaru efektywnej strony 50 z pełnymi rekordami.

**Istotne pozostałe ograniczenia**

1. Nową paczkę 25281 odebrano; ostatnia pełna publikacja według pomiaru 2026-11-26T20:07:15.792Z to 24932, sekwencja 123100250. Odebranie 627178 zdarzeń nie jest dowodem ich opublikowania. API uzupełnia wybrane dane; nie zastępuje jeszcze kompletnego kanału wszystkich cen i statusów podczas długiej przerwy w plikach. Dwie kolejne publikacje wymagają odrębnego potwierdzenia.
2. Stara kolejka reconcile ma 391381 wpisów, a pełne uzgadnianie tym mechanizmem było wyłączone. Odczyt 16:20 UTC: Copart 231679 zadań, IAAI 159702. Znane aktywne auta z datą: odpowiednio20249 i20540. Żadne zadanie nie ma obecnie wymaganego źródłowego wpisu eligibility. Nie ma powielonych dopasowań kanonicznych w tym połączeniu. Odczyt zużył1844174 wiersze i zero zapisów. Nie usunięto zadań ani nie uznano bez dowodów za zbędne. To nie jest dowód391381 brakujących aut. Dalsze rozwiązanie kolejki pozostaje otwarte.
3. Archiwum zdjęć miało w osobnym pomiarze 11:30 UTC około 6,75 dnia opóźnienia. Jego przyspieszenia i końcowej przepustowości nie wdrożono w tym etapie. Nie zmieniono reguł usuwania historii ani zdjęć.
4. Nadal pozostają liczne brakujące adresy zdjęć Copart. Dopiero przychodzące źródłowe adresy lub prawidłowa odpowiedź API mogą je wypełnić. Nie potwierdzono nowego pliku zdjęć od pomocy Apibary ani nie odczytano prywatnej rozmowy w tym etapie.
5. Niektóre tożsamości trafiają do błędów, gdy API i zadanie nie zgadzają się co do LOT/VIN. Nie wolno ich publikować siłą. Oddzielnie wystąpiły błędy uzupełniania historii wymagające dalszej diagnozy.
6. Pełny publiczny staging pakietu i kompleksowe symulacje awarii 500 tys. rzeczywistych rekordów end-to-end nie zostały wykonane. Zestawy lokalne obejmują SQLite, konflikty, wznowienia, liczniki, quota, 429 i regresje importu; symulacje budżetu 1/7/30 dni, obciążenia1/2/5/10× i kolejki10/30/100/500tys. sprawdzają ograniczenia zasobów, a nie całą produkcję.
7. Wskaźniki napływu/wykonania oddzielnie i wiarygodne długoterminowe ETA wymagają dalszych pomiarów. Dostępna zmiana netto nie zastępuje tych dwóch strumieni.
8. Nie wszystkie istniejące stałe w całym projekcie zostały zastąpione. W raporcie wymieniono potwierdzone bariery usunięte w tym etapie; nie deklaruje się zamknięcia pełnej inwentaryzacji ani wszystkich20 kryteriów.

**Testy, wersje i powrót**

Zestaw aktywnego wykonawcy: 842/842; dodatkowo46/46 wspólnego licznika i 170/170 WWW/panel/logowanie/powiadomienia. Pełny zestaw publicznej strony2735/2735. Pierwszy pełny przebieg miał2730/2734: cztery testy starego harmonogramu wymagały osobnego uwzględnienia nowego monitoringu w izolowanym środowisku VM. Nie wyłączono ich; dodano sprawdzenie osobnego wywołania monitoringu oraz regresję odebrania pliku bez publikacji. Odtworzono konflikty zbiorczej transakcji oraz granicę północy bez odnowienia przydziału. Nie było testów z prawdziwą płatnością.

Wykonawca aktywny: 61e0a130-b8f5-4987-a300-2b89693e66d6; SHA256 e4b1c61915335d69f7ce7386ac681faadcc26a3f59884e13f862dc4167cd3590. Powrót ca3ba0d9-77c3-4637-8c37-a8682b055e55. WWW: 9960f80f-ccbb-4405-ab3b-9327fd7a59aa; SHA256 0af93d49637233b8e4ce021364a227cef0a480af580ee75db776a715de6d59d2; powrót 7fbf788c-6d97-4fd6-b19a-98b3705d95c8. Ustawienia, harmonogramy i bindingi porównano z poprzednimi wersjami. Nie zmieniono usług odbioru plików ani archiwum. Wdrożono dodatkowe zbiorcze wypełnianie pustych galerii z już pobranych pełnych rekordów. Panel i monitoring odróżniają odebrany plik od ostatniej pełnej publikacji.

Kanoniczny zapis kodu: release/autonomous-sync/executor. Suchy build tego katalogu potwierdził dokładnie aktywny bundle e4b1c61915335d69f7ce7386ac681faadcc26a3f59884e13f862dc4167cd3590. Stan wdrożenia dodatkowego wykorzystania mediów jest zapisany w source-manifest.json. Bazowy pakiet wypchnięty do GitHub w7bf3be8 na gałęzi codex/autonomous-sync-health-20261126; kolejne commity zachowują tę samą gałąź.

Punkt pełnego odtworzenia D1 Time Travel: 26.11 15:28:17 UTC, dwa sprawdzone odczyty bookmarku, lokalne odtworzenie pięciu aut, integralność OK, zero błędów kluczy obcych. Nie jest to pobrany pełny eksport całej bazy. Dowody poza Git: session-deploy-20261125/backup/private-release-yJZFTw. Nie przywracać całej bazy automatycznie z powodu błędu jednego rekordu.

Rollback kodu: po sprawdzeniu aktualnej wersji użyć odpowiadającego aktywnemu wydaniu operatora release-v14/release.cjs executor rollback albo web-release-v6/release.cjs web rollback. Nie wykonywać rollbacku, jeśli pojawiło się inne późniejsze wydanie. Nowe dane i poprawne galerie zachować. Cofnięcie do wersji sprzed zgody kosztowej ponownie zawęzi przydział; liczników nie zerować.

Pierwszy następny krok: potwierdzić pełną publikację25281 i następnej normalnej paczki, sprawdzić publiczne oferty oraz zmiany cen, zmierzyć napływ i przetwarzanie. Zarządzanie Cloudflare odzyskało sprawność, v12 i WWWv6 wdrożono. Obserwować naturalne uzupełnienia galerii. Cały etap definitywnej naprawy pozostaje otwarty.

**Dodatkowy dowód publicznej galerii**

Na mobilnej karcie Copart 48049276 (2014 HONDA CR-V TOURING) odkodowało się zdjęcie główne po automatycznym uzupełnieniu. W bazie ma 13 zdjęć, VIN 2HKRM4H94EH121713. Pomiar 2026-11-26T16:03:04.268Z. Zrzut poza Git: autonomous-sync-20261126/evidence/automatic-photo-mobile.png.

**Pliki zmienione logicznie względem bazy wykonawcy**

- sync/automatic-refresh.cjs
- sync/feed-account-budget.cjs
- sync/feed-api-request.cjs
- sync/feed-copart-relist.cjs
- sync/feed-photo-repair.cjs
- sync/feed-relist-budget.cjs
- sync/feed-relist-maintenance.cjs
- sync/feed-server-runner.cjs
- sync/feed-sparse-repair.cjs
- sync/feed-worker-archive-step.cjs
- tests/automatic-refresh.test.cjs
- tests/feed-api-request.test.cjs
- tests/feed-known-relist.test.cjs
- tests/feed-photo-repair.test.cjs
- tests/feed-worker-archive-step.test.cjs
- sync/feed-adaptive-quota.cjs
- sync/feed-approved-cost.cjs
- sync/feed-available-media.cjs
- sync/feed-relist-batch.cjs
- sync/feed-relist-fairness.cjs
- sync/feed-relist-pages.cjs
- sync/feed-relist-priority.cjs
- sync/feed-relist-selection.cjs
- sync/feed-supplemental-allocation.cjs
- tests/feed-adaptive-quota.test.cjs
- tests/feed-approved-cost.test.cjs
- tests/feed-relist-fairness.test.cjs
- tests/feed-relist-selection.test.cjs
- tests/feed-supplemental-allocation.test.cjs
- tests/fixtures/iaai-23956-reschedules.json

Dodatkowo w WWW: portal/sync-health.cjs, portal/sync-monitor.cjs, portal/operations.cjs, portal/transactional-mail.cjs, worker.publication.js, public/administracja.html, public/rexbid-client-portal.js i testy. Pełny wykaz wraz z hashami jest w release/autonomous-sync/source-manifest.json. Pełna kopia źródeł służy odtwarzalności; nie oznacza, że każdy skopiowany plik został przerobiony.

**Naprawa blokady dużej paczki25281**

Po wznowieniu dostaw automat sam odebrał plik:627178 zdarzeń, SHA256 i rosnące sekwencje sprawdzone lokalnie. Początek123100251 następuje po naszej123100250, koniec123727597. Czas ostatniego recorded_at to26.11 16:32:38 UTC. To czas dziennika źródła, nie gwarancja każdej ceny. Po58 trwałych oknach kod zatrzymał finalizację na FEED_ARCHIVE_STEP_METADATA_LIMIT. Zapas metadanych zależał od rozmiaru gzip, mimo że liczba manifestów zależy od danych po rozpakowaniu. Odtworzono dokładnie ten błąd na20000 syntetycznych zdarzeń rozłożonych na128 koszyków. Po poprawce przydział rozszerzonych danych uwzględnia rozmiar po rozpakowaniu i limit rekordów, zachowuje32MiB rezerwy metadanych oraz kontrolę pojemności przed zapisem. Małe zwykłe pliki zachowują4MiB. Nie zmienia limitów pamięci, rekordów, źródła ani kursora. Gotowe58 okien pozostają do ponownego wykorzystania. Pełny zestaw wykonawcy842/842. Odbiór produkcyjnej finalizacji wymaga rzeczywistego ponowienia po aktywacji wersji ca3ba0d9-77c3-4637-8c37-a8682b055e55.

**Naprawa zapisu po przygotowaniu paczki 25281**

Poprzednia poprawka pozwoliła ukończyć przygotowanie. Zapis zatrzymał się na FEED_ARCHIVE_MATERIALIZED_LIMIT. Plik poniżej 32 MiB po kompresji zawierał 477 375 694 bajtów po rozpakowaniu. Wszystkie 128 części przekraczały oszacowany limit 16 MiB przy pełnym wczytaniu. Największa grupa jednego LOT zajmowała szacunkowo 153 728 bajtów. Teraz wybór małych porcji korzysta z profilu danych po rozpakowaniu. Test produkcyjnej ścieżki odtwarza wcześniejszy błąd i sprawdza zgodność kolejności oraz wszystkich grup po poprawce. Przeszło 842/842 testów. Przed operacją sprawdzono D1 Time Travel z 20:04:15 UTC i odtworzono pięć aut. O 20:06:49 UTC odblokowano jedno zadanie, bez zmiany sekwencji i zawartości ofert. Pomiar 2026-11-26T20:07:37.768Z, ostatnia zatwierdzona sekwencja 123100250. Stan 25281: {"generation_id":25281,"status":"applying","observed_at":"2026-11-26T16:35:52.733Z","updated_at":"2026-11-26T20:06:49.093Z","bucket_index":0,"group_offset":0,"last_sequence":123727597,"last_error_code":null}.
