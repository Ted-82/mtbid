## Publikacja12.10.2026

REXBID jest już dostępny pod https://rexbid.pl . Wspólnik może samodzielnie sprawdzać katalog bez konta. Pokaz panelu nadal tylko na stagingu i danych testowych. Aktualne potwierdzenie domeny, ograniczenia i rollback: [PUBLIC_LAUNCH_QA_2026-10-12.md](PUBLIC_LAUNCH_QA_2026-10-12.md). Nie pomijać rzeczywistych dat danych8–9.10; przygotowanie świeżych przykładów13.10 nie zostało wykonane z wyprzedzeniem.

# REXBID — prezentacja i samodzielny przegląd wspólnika

Aktualizacja 12.10.2026. Termin spotkania potwierdzony: wtorek 13.10.2026 wieczorem. Nazwa pliku pozostaje zachowana dla ciągłości materiałów. Publiczny pokaz: https://rexbid.pl/ — wersja1cd69740-fda8-495a-a895-587f135cf077. Staging do osobnego panelu: https://rexbid-auth-test.tedn828.workers.dev/ — wersja85a44ee5-5b9d-4a6d-ac35-1b7456535a12; poprawiono link do auta w zapytaniu i zachowanie kwoty 0 USD. Dane aukcji pochodzą z 8–9 października, nie z chwili prezentacji. Katalog jest częściowy. Na Home sekcje bieżących aukcji mogą być puste po upływie terminu i wieku obserwacji; przechodzimy wtedy do całego katalogu. Nie zmieniamy dat, nie uruchamiamy providera dla pokazu.

## Samodzielny dostęp wspólnika

Wystarczy przekazać adres https://rexbid.pl/?catalog=1 . Działa na własnym komputerze i telefonie, bez dostępu do komputera właściciela i bez logowania do publicznych funkcji. Jest to działająca aplikacja na zapisanych rzeczywistych ofertach, a dane aukcyjne nie są transmisją na żywo ani pełnym rynkiem. Sprawdzać daty obserwacji.

- Katalog, filtry, dokładny VIN/LOT, galerie, zapisane historie i kalkulator można sprawdzać samodzielnie.
- Ulubione bez konta zapisują się na urządzeniu wspólnika; mogą zniknąć po wyczyszczeniu danych przeglądarki. Nie wymagają udostępnienia konta właściciela.
- Zapytanie tworzy treść lokalnie. Samo przygotowanie nie wysyła maila i nie zleca licytacji.
- Nie ma automatycznego składania ofert w domach aukcyjnych ani kompletnej ceny dostawy pod dom. Brakujące składniki kalkulatora są jawne.
- Panel realizacji to osobny pokaz na danych testowych z właścicielem. Ten link nie przyznaje uprawnień administracyjnych. Nie przekazywać hasła/MFA właściciela; w tym etapie nie utworzono konta wspólnika.

### Co wspólnik może zanotować

Dla uwagi wystarczy link do strony, VIN/LOT i platforma, zrzut, urządzenie/przeglądarka oraz krótko: co zrobił, czego oczekiwał, co zobaczył. Nie dołączać haseł, kodów ani danych klientów.

## Przygotowanie bezpośrednio przed spotkaniem 13.10.2026

1. Termin jest ustalony na 13.10 wieczorem. Właściciel wznawia pracę przed pokazem; nie uruchomiono harmonogramu ani automatycznego pobierania w tle.
2. W dniu przygotowania sprawdzić dostępność strony, aktualne zużycie Apibara i D1, istniejący postęp oraz kopię przed zapisami. Odświeżyć kontrolowanie dane w granicach obowiązującej zgody i dostępnego planu; wszystkie próby policzyć. Dane odświeżać możliwie blisko pokazu, aby dzisiejszego odczytu nie przedstawiać jutro jako bieżącego.
3. Wybrać ponownie przykłady Copart/IAAI, Kup teraz i BEV na podstawie otrzymanych danych, sprawdzić tożsamość, daty, ceny, media i readback. Potwierdzona sprzedaż pozostaje przykładem historii, nie aktualnej oferty.
4. Krótka kontrola desktop/mobile, galerii, filtrów, kalkulatora, ulubionych i kontaktu. Zaktualizować tę samą instrukcję oraz dokładny czas danych; zachować alternatywne auto, gdy zewnętrzne zdjęcia nie działają.
5. Jeśli źródło nie potwierdzi świeżości lub dostępności, wskazać to w pokazie. Nie zmieniać dat/etykiet w celu stworzenia wrażenia bieżącej oferty. REXBID został uruchomiony12.10 za zgodą właściciela; odświeżenie przed pokazem pozostaje kontrolowaną operacją z quota/backupem.

## Kontrola wykonana 12.10.2026

Repo: start c4241ebb7f09f0680e51891f0f8d50caa01aa52e, working tree czysty. Osiem publicznych odczytów detail/history: HTTP200, właściwe VIN/LOT/platforma dla wszystkich czterech przykładów. Detail potwierdza źródło D1. Honda:3 wydarzenia, Tesla Copart:1, Tesla IAAI:5; Polestar: historia **niepobrana**, nie pusta.

W przeglądarce katalog Polestar pokazuje 11 ofert i daty9.10 z ostrzeżeniem o konieczności odświeżenia. Honda rzeczywiście renderuje kartę,3 wydarzenia, terminal Elizabeth,NJ i CalculatorV4; klasy transportowej nie zgaduje. Lightbox działa, pierwsze zdjęcie załadowane845×633; miniatura17 niedostępna z widocznym komunikatem. Nie potwierdzono wszystkich zdjęć, wideo ani wszystkich kont/ekranów; nie powtarzano pełnego suite i mobileQA. Poprzednie wyniki nie są nowym pomiarem.

Zmiany tego etapu dotyczą instrukcji, bez aplikacyjnego kodu/deployu, D1, poczty, DNS, MFA, płatnych usług i pusha. Zero bezpośrednich requestów providera; zwykłe odczyty korzystają z D1/cache przy zachowanym wyłączonym fallbacku. Nie odczytywano ponownie licznika konta Apibara. Receipt poza Git: C:/Users/nowic/Documents/Codex/rexbid-partner-preview-20261012.json.

## Przykłady

| Pojazd | Link | Co pokazujemy |
| --- | --- | --- |
| Copart Polestar 3 2025, LOT60132756 | [Polestar](https://rexbid.pl/car?lot=60132756&platform=copart) | VIN7SYEA3YB4SG030485, zapis9.10 14:52CEST, oferta14200USD; miniony termin sam nie potwierdza zakończenia. Historia niepobrana, nie nazywać jej pustą |
| IAAI Honda Civic EX 2018, LOT44593083 | [Honda](https://rexbid.pl/car?lot=44593083&platform=iaai) | VINSHHFK7H51JU428898; zapis8.10 22:16CEST, oferta25USD iKupTeraz2000USD jako zapisane wartości;3oferty warunkowe. Nie obiecywać aktualnej dostępności |
| Copart Tesla Model3 2023, LOT57660876 | [Tesla Copart](https://rexbid.pl/car?lot=57660876&platform=copart) | VIN5YJ3E1EA3PF683202; źródło potwierdza Sold i9100USD. BEV, historia, galeria iV4:1055USD transport4auta/1130USD3auta; kwota częściowa |
| IAAI Tesla Model3 2022, LOT43806658 | [Tesla IAAI](https://rexbid.pl/car?lot=43806658&platform=iaai) | VIN5YJ3E1EA4NF186754;5ofert warunkowych, końcowa sprzedaż niepotwierdzona. Gardena nie daje jednoznacznego transportu, kalkulator nie zgaduje |

Honda iTeslaCopart: galeria i historie ponownie sprawdzone10.10. Polestar iTeslaIAAI pozostają alternatywami z wcześniejszego QA; przed pokazem sprawdzić zdalne zdjęcia. Nie gwarantować dostępności wszystkich URL-i. Własna cena jest założeniem użytkownika, nie bieżącą ofertą aukcji.

## Pokaz około 7–9 minut

1. **0:00–1:00:** Home → Przeglądaj cały katalog. Pokaż informację o częściowym zbiorze i daty danych. Filtr platformy i marki Polestar, roczniki, aktywne filtry. Nie interpretuj braku świeżej kategorii jako braku ofert na całym rynku.
2. **1:00–2:00:** Wyszukaj dokładny LOT44593083 lub VINSHHFK7H51JU428898. Otwórz Hondę. Pokaż osobno ofertę25USD iKupTeraz2000USD z informacją o zapisie.
3. **2:00–3:00:** Galeria/lightbox. Dane auta, VIN, dokument/title i zielony typ ubezpieczyciela. Etykieta typu nie jest indywidualną weryfikacją firmy.
4. **3:00–4:00:** Historia aukcji Hondy:3oferty warunkowe; szczegóły surowego statusu; osobna rozwijana sekcja naszych obserwacji.
5. **4:00–5:30:** TeslaCopart: potwierdzona sprzedaż9100USD. Kalkulator: potwierdźSedan, sprawdźBEV150USD oraz1055/1130USD transportu4/3auta. Brakujące koszty odprawy, podatków i obsługi pozostają poza sumą. To nie cena pod dom.
6. **5:30–6:30:** Ulubione na urządzeniu → przygotowanie zapytania z kartą auta → wymagane imię/e-mail/wiadomość, opcjonalny budżet. Wiadomość jest przygotowana lokalnie; wysyłamy ją dopiero w swoim programie pocztowym. Na pokazie nie wysyłaj.
7. **6:30–7:30:** Powrót do auta/katalogu, zachowane filtry. Krótki widok telefonu: filtry, galeria, historia i kalkulator bez poziomego przewijania.
8. **Opcjonalne 1–2min:** Osobny stagingowy panel testowego klienta i istniejąca realizacja/rozmowa. Ręczne wcześniejsze E2E właściciela: poprawni nadawcy, etap widoczny, plik wewnętrzny ukryty, klientowski pobrany. Ponowna sesja nie była sprawdzana10.10. Do tego pokazu zaloguj sam testowego klienta w /panel; nie pokazuj MFA, QR, haseł lub danych rzeczywistych klientów. Brak sesji nie blokuje katalogu.

## Materiały po spotkaniu

Wspólnik: port docelowy/kraj odprawy, zakres frachtu i cena/zakres pakietuport-broker-dokumenty, waluta/jednostka/netto-brutto/data obowiązywania. Zachowane stawki lądowe/morskie, preferowane terminale, mnożniki iBEV150USD nie wymagają ponownego dostarczenia. Pomysły na automatyczny refresh i kolejne integracje oceniamy osobno; nie przedstawiamy ich jako już uruchomionych.

Publikacja rexbid.pl oraz DNS nadal wymagają końcowej akceptacji gotowego pakietu. Zgoda na koszty została udzielona, nie uruchomiono nowych abonamentów w tym etapie.


## Prosta tabela do wspólnego uzupełnienia — poprawiona 12.10

C:\Users\nowic\Documents\Codex\REXBID_PARTNER_MEETING_20261013\outputs\REXBID_Pakiet_wspolnika_2026-10-13.xlsx

Właściciel uznał poprzedni wielozakładkowy arkusz za zbyt skomplikowany. Obowiązuje nowa prosta wersja: jedna zakładka, dwie kolumny — pytanie po lewej, odpowiedź po prawej. 98 pytań, 24 odpowiedzi już wpisane, 74 puste pola. Zielone dane są potwierdzone, żółte służą do wpisania odpowiedzi lub kwoty. Kolejność: firma/kontakt, znany transport, fracht/odprawa, opłaty, dostawy, dokumenty, płatności, strona. Najpierw port/kraj, zakres frachtu i pakiet port/broker/dokumenty. Rachunki i prywatne kontakty uzupełniać lokalnie poza Git. Poprzedni plik zachowany historycznie.
