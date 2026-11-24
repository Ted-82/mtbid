# Archiwum aukcji — tempo publikacji i ponowne wystawienia

**24 listopada wieczorem archiwum przyjmowało galerie, ale jego najnowszy zapis dotyczył wyniku sprzed niemal sześciu dni.** Najwyższa sekwencja we wszystkich segmentach i w bieżącym indeksie to 105228496, paczka 18278, czas źródłowy 18 listopada o 20:27:35 UTC. W chwili kontroli, 24 listopada o 20:18:15 UTC, opóźnienie wynosiło 5 dni 23 godziny 50 minut. Ta obserwacja dotyczy zakończonych aukcji z galeriami. Import aktywnych ofert ma osobny proces. [Odczyt postępu](archiwum-punkt-kontrolny.json)

## Ile zapisujemy i co ogranicza tempo

| Pomiar UTC | Galerie | Paczka w archiwizatorze | Czas źródłowy najnowszego wpisu |
| --- | ---: | ---: | --- |
| 22 listopada, 18:44 | 8 004 | 17 752 | 18 listopada, 03:07 |
| 24 listopada, 20:18 | 13 652 | 18 278 | 18 listopada, 20:27 |

W ciągu 49 godz. 34 min opublikowano 5 648 galerii. Źródłowy czas wpisów przesunął się o 17 godz. 20 min. Opóźnienie zwiększyło się o **32 godz. 14 min**. Są to punkty pomiarowe, a intensywność aukcji w ciągu doby jest zmienna. [Pomiary porównawcze](archiwum-tempo.json)

Cloudflare wskazał w 100% wersję archiwizatora `85aa5440-f186-43bc-ae45-f5139f381de1`. Zegar uruchamia ją co pięć minut. Jej kod dopuszcza do dziesięciu zapisanych galerii na takie uruchomienie. To najwyżej 2 880 galerii na dobę przy wszystkich udanych wywołaniach. Zmierzona średnia wyniosła 2 735 dziennie, czyli **95% tego maksimum**. Pojedynczy przebieg ma też ograniczenie 38 przejrzanych zdarzeń i 110 sekund. Rejestr magazynu o 20:16 UTC wykazał **255,84 GB rezerwy** i brak alarmu. W kolejce okresowych ponowień indeksu było zero pozycji, a archiwizator miał do przejścia dalsze paczki po 18278. Brak zdjęć w konkretnym pojeździe nadal może mieć odrębną przyczynę. [Stan licznika i potwierdzony harmonogram](archiwum-tempo.json)

Przy takiej samej gęstości kwalifikujących się galerii jak w tym oknie nadążanie wymagałoby ok. 2,86 razy zmierzonej przepustowości. To warunkowy wynik dzielenia czasu obserwacji przez przesunięcie czasu źródła. Prognoza terminu nadrobienia wymaga pomiaru kolejnych okresów o różnej aktywności, wielkości zdjęć i operacji R2. W teście nie zmieniano progów ani budżetu. Przed ewentualnym zwiększeniem liczby galerii sens ma próba na przechowanej paczce, ile kosztuje jednokrotne przygotowanie listy zdarzeń, zapis porcji galerii i poprawne wznowienie po przerwaniu. Nie wymaga to przebudowy importu ofert.

## Czy jeden VIN ma dwie historie

Sprawdzono indeks główny i 31 z 53 jego niezmiennych stron dobranych z różnych miejsc uporządkowanych według sekwencji. W próbie 8 017 widocznych wpisów od rocznika 2018 było **8 017 różnych VIN**. Przy początku pomiaru indeks zawierał łącznie 13 649 galerii. Nie ma produkcyjnego przykładu dwóch cykli jednego VIN z tej próby. Przeszukano wpisy z czasami zapisu od 17 listopada 08:42 do 18 listopada 20:27 UTC. Dwie kolejne zwykłe wyszukiwarki VIN zwróciły odpowiednio Copart 73099996 za 2 000 USD i Copart 71934516 za 950 USD. Każda udostępniła 13 odnośników do zdjęć. W ramach tej kontroli pobrano tylko metadane. [Zasięg próby i wyniki](archiwum-powtorzenia-pomiar.json) · [pierwsza wyszukiwarka](https://rexbid.pl/archiwum?q=2FMPK3K99JBC38074) · [druga wyszukiwarka](https://rexbid.pl/archiwum?q=3N1AB7AP5KY279945)

W odizolowanej kopii przetestowano 19 wpisów tego samego VIN i LOT przeplatanych niepowiązanymi rekordami. Wyszukiwanie po VIN oraz po LOT zwróciło 12 właściwych wyników na pierwszej stronie i pozostałe 7 na drugiej, w kolejności sekwencji i bez obcych rekordów. Doszły testy dwóch wyników o tym samym VIN, LOT i dniu oraz test niewymyślania brakującej ceny. To kontrolowane przypadki testowe. [Wyniki testów](archiwum-regresja-i-rollback.json)

## Poprawka przygotowana na kopii wersji produkcyjnej

Odtworzono dwa błędy. Przy dwóch odrębnych, źródłowo potwierdzonych przejściach do sprzedaży jednego LOT tego samego dnia zapis oparty na dacie łączył je w jeden wpis. Późniejsze potwierdzenie kwoty dla dokładnie tego samego momentu sprzedaży było ignorowane, jeśli pierwszy zapis miał już status sprzedany i pustą cenę.

Przygotowana łatka porównuje platformę, LOT, VIN i dokładny czas sprzedaży z uwzględnieniem strefy, jeśli dostawca go przekaże. Dwa różne czasy jednego dnia wymagają w tym przypadku również odrębnych przejść niesprzedany → sprzedany u źródła. Późniejsza kwota uzupełnia wyłącznie pustą cenę jednoznacznego wyniku. Odrębne, już potwierdzone kwoty pozostają zachowane. Gdy źródło daje tylko datę i nie da się rozróżnić sprzedaży, poprawka nie dopisuje ceny na domysł. Przy ponowieniu test nie utworzył nowej galerii.

Zakres praktyczny zależy od danych Apibary. W zachowanej paczce 9987 było 189 terminalnych zdarzeń `lot.sold`. Z nich 167 podało dzień sprzedaży, żadne nie podało dokładnego `auction.last_sold_at` w danych po zmianie ani głównego `auction_id`. To pomiar jednej starszej paczki. Nowa logika nie odtworzy z tych pól godzin, których nie otrzymano. Potwierdzenie pełnej obsługi relistów wymaga rzeczywistej pary wyników i, w przypadkach niejednoznacznych, źródłowego identyfikatora cyklu bądź powiązania z historią pojazdu.

**Stan testów.** W pięciu zestawach dotyczących archiwum aktywna wersja przechodziła 43/43 istniejące testy. Dwa osobne testy odtwarzające błędy zawiodły na tej wersji. Po zmianie przeszło 48/48, w tym przetwarzanie dużej paczki, odtworzenie uszkodzonej pomocniczej listy bez utraty pozycji, limit miejsca, odnajdywanie segmentów i uprawnienia właściciela. Po próbnym nałożeniu i cofnięciu łatki wszystkie trzy pliki miały początkowe sumy SHA-256. [Łatka na aktywną wersję](archiwum-korekta-cykli.patch) · [sumy plików i próba rollbacku](archiwum-regresja-i-rollback.json)

**Warunek wdrożenia.** W roboczym katalogu głównej gałęzi audytu moduł archiwizacji różnił się od działającego wydania m.in. limitem zdekodowanej wielkości paczki. Łatkę przygotowano na zachowanej kopii odpowiadającej wersji produkcyjnej i niezależnej od frontendu. Przed opublikowaniem wymaga ona uzgodnienia wersji w Git, zapisania aktualnego indeksu R2 z odnośnikami do niezmiennych stron i potwierdzenia po kolejnym cyklu. Przy cofnięciu kodu wraca się do wskazanego wydania archiwizatora, zachowując obiekty i nowo opublikowane galerie. Ewentualna korekta błędnego historycznego wpisu wymaga oddzielnej, sprawdzonej i zaakceptowanej operacji na danych. Samo cofnięcie kodu nie koryguje już opublikowanych wyników.

**Wykonany test stagingowy i gotowy pakiet.** Uruchomiono cały proces archiwizacji na lokalnym Workerze z D1 i R2, na realnej paczce 9987. Kandydat odczytał oryginalny plik dwukrotnie zamiast siedem razy. Razem z większym głównym indeksem zmierzony ruch źródła i indeksu spadł z 23,94 do 8,72 MB. Po obu stronach siedem przebiegów przetworzyło cały plik 74 550 zdarzeń. W kontrolnej bazie szczegółów zgodność zapisanych wyników wyniosła 42/42, a liczba zapisów docelowego R2 wyniosła po 148. Pełne źródła, sprawdzony sposób odtworzenia, kompilacja i kryteria publikacji są w [pakiecie archiwizatora](archiwum-worker/README.md).
