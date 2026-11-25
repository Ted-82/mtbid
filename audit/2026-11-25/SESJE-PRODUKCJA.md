# Wdrożenie terminów aukcji IAAI i odbiór Forda 45516116

25 listopada 2026. Godziny w raporcie podano dla Polski.

## Termin z dwóch oryginalnych dostaw

Ford F-250, IAAI LOT 45516116, VIN 1FTNX21S11EA69796, wystąpił w dwóch zmianach terminu. Zweryfikowano VIN, platformę, LOT, identyfikator pojazdu u dostawcy, sumy plików i ciągłość czterech kolejnych publikacji.

| Paczka | Sekwencja | Co podała Apibara |
|---|---:|---|
| 23864 | 120217745 | Termin przeniesiono z 24 listopada na 3 grudnia o 06:30. |
| 23931 | 120543860 | Nowy termin to **3 grudnia o 16:30**. Źródło odnotowało zmianę 25 listopada o 09:44:41. |

Przed wdrożeniem D1 miała już drugą, właściwą datę. Wykonawca zachował opis trwającej sesji z poprzedniego terminu, a stara wersja strony ukrywała datę przy takim stanie. Po wdrożeniu zmieniono na jednym wierszu wyłącznie pola `auction_state` i `source_status`. Niezależny odczyt porównał zapis z kopią i potwierdził zachowanie pozostałych sprawdzanych wartości. [Karta Forda](https://rexbid.pl/car?platform=iaai&lot=45516116&vin=1FTNX21S11EA69796)

## Co chroniło działający katalog

* O 10:23 dwukrotnie potwierdzono punkt odtworzenia całej bazy w Cloudflare. Do lokalnej kopii odtworzono schemat 28 tabel, pięć ofert i powiązane dane kontrolne. Kontrola integralności i powiązań zakończyła się prawidłowo. Dla Forda osobno zachowano pełny wiersz, dane źródłowe, migawkę oraz możliwość warunkowego wycofania pojedynczego zapisu.
* Stronę i wykonawcę wydano osobno. Sprawdzono rzeczywiste pliki, konfiguracje, powiązania i rozdzielenie wysłanej wersji od wersji obsługującej ruch. Wykonawcę przełączono po pełnym zapisie 23931, przy braku aktywnej paczki. Aktywacja została potwierdzona o 10:37. W tej operacji nie zmieniono głównego kursora.
* Strona miała 2730/2730 poprawnych testów, wykonawca 813/813. Jednorazową korektę Forda sprawdziło 17 prób na kopii. W produkcji o 10:38 zmieniono jeden wiersz. D1 rozliczyła trzy zapisy wraz z indeksami. Przy drugim odczycie auto miało właściwy status, tę samą datę i nadal należało do aktywnego katalogu.
* O 10:41 statystyki całego konta wykazały 37 755 692 z 50 mln zapisów za bieżący okres od 6 listopada. Zapas według tego odczytu wynosił 12 244 308. Statystyki mogą mieć opóźnienie względem rozliczeń. Do wdrożenia wykorzystano istniejący plan i dotychczasowe limity. [Odczyt użycia D1](../../../session-deploy-20261125/verification/account-d1-sales-read.json)

| Część | Aktywna wersja | Wersja powrotu | Powiązania |
|---|---|---|---:|
| Strona | 07e4b37c-b58d-4548-bad9-64fc7b061f96 | 5ea24dd5-9f45-4810-9d6d-5c4fc25af985 | 70 |
| Importer | 9e664c82-559a-4a37-a7f6-614075ae56fb | 3e03ecf9-cf36-417a-8875-598ae1877991 | 31 |

## Sprawdzenie na rexbid.pl

W mobilnym Chrome na ekranie 390 × 844 po wpisaniu VIN na stronie głównej i naciśnięciu „Szukaj ofert” pojawiło się jedno auto. Kliknięcie prowadziło do właściwego Forda. Na liście i karcie wyświetlała się godzina 16:30. W filtrze trwających sesji nie było tego auta. Audi S5 zachowało pięć obserwacji, ostatnią ofertę 12 700 USD z odczytem o 01:42:43 oraz odrębnie potwierdzony wynik sprzedaży. W próbie kontrolnej Dakota otworzyła się po VIN. Tesla nie miała ustalonego terminu, ale zachowała historyczną obserwację 70 USD. Na Lexusie IAAI sprawdzono obrót panoramy i oba dostępne widoki. Ruch testowy był oznaczony. [Wynik ścieżki klienta](../../../session-deploy-20261125/verification/mobile-vin-deployed-2026-11-25T09-40-32.074Z.json) · [Dakota, Tesla i 360°](../../../session-deploy-20261125/verification/product-mobile-07e4b37c.json)

## Pierwsza automatyczna dostawa po przełączeniu

Punkt początkowy to zakończona paczka 23931, sekwencja 120609875. O 10:40:53 automat odebrał paczkę 23956 ze 103 741 zdarzeniami. Pierwsza sekwencja to 120609876, ostatnia 120713699. Oryginał w R2 i jego suma kontrolna zgadzały się z rejestrem dostawy. Zapis zakończył się o **10:52:12**, po 11 min 19,7 s. O 10:52:13 publiczny katalog potwierdził tę samą sekwencję.

W pliku było 35 zmian terminu IAAI. Dla trzech aktywnych ofert w próbie daty zgodziły się w oryginale, D1 i na publicznej karcie. Przykład to IAAI 46253874, VIN KNDJ63AUXL7037882. Aukcję przełożono z 30 listopada o 16:30 na **2 grudnia o 05:30**. Ponowny test w mobilnym Chrome od strony głównej potwierdził też nową datę Forda na liście oraz na karcie. W paczce 23956 nie wystąpiło zdarzenie o takim samym przebiegu jak poprzednie u Forda. Tę regułę sprawdzono na wcześniejszych oryginalnych danych oraz testami na kopii. [Źródło i publiczny katalog](../../../session-deploy-20261125/verification/first-source-23956-checked.json) · [Test na telefonie po zakończonej publikacji](../../../session-deploy-20261125/verification/mobile-vin-after-cycle-2026-11-25T09-52-45.324Z.json)

## Druga automatyczna dostawa i sprawdzenie cen

Druga pełna dostawa **23980** przyszła o 11:10:52 i zakończyła się o **11:23:47**. Automat zapisał 88 932 zdarzenia w 12 min 55 s. Zakres 120713700–120802672 przylega do poprzedniego, a publiczny katalog potwierdził ostatnią sekwencję. BMW X3 z IAAI (46583134) zmieniło ofertę z 25 na **225 USD**, a Ford Bronco z Copart (77428396) z 3950 na **4050 USD**. W obu przypadkach wykonano odczyt bazy przed i po zapisie oraz sprawdzono ceny na kartach mobilnych. Obie pozostają ostatnimi zarejestrowanymi ofertami. Na obu kartach brak potwierdzonej sprzedaży. Po drugiej paczce Ford 45516116 nadal miał termin 3 grudnia o 16:30, a godzina obserwacji i odrębny wynik Audi pozostały widoczne. [Dowód dwóch publikacji](sesje-dwie-publikacje.json) · [Ponowna kontrola Forda oraz Audi](../../../session-deploy-20261125/verification/after-cycle-2026-11-25T10-26-15.126Z.json)

W obu paczkach odnotowano łącznie 192 673 zdarzenia. W próbie 12 zmian ceny po znanym terminie aukcji Timed nie potwierdzono żadnego nowego wpisu odpowiadającego przypadkowi Audi. Jedno auto było już zakończone przed zmianą kwoty, a przy pozostałych 11 zabrakło odczytu stanu sprzed zmiany. Z tego pomiaru nie można wyciągnąć wniosku o awarii zapisu historii ani o pozytywnym teście tej konkretnej reguły na nowym pojeździe. [Zakres i wyniki próby Timed](../../../session-deploy-20261125/verification/two-timed-candidates.json)

## Dwie otwarte oferty poza bieżącą listą

O 11:01 porównano odpowiedzi Apibary z wyszukiwaniem VIN, kartami i kolejkami REXBID. Obie odpowiedzi źródłowe zawierały dokładny VIN i LOT, stan otwarty, ustaloną datę oraz brak potwierdzonego wyniku. Termin obu sesji to **1 grudnia o 17:30 czasu polskiego**.

| IAAI | Co potwierdziła Apibara | Co mógł zobaczyć klient |
|---|---|---|
| Subaru Forester 46496930 | Kup teraz 800 USD. Brak podanej bieżącej oferty licytacyjnej. | Wyszukiwanie aktywne nie znalazło VIN. Bezpośrednia karta miała 11 zdjęć i widoczne oznaczenie zapisu archiwalnego. |
| Hyundai Elantra 46528339 | Kup teraz 1300 USD. Brak podanej bieżącej oferty licytacyjnej. | Stary zapis miał stan zakończony. Aktywna karta zwracała brak terminu i HTTP 404. |

Automat wykrył oba sygnały i wpisał właściwe sekwencje do kolejki sprawdzania ponownych wystawień. O 11:03 czekało w niej **7295 zadań**. Są to zadania weryfikacyjne, ich liczba nie określa liczby brakujących ofert. O 11:05 wykorzystano 400 z dziennego wewnętrznego przydziału 500 zapytań. Pozostałe 100 jest zarezerwowane dla innych funkcji. W tym momencie proces ponownych wystawień miał zero zapytań do wykorzystania. Dodatkowo przeglądał numery LOT obu domów w porządku, w którym cały Copart poprzedza IAAI. W 6 poprzednich godzinach potwierdzono 47 ukończonych zadań, wszystkie z Copart, w tym 46 odzyskanych ofert. Reguła archiwum 2018+ nie obejmuje aktywnego katalogu. [Potwierdzenie dostawcy](../../../session-deploy-20261125/verification/case-subaru-23956-provider.json) · [Weryfikacja dwóch wpisów](../../../session-deploy-20261125/verification/case-subaru-23956-queue.json) · [Pomiar przydziału i kolejki](../../../session-deploy-20261125/verification/case-subaru-23956-rank.ndjson)

**Próba oszczędniejszej weryfikacji.** Wykonano trzy odczyty listy z opłaconego Pro, każdy po 20 rekordów. Wszystkie 60 rekordów miało wymagane pola stanu. Na pierwszej stronie ogólnej i na stronie Subaru dla wybranego dnia nie było powiązanych zadań. Na jednej stronie Hyundai były trzy. Dwa pojazdy przeszły weryfikację identyfikatora, wersji danych i terminu. Trzeci zmienił godzinę i został odrzucony. To praktyczny argument za użyciem pasujących rekordów, gdy strona i tak jest już pobierana. Wyniki trzech odczytów nie uzasadniają rezygnacji z punktowego odczytu LOT. Próba wykonała zero zapisów do REXBID. [Wynik porównania](../../../session-deploy-20261125/verification/source-page-feasibility.json) · [Kontrakt listy dostawcy](https://apibara.tech/openapi/v1.json)

Z 7295 zadań 6292 dotyczyły terminów w następnych siedmiu dniach. W ostatnich 24 godzinach odnaleziono 248 zachowanych potwierdzeń ukończenia w tej kolejce, w tym 247 odzyskanych ofert, wszystkie z Copart. Nie zmierzono dobowego napływu nowych zadań w porównywalnym oknie, więc data nadrobienia całości pozostaje nieustalona. [Potwierdzenia z 24 godzin](../../../session-deploy-20261125/verification/case-subaru-23956-throughput.json)

Po drugiej publikacji porównywalny odczyt o 11:25 wykazał **9821 oczekujących zadań, w tym 7706 z terminem w ciągu 7 dni**. Przyrost netto od 11:05 wyniósł odpowiednio **2526** i **1414**. Miesięczny licznik wewnętrzny wskazywał nadal 2520 z 12 000. Dla tej osobnej kolejki zapis paczki nie jest równoznaczny z weryfikacją wszystkich ponownych wystawień.

Na kopii powstrzymano obracanie kolejką i zapisy stanu po wyczerpaniu przydziału. Jeden pusty przebieg zmienił wcześniej osiem wierszy, po poprawce zero. Pozostawiono dotychczasowe przydziały. Dedykowany zestaw przeszedł 816/816; w szerszym zestawie obie wersje miały te same 23 wcześniejsze niepowodzenia. Inny wariant podziału czasu i priorytetu terminu oceniono w symulacji na 9197 zadaniach. Przy 400 wyborach dawał 157 terminów w najbliższych 24 godzinach wobec 59 wcześniej. Ten pomiar nie jest dowodem działania nowej reguły na produkcji. [Wyniki kolejki i kod korekty](../../../session-deploy-20261125/priority-evaluation/reserve-git/release/copart-relisting/ODBIOR-REZERWY-20261125.md)

## Materiały kontrolne

* [Wynik wyszukania Forda po VIN na telefonie](ford-45516116-wynik.png) i [godzina na karcie tego samego auta](ford-45516116-termin.png). Chrome w emulacji 390 × 844.
* [Rejestr audytu z 17:34](../2026-11-24/STAN-AUDYTU-1734.md). Kryteria biznesowe przed obsługą odpłatnego zlecenia obejmują m.in. porównanie pełnej wyceny z dokumentami rozliczonego samochodu i uzgodnienie zasad umowy.

## Podgląd nowej ścieżki VIN

Na osobnym, istniejącym stagingu pełny VIN z zerem aktywnych wyników daje klientowi możliwość sprawdzenia zapisu archiwalnego. Przed kliknięciem nie są pobierane szczegóły. W Chrome 390 × 844 na stagingu po kliknięciu pojawiła się historia Tesli 65054066 z obserwacją 70 USD. Na izolowanej kopii zweryfikowano też ukryty i nieznany VIN, konflikty różnych numerów LOT oraz Subaru. Na zdalnym stagingu dla Subaru widoczny jest komunikat o chwilowej niedostępności, ponieważ to środowisko nie ma dostępu do prywatnej listy wyłączeń. Potwierdzono ponownie 2735 testów. Wersja stagingu `32fc91df-5ea7-4bc6-9e8f-3ac7974b4320` obsługuje podgląd; ten dodatek do wyszukiwarki czeka na decyzję o publikacji. [Sprawdź na Tesli](https://rexbid-audit-staging.tedn828.workers.dev/?catalog=1&s=7SAYGDED8TA458053#results) · [Odbiór w przeglądarce](../../../session-deploy-20261125/verification/staging-vin-browser.json)
