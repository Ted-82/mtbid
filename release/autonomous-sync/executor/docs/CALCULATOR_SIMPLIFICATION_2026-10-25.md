# Uproszczenie kalkulatora — 25.10.2026

**Późniejsze domknięcie:** [etap porównywarki25.10](VEHICLE_COMPARISON_2026-10-25.md) ukończył zbiorczy audyt obuD1. Przyczyną wcześniejszego HTTP429był limitCPU zapytania kontrolnego; poprawiono JOIN bez migracji. Opis poniżej zachowuje rzeczywisty wynik wcześniejszego etapu. Apibara nadal OPERATOR_STOP, pełne rozliczenie kampanii20.10 pozostaje osobnym zadaniem.

## Wynik i wdrożenia

Ukończono etap interfejsu kalkulatora na istniejącym kodzie. Produkcja https://rexbid.pl — **a9872685-d467-4d40-9e26-89e5acf85c2b**; staging https://rexbid-auth-test.tedn828.workers.dev — **d837146e-35d9-42fb-948d-54c7ba8ded00**. Bez migracji, zapisów danych aukcyjnych i klientów, zmiany stawek, DNS, sekretów, MFA, ról ani nowych usług. Bez pusha.

Główny widok zawiera cenę zakupu, jeden duży wynik, krótką informację o zakresie i przycisk zapytania. Opłaty, trasa i pozostałe ustawienia są rozwijane. Przy nieustalonej klasie/napędzie ustawienia otwierają się, aby nie zakładać zaniżonej stawki. Uzupełniony budżet wyświetla szacunek PLN z dostawą; brak wymaganej kwoty przywraca sumę częściową. Potwierdzone zero jest osobną wartością. Własna wpisana cena usuwa nieaktualną prośbę o jej wpisanie.

Nowy przycisk przekazuje do kontaktu VIN, LOT, platformę, cenę, typ ceny, rzeczywistą datę zapisu i ścieżkę powrotu. Naprawiono obsługę dynamicznie dodanego linku, który wcześniej nie należał do statycznie przechwyconej listy odnośników. Formularz nadal tylko przygotowuje wiadomość lokalnie.

## Rzeczywiste kontrole

- Pełny końcowy suite: **1171/1171 PASS**. Dodano 7 regresji układu, kompletności PLN, 0/null, Kup teraz, nieznanej klasy/napędu, komunikatu własnej ceny i arytmetyki benchmarku. Starsze testy zmieniono tylko dla celowo uproszczonego widoku.
- Pierwszy pełny przebieg przed ostatnią poprawką komunikatu: 1170/1170 PASS. Ponowienie w sandboxie napotkało EPERM rename pliku tymczasowego testu; końcowy pełny przebieg w standardowym środowisku przeszedł. Nie jest to pominięty test.
- Generator stawek V4: 610 lokalizacji, 24 stawki morskie, rex-partner-v4-f0a67460b203286f — bez zmian. Składnia, diff-check i walidator rzeczywistego profilu publikacji PASS. Walidatory historycznego mtbid nie stanowią dowodu bieżącej produkcji.
- HTTP po wdrożeniu **14/14 PASS**: strony główne, karty, kontakt, nowy asset, API Hondy IAAI i historii Tesli Copart na obu środowiskach; produkcyjne ready oraz www→apex 308 z zachowaniem ścieżki i parametrów. Ready: katalog/assets/auth OK, refresh blocked.
- Przeglądarka staging desktop/mobile: Tesla Copart 57660876; 10 000 USD wejścia + transport 1 055/1 130 USD = 11 055/11 130 USD dla 4/3 aut. Stawki pozostają takie same. Dwa widoczne główne pola przy rozpoznanym aucie, ustawienia zamknięte.
- Rzeczywisty test kompletu pól na stagingu: syntetyczne wejścia 10 000 USD zakupu, 1 000 USD opłat, transport 1 055 USD, kurs 4 i sześć pozycji po 100 PLN dały **48 820 PLN**. Usunięcie VAT przywróciło częściowe 12 055 USD. To dane testowe, nie oferta ani cennik; po teście przeładowano kartę.
- Honda IAAI 44593083: 25 USD i Kup teraz 2 000 USD rozdzielone; nieznana klasa otwiera ustawienia; historia 3 ofert warunkowych zachowuje daty oraz surowy Sold on Approval, bez ceny sprzedaży. Galeria otwarta, przejście zdjęcie 1→2 i zamknięcie PASS. Jedna miniatura niedostępna — istniejący fallback działa.
- Produkcja desktop/mobile: nowy kalkulator, wynik transportu, zamknięte ustawienia, przejście do kontaktu i powrót do tej samej karty PASS. Przy szerokości 390 px dokument 375 px, bez poziomego przepełnienia. W sprawdzonym desktopowym wariancie (ta sama karta, panel szerokości 385 px) wysokość kalkulatora spadła **1550→723 px**, około 53%. To pomiar wysokości interfejsu, nie szybkości ładowania ani wynik dla każdego auta.
- Zachowane daty obserwacji: staging Tesla 08.10, produkcja 20.10. Nie przedstawiono ich jako dzisiejszego odczytu. Nie wysyłano wiadomości, nie zmieniano ulubionych ani danych panelu.

## Dane, Apibara i niedokończony etap 20.10

Apibara według właściciela wygasła. **0 nowych requestów Apibara** w tym etapie; żadnego wznowienia poprzedniej kampanii. Publiczne odczyty idą przez D1/cache. Produkcyjne automatic_refresh_state odczytane pojedynczym zapytaniem CLI: OPERATOR_STOP, lease_owner=null, rows_written=0. Po wdrożeniu /ready potwierdza blocked. Harmonogram istnieje, ale bramka zatrzymuje odczyty providera.

Poprzednia kampania zakończyła proces błędem 20.10 o 19:53:32 UTC: IMPROVEMENT_WRITE_FAILED / OPERATOR_D1_FAILED / HTTP 500 batch. Nie ma campaign-complete.json. Ostatni progress details-2050-of-4535 nie jest kompletnym pokryciem. Ledger: 2262 próby etapu, **7293 łącznie**, 1 ponowienie; 62 quota, 144 list, 2056 detail; completed 2112 to licznik operacji, nie liczba ukończonych aut. Ostatni historyczny odczyt konta 11249/30000 z 20.10 19:51 UTC nie opisuje obecnie dostępnej subskrypcji. STOP56 i wszystkie wcześniejsze pliki zachowane.

Zbiorczy audyt obu D1 w tym etapie **NIEUKOŃCZONY**: API zarządzania Cloudflare zwróciło HTTP429/code7429, także po kontrolowanej próbie z odstępem 1,25 s. Zatrzymano audyt, bez dalszej pętli i bez zapisów. Nie przypisujemy temu wynikowi PASS ani nie deklarujemy końcowego zachowania całej kampanii. Publiczny Worker nadal poprawnie odczytuje katalog, co nie zastępuje zbiorczego audytu. Nowej kopii D1 nie przywracano ani nie zmieniano schematu: bieżąca poprawka dotyczy tylko assetów.

## Kalkulacja ceny

[Porównanie screenshotów BidCars](CALCULATOR_BENCHMARK_BIDCARS.md) zawiera dokładne kwoty oraz niewyjaśnioną różnicę 408,36 PLN między sumą widocznych pozycji a pokazanym wynikiem. Nie kopiowano stawek ani dodawano kosztu wyrównującego. Nie obiecywano zgodności cen końcowych bez zgodnego zakresu usług, profilu aukcji, podatków, kursów i dostawy. Pełny automatyczny szacunek dla wszystkich aut pozostaje zależny od potwierdzonych danych komercyjnych; obecna suma częściowa nie jest ceną pod dom.

## Rollback i wznowienie

Rollback wyłącznie kodu: produkcja **1a42548b-efec-4e0f-912a-b76a8a114df9**, staging **c61c0bec-ef0a-44f0-b282-2abb0229aa6b**. Używać istniejącego przypiętego Wrangler i właściwego profilu/Workera. Po rollbacku sprawdzić ready, katalog, kontakt, konto oraz blocked. Bez przywracania starszej D1 dla zmiany UI i bez cofania nowszych danych, tożsamości/MFA.

Następne zależności: (1) zakończyć zbiorczy audyt D1 po ustąpieniu HTTP429 i rozliczyć ostatni niepewny zapis 20.10 z zachowanej odpowiedzi przed jakimkolwiek wznowieniem; (2) po potwierdzonym odnowieniu Apibara dopiero sprawdzić quota i plan wznowienia, bez powtarzania ukończonych pozycji; (3) transfer publicznych danych produkcja→staging i 7 proponowanych indeksów nadal niewykonane; (4) rzeczywisty produkcyjny E2E dwóch kont nadal odłożony przez właściciela; (5) potwierdzić zależne składniki pełnej oferty importowej. Żaden z tych punktów nie jest oznaczony jako ukończony przez wdrożenie kalkulatora.

Dowody lokalne: C:/Users/nowic/Documents/Codex/REXBID_UX_20261025 — logi testów/deployów, public-check.json, d1-audit-paced.log, screenshoty before/after desktop/mobile. Dodatkowy koszt usług: **0**. Stan gotowy do lokalnego checkpointu; jego hash podaje odpowiedź końcowa i historia Git.
