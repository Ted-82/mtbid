# REXBID V5 — wykonane zmiany i weryfikacja

Data: 2026-10-06. Domena właściciela: **rexbid.pl**. Projekt: `Ted-82/mtbid`, Cloudflare Workers, D1, istniejący adapter Apibara.

## Stan wydania

**Kod V5 zaimplementowany i sprawdzony; niewdrożony.** Nie wykonano pushowania, deployu, zmiany DNS, migracji, synchronizacji ani zapisu do zdalnej D1. Staging nadal przedstawia wcześniejsze V4. Nie podajemy dotychczasowego stagingowego Version ID jako identyfikatora V5.

`wrangler whoami` zwrócił `You are not authenticated`. Bieżące środowisko nie ma autoryzacji Cloudflare; publikacja i sprawdzenie rzeczywistego wyglądu nowego wydania w przeglądarce pozostają do wykonania na koncie właściciela. Projekt nie został przeniesiony do innego hostingu.

## Zachowana baza

Paczka `REXBID_V4_2026-10-05_35adc6f.zip` zawierała 142 pliki zmian i manifest. Każdy plik sprawdzono względem rozmiaru i SHA-256. Odtworzono kompletny projekt na dokładnej bazie `5c781c7a6db9a8ac3f70aedb638f4543dfce16e0`, nakładając wszystkie zweryfikowane pliki V4. Lokalny checkpoint odtworzenia: `87b5647`. To odtworzenie zawartości dostarczonego V4, nie cofnięcie projektu do starszego main.

Przed pracami 343 z 344 testów głównego katalogu przechodziło. Jeden istniejący test generowania starszego cennika nie przechodził przez zmianę CRLF/LF w dwóch źródłowych tabelach Markdown. Przywrócono oryginalne bajty i zapisano ich reguły `.gitattributes`. Kwoty i wygenerowane stawki pozostały bez zmian. Dodatkowe 14 testów partnera znajduje się w podkatalogu; `npm test` teraz uruchamia także je.

## Rzeczywiste zmiany

| Obszar | Wynik |
| --- | --- |
| Home i katalog | Spójny granatowo-czerwony portal, mocniejsza hierarchia wyszukiwania, cztery kategorie, czytelna cena pod zdjęciem, przebieg/lokalizacja/LOT, proces importu i dalsze działanie. Zachowane filtrowanie i paginacja istniejącego API. |
| Karta pojazdu | Układ informacji, osobna aktualna oferta i Kup teraz, cena zakończonej sprzedaży oznaczona jako historyczna, galeria i materiał źródłowy, dokumenty oraz lista przed zakupem. |
| Dane D1 | Odczyt canonical `body_style`, `drive_type`, `fuel_type`, `transmission`, `engine_size_l`, `odometer.value/unit`, `condition.run_condition` i `condition.airbags`; bez podstawiania brakujących wartości. |
| Język | Tłumaczenie dokładnie rozpoznanych wartości parametrów; nazwy dokumentów sprzedaży pozostają oryginalne, nieznane opisy źródła pozostają dostępne. |
| Kalkulator V4 | Edytowalna cena własna przy braku oferty, poprawne opisy źródła ceny, czytelny subtotal i brakujące koszty, dostępne opisy pól i statusów. |
| Budżet w PLN | Osobny arkusz ręcznych kwot i kursu, wyraźne rozróżnienie pustego pola i wpisanego zera, kompletność, kopiowanie/pobieranie zestawienia z LOT/VIN. Nie dodano domyślnych podatków ani niepotwierdzonych taryf firmy. |
| Zapytanie | LOT/platforma/VIN, tytuł i założenia budżetu przechodzą z karty do kontaktu. Walidacja, edycja, kopiowanie i TXT. E-mail otwiera program pocztowy dopiero po konfiguracji zweryfikowanego adresu. Nic nie jest przedstawiane jako wysłana wiadomość. |
| Strony informacyjne | Przebudowane Kontakt, Jak to działa i O nas; jednolita typografia, kroki wyboru/importu i FAQ. Bez wymyślonych opinii, statystyk, telefonów i adresów firmy. |
| Nawigacja i cache | Aukcje prowadzą do aktywnego katalogu, bieżąca strona ma `aria-current`, Escape wraca do przycisku menu, zaktualizowane hashe zmienionych zasobów. Pięć starszych kopii HTML w root zsynchronizowano z public. |
| Preview domeny | Oddzielny `worker.preview.js` i `wrangler.preview.jsonc` dla `preview.rexbid.pl`; wyłącznie stagingowa D1, SELECT-only, brak providera/sync/auth mutacji, noindex i datowane dane. Stare snapshoty nie generują statusu LIVE ani countdownu. |

## Weryfikacja

- **401/401 testów PASS**, w tym 14 testów pakietu partnera i 43 testy dodane względem odtworzonego V4.
- **125 663 porównań obliczeń PASS**; dopasowanie 610 lokalizacji, stawki i funkcje obliczeniowe poza bindingiem UI nie zmieniły wyników.
- Generator V4: **PASS**, `rex-partner-v4-f0a67460b203286f`, 610 lokalizacji i 24 stawki morskie.
- Generator starszego partnera: **PASS** po odtworzeniu źródłowych CRLF.
- Validator konfiguracji, składnia skryptów i `git diff --check`: **PASS**.
- Parser czterech zmienionych/dodanych arkuszy CSS: **PASS**. To sprawdzenie składni, nie ocena renderowania.
- Build staging: **PASS**, assets 39, Worker 433.54 KiB / gzip 88.39 KiB, jedyna D1 `rexbid-auth-test-db`.
- Build preview: **PASS**, assets 39, Worker 338.51 KiB / gzip 69.88 KiB, jedyna D1 `rexbid-auth-test-db`.
- Testy formularza uruchamiają rzeczywisty HTML i skrypty w jsdom: walidacja, brak przesyłania danych osobowych, kontekst auta, mailto, schowek i jego awaria, pobieranie, klawiatura/menu.
- Wzór HTML powstał z rzeczywistego kodu Home/katalogu/karty/kontaktu i zapisanych publicznych odpowiedzi D1. Kontrola wykonania DOM: 0 błędów skryptów, 8 kart Home, 20 kart katalogu, poprawnie zamontowany kalkulator auta.

Testy DOM nie zastępują real-browser QA. Nie potwierdzono renderowania nowego V5 na 320/390/1440/1920 px, zalogowanych cloud favorites, recovery e-mail ani publikacji domeny. Stare zrzuty V4 zachowano jako wcześniejsze materiały, nie dowody nowego wyglądu.

## Dane i ruch zewnętrzny

Do wzoru pobrano tylko dwie publiczne odpowiedzi istniejącego stagingu: 50 pozycji katalogu i detal Tesla LOT 62674546 / Copart. Odpowiedzi wskazują odczyt D1. Brak nowych bezpośrednich wywołań Apibara w tej sesji; nie odświeżano katalogu i nie zmieniano limitów providera. Nie wykonano ponownego audytu całkowitych liczników D1. Katalog pozostaje częściowy.

## Rzeczy, których brakuje do działającej wersji komercyjnej

1. Publikacja sprawdzonego builda z konta Cloudflare i QA rzeczywistej witryny; konfiguracja strefy domeny musi być zweryfikowana na koncie właściciela.
2. Zweryfikowany adres kontaktu `REXBID_CONTACT_EMAIL`. Obecny formularz przygotowuje zapytanie, nie wysyła go przez backend.
3. Potwierdzony cennik obsługi, opłat, odprawy i dostawy; kwalifikacja pojazdów i podatków. Arkusz ręczny nie jest automatyczną ofertą pod dom.
4. Oddzielne testy produkcyjnego Auth, maila i synchronizacji ulubionych przed ich udostępnieniem na `rexbid.pl`.

## Materiały i źródła

`docs/qa/v5-professional-2026-10-06/` zawiera rzeczywiste logi testów/buildów, zapisane publiczne dane i wzór HTML. Wzór ma nieaktywne funkcje wymagające backendu; pokazuje zapis wyglądu, nie działające wdrożenie.

W bieżącej sesji ponownie sprawdzono https://bid.cars/en/ i https://dreambid.pl/en jako wzorce drogi od wyszukiwania do decyzji oraz https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ dla konfiguracji domeny. Projekt korzysta z własnego kodu, identyfikacji REXBID i dostarczonych stawek partnera.
