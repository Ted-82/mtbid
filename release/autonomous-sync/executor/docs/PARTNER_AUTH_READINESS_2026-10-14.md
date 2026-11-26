# REXBID — materiały wspólnika i gotowość kont, 14.10.2026

## Zakres i wynik

Odczyt uzupełnionego arkusza, porównanie z pierwotnym formularzem, przegląd istniejącego kodu kont i portalu oraz aktualnej dokumentacji Supabase. Ten raport nie zmienia cen w kalkulatorze, usług, kont, haseł ani MFA. Aktualne zlecenie właściciela obejmuje rozwój i sprawdzone wdrożenia; starsze zapisy o konieczności osobnej zgody na każdą rutynową fazę nie są nową blokadą. Nowy zakup nadal wymaga przedstawienia konkretnej kwoty, a tożsamości i uprawnień nie wolno domniemywać.

## 1. Arkusz rzeczywiście zawiera nowe odpowiedzi

Źródło: `C:/Users/nowic/Documents/Codex/REXBID_PARTNER_MEETING_20261013/outputs/REXBID_Proste_pytania_i_odpowiedzi.xlsx`, arkusz **Pytania i odpowiedzi**. SHA-256: `3c84fb3178d4ebe3ba35b0e87f4fe22c46edfd093ec6778b357b768779ce035b`. Modyfikacja pliku: 13.10.2026 18:58:34 UTC; przyjęty do analizy 14.10.2026. Data pliku nie jest datą wejścia w życie wszystkich stawek.

Porównanie wartości A/B z zachowanym `build-simple.mjs`: **98 pytań, 74 niepuste odpowiedzi, 24 puste; 50 nowych odpowiedzi; 24 wcześniej przygotowane odpowiedzi niezmienione.** Brak formuł. Odczyt ZIP/XML; arkusza nie nadpisano i nie zmieniono formatowania. Niepuste pole nie oznacza pełnej lub jednoznacznej odpowiedzi.

### Ustalenia możliwe do wykorzystania z podanym źródłem

| Komórki | Ustalenie z arkusza | Granica wykorzystania |
| --- | --- | --- |
| B31:B32 | Port docelowy i odprawa: Rotterdam, Holandia | Można doprecyzować trasę; nie przesądza stawek podatku ani podstawy |
| B28 | Dopłata 150 USD również dla mild hybrid, hybrid i plug-in, obok BEV | Zmiana względem dotychczasowego BEV-only; FCEV nie nazwano, nie dopisywać |
| B29 | Obecne stawki V4 nadal aktualne według wspólnika | Brak daty końcowej i formalnego okresu obowiązywania |
| B33 | 180 USD dodatkowo do każdego auta za czynności załadunkowe/rozładunkowe i materiały | Zakres frachtu opisano niespójnie z B40; przed sumowaniem usunąć ryzyko podwójnego naliczenia |
| B41 | EUR brutto: rozładunek 500, pozycja „podatek” 10, deklaracja odprawy 100, paliwowa 15 | Suma liczb 625 EUR; pozycja „podatek 10” i jednostka pakietu wymagają doprecyzowania. Nie publikować jako kompletny potwierdzony pakiet |
| B43 | 14 dni bezpłatnie, później 15 EUR/dzień | Nie określono miejsca postoju, momentu rozpoczęcia ani zakresu demurrage/detention |
| B45 | Importerem ma być klient; składanie dokumentów za pośrednictwem REXBID | Wymaga zgodnego pełnomocnictwa i potwierdzenia przez brokera |
| B53 | Pośrednik zakupu opisany jako wliczony we fracht | Nie doliczać automatycznie drugi raz; potwierdzić dokładny pakiet |
| B58 | Oględziny zewnętrzne 250 USD | Oferta opcjonalna, ogólny zakres; brak warunków i standardu protokołu |
| B60:B62 | Kurs NBP z danego dnia, wycena orientacyjna na dzień sporządzenia, przelewy po stronie klienta | Potrzebna konkretna tabela/kurs i zasada dnia wolnego; koszt przelewów niepodany |
| B74 | 4–12 tygodni od wygranej do Europy, zwykle 6 | Szacunek, nie termin gwarantowany ani dostawa pod dom |
| B76 | Nieobsługiwane tytuły typu Junk, Non-repairable, Certificate of Destruction | Zachować ręczne sprawdzenie konkretnego dokumentu i kraju; nie wnioskować tylko z błędnie zapisanego kodu |

Dane telefonu/WhatsApp, osób kontaktowych i wykonawców są dostarczone w części pól, lecz nie kopiowano ich do tego raportu ani publicznego kodu. B110 dotyczące publicznego udostępnienia danych pozostaje puste. B17 odpowiada „nie podajemy” zamiast NM Entity ID; nie zastępować go EIN ani innym numerem.

### Krótkie zestawienie rozbieżności i braków

| Komórki | Problem | Potrzebne rozstrzygnięcie |
| --- | --- | --- |
| B33 i B40 | Raz zakres „od aukcji do portu”, dalej „łącznie z promem do Europy” plus 150 i 180 | Rozdzielić transport lądowy, morze, 180 USD obsługi i 150 USD właściwych napędów; wskazać, co już zawiera tabela V4 |
| B40 i B59 | Ubezpieczenie: 1% wartości auta albo 1% + 100 USD | Jedna formuła, podstawa, dobrowolność, zakres i udział własny |
| B41:B42 | „Podatek 10” bez rodzaju; skan ok. 60 EUR wstępny | Nazwa/jednostka pierwszej pozycji, opcjonalność i kwota skanu; nie traktować szacunku jak stałej |
| B46:B48 | Cło 19% nie ma potwierdzenia taryfowego; akcyza 3,2%/1,6% różni się od oficjalnych 3,1%/1,55% dla właściwych kategorii | Dokument brokera: klasyfikacja, kraj odprawy, podstawa i stawki. Nie wdrażać wpisanych podatków bez weryfikacji |
| B51:B52 | Copart: „okolice 1,5 wartości auta” bez jednostki i z poleceniem znalezienia tabeli; IAAI: „okolice 1,5%” | Właściwe oficjalne tabele konta, sposób płatności/licencja i dodatkowe opłaty; nie dopisywać brakującego % ani nie stosować ryczałtu 1,5% |
| B54:B55 | Prowizja/kaucja „2500 netto”, brak waluty i zasad przy przegranej/rezygnacji | Waluta, VAT, odbiorca i rozliczenie; nie dublować kaucji jako kosztu |
| B70:B73 | Dostawa do Warszawy „2500”, dalej indywidualnie | Waluta, netto/brutto, trasa i czy pozycje oznaczają tę samą usługę |
| B18 i B78:B79 | Pojawia się odrębny polski podmiot/osoba wystawiająca fakturę za pośrednictwo | Pełne dane i rola strony umowy, rozdzielenie faktur i odpowiedzialności. Nie przepisywać całej usługi automatycznie na jedną spółkę |
| B80:B88 | Brak uzgodnień dokumentów, zgody na licytację, zwrotów/reklamacji, retencji | Blokuje odpowiednie procesy sprzedaży i końcową treść dokumentów; nie blokuje katalogu |
| B90:B98 | Dane płatności i rachunków pozostają puste | Nie publikować instrukcji zapłaty ani numeru rachunku z domysłu |
| B106 | Brak zakresu osobnego konta wspólnika | Określić zadania i dostęp do klientów; nie przyznawać automatycznie praw właściciela |

Oficjalny portal podatkowy podaje stawki 3,1% oraz 1,55% dla wskazanych kategorii; same odpowiedzi wspólnika nie stanowią podstawy zmiany reguł podatkowych. Zwolnienia, klasyfikacja napędu, podstawa i data obowiązku wymagają osobnej weryfikacji. [Ministerstwo Finansów — stawki akcyzy](https://www.podatki.gov.pl/akcyza/stawki-podatkowe), [informacje o samochodach](https://www.podatki.gov.pl/en/vehicles-in-eu). Nie wykorzystano przestarzałej daty zwolnienia PHEV z angielskiej strony jako aktualnego terminu.

Wpisy B10, B100 i B105 nadal opisują stan sprzed uruchomienia domeny. Publiczny adres jest już aktywny; tych wcześniej wypełnionych odpowiedzi nie należy traktować jako bieżącego stanu wdrożenia.

## 2. Supabase — ostrzeżenie o uśpieniu

Załączony e-mail dotyczy **stagingu `rexbid-auth-test`, `ydfsuncohsntqwmtmnhe`**. Tekst informuje o planowanym uśpieniu po małej aktywności; nie potwierdza, że projekt już uśpiono. Odczyt panelu przez koordynatora 14.10.2026 około 17:41 CEST: **Healthy**, Frankfurt `eu-central-1`, Nano `t3a.nano`. Ogólny baner dostawcy o badanym problemie technicznym nie jest dowodem awarii naszego Auth.

Supabase Free dopuszcza uśpienie przy niskiej aktywności w okresie siedmiu dni. Pro usuwa uśpienie z powodu nieaktywności. Nie uruchomiono sztucznego ruchu utrzymującego projekt ani zakupu. Zasady dostępności nie są SLA i sam status Healthy nie potwierdza E2E logowania. [Oficjalna lista produkcyjna](https://supabase.com/docs/guides/deployment/going-into-prod).

Katalog produkcyjny korzysta z Cloudflare D1 i ma Auth OFF, więc ostrzeżenie stagingowego Supabase samo w sobie nie wyłącza przeglądania rexbid.pl.

**Aktualizacja własnego odczytu koordynatora:** osobny projekt produkcyjny `kkwbqzndildovbblbkcx` początkowo pokazał **Paused**. Po wyraźnej zgodzie właściciela koordynator uruchomił Resume. Końcowy odczyt **14.10.2026, 15:58 UTC / 17:58 CEST** potwierdził **Healthy**, region **West EU (Ireland)**, rozmiar **Nano**. Publiczne ustawienia Auth/SMTP odczytano po przywróceniu (poniżej). Healthy i poprawna konfiguracja nie zastępują rzeczywistego produkcyjnego testu wysyłki, rejestracji ani recovery.

### Opcjonalny pakiet niezawodności dla kont — zakup odłożony

Właściciel **odłożył Supabase Pro; zakup nie został zatwierdzony ani wykonany**. Obecne Free wystarcza dla działającego katalogu, który nie zależy od Supabase. Pro jest opcją usunięcia ryzyka pauzy z powodu nieaktywności przed regularną obsługą kont klientów, a nie wymogiem uruchomienia katalogu ani technicznym warunkiem przygotowania i testowania Auth. Przy pozostaniu na Free należy uwzględnić możliwość pauzy i potrzebę ręcznego Resume.

**Na teraz Supabase: 0 USD/mies. w posiadanym Free; nowy wydatek w tym zakresie: 0 USD.** Nie wykonano obniżenia płatnego planu — płatnego Pro nie uruchomiono. Poniższe 25/35 USD to przyszłe warianty, nie bieżący rachunek. Istniejące Workers Paid, Apibara oraz domena/poczta mają osobne rozliczenia.

| Pozycja | Propozycja i koszt |
| --- | --- |
| Cel | Konta produkcyjne bez automatycznej pauzy oraz zachowanie odrębnego stagingu |
| Dostawca/plan | Supabase Pro, obecna organizacja z dwoma projektami, dwa Micro |
| Nowy miesięczny koszt | Około **35 USD**: Pro 25 + dwa Micro po 10 − wspólny kredyt compute 10 |
| Koszt początkowy | Brak osobnej opłaty wdrożeniowej; naliczenie abonamentu/compute według checkoutu i cyklu rozliczeniowego |
| Razem z już posiadanym Workers Paid | Około **40 USD/mies.** bazowo, bez Apibara, odnowień domeny/poczty, podatków i przekroczeń |
| Kontrola | Spend Cap ON, dwa Micro, bez płatnych dodatków/PITR/Custom Domain/Phone MFA; obserwacja wspólnego zużycia |
| Ograniczenie | Spend Cap nie obejmuje compute i części dodatków, nie jest dowolnym twardym limitem kwoty faktury |

To odłożona propozycja. Jeżeli właściciel później wybierze tę opcję, nowy wydatek wymaga zatwierdzenia konkretnego checkoutu. Cena wynika z publicznego cennika odczytanego 14.10.2026. [Cennik](https://supabase.com/pricing), [rozliczanie organizacji](https://supabase.com/docs/guides/platform/billing-on-supabase), [Spend Cap](https://supabase.com/docs/guides/platform/cost-control).

Wariant z **jednym projektem Micro na Pro to około 25 USD/mies.**, a z dwoma około 35 USD/mies. Pozostawienie stagingu Free przy jednym produkcyjnym Pro wymaga różnych organizacji oraz transferu projektu; nie można mieszać planów w jednej organizacji. Nie przeniesiono projektów. Taki układ oszczędza około 10 USD/mies. względem dwóch projektów Pro, pozostawia ryzyko pauzy stagingu i dodaje operację organizacyjną. Obecnie pozostajemy przy Free i dwóch odrębnych projektach.

## 3. Konta i portal — co jest przygotowane

Odczyt plików produkcyjnych potwierdza target `rexbid-production-preflight`, D1 `c8a30088-70af-43a6-9a7f-c4018279d37d`, Supabase ref `kkwbqzndildovbblbkcx`. `wrangler.production-publication.jsonc` zachowuje Auth false, portal/files disabled i brak bindingu R2. Stan wdrożenia wymaga bieżącego odczytu przez koordynatora; sama konfiguracja pliku nie zastępuje metadanych zdalnych.

Istnieje generator faz `catalog → auth-setup → owner-setup → portal-no-files` w `scripts/prepare-production-publication.cjs`. Zachowuje dokładny produkcyjny origin i odrębny limiter, blokuje stagingowe zasoby i pliki w tych fazach. Nie ustawiono fikcyjnych wartości evidence na true.

Odczyt produkcyjnego panelu przez koordynatora **14.10 po Resume**:

- Site URL: `https://rexbid.pl`; jedyny dozwolony callback: `https://rexbid.pl/api/auth/callback?state=*`.
- Custom SMTP: przełącznik **ON**, host `smtp.resend.com`, port **465**, nazwa nadawcy **REXBID**, minimalny odstęp **60 s**.
- Wartości adresu nadawcy i użytkownika SMTP zostały zamaskowane przez przeglądarkę. Nie są świeżo zweryfikowane; obowiązuje wcześniejsze potwierdzenie właściciela konfiguracji produkcyjnego Resend i `no-reply@powiadomienia.rexbid.pl`. Hasła/klucza nie odczytywano.
- Szablon recovery ma polski temat i prawidłowy link `{{ .SiteURL }}/api/auth/recovery/confirm?token_hash={{ .TokenHash }}&type=recovery`, zgodny z przepływem ograniczonego grantu. To wzorzec, nie rzeczywisty token odzyskiwania.

Potwierdzanie e-mail było włączone według dokumentacji 7.10; nie przypisujemy temu ustawieniu nowego odczytu, jeśli nie było widoczne w aktualnej kontroli. Rzeczywista wysyłka produkcyjna, confirmation i recovery pozostają nieprzetestowane. Metadane sześciu sekretów potwierdzono podczas publikacji 12.10 bez odczytu wartości. Produkcyjny owner ID nie był przypisany.

Kod już rozróżnia rolę `owner`/`client` po tożsamości serwerowej (`portal/operations.cjs`), uprawnienia właściciela po dokładnym `REXBID_OWNER_USER_ID` i AAL2 (`auth/routes.js`). W profilu klienta są imię, kontaktowy e-mail i opcjonalny telefon; nie zmieniają adresu logowania. Osobna rola wspólnika ani dowolne nadawanie admina z przeglądarki nie są gotową funkcją.

### Kolejność uruchomienia bez domysłów

1. Stan Healthy oraz wymienione ustawienia Auth/SMTP odczytano 14.10. Przed uruchomieniem zweryfikować pozostałe ustawienia potwierdzania e-mail i limiter, świeży backup D1, migracje Accounts/portal oraz izolację. Zachować sekrety w usługach; nie kopiować stagingowych kont lub MFA. Ponowny odczyt już sprawdzonych pól jest potrzebny dopiero po zmianie lub odpowiednim upływie czasu.
2. Uaktualnić treści prywatności i retencji dla rzeczywiście uruchamianych kont. Nowy arkusz wnosi dodatkowy polski podmiot pośredniczący; ustalić jego rolę przed udostępnianiem mu danych klientów. Zlecenie rozwoju nie rozstrzyga brakujących zasad retencji.
3. Po przejściu bramek wdrożyć `auth-setup` na właściwą domenę. Właściciel sam rejestruje i potwierdza nowe konto produkcyjne. Nie wybierać pierwszego usera ani konta o odgadniętym e-mailu.
4. Odczytać zweryfikowane `issuer/subject` i mapowanie D1, a właściciel potwierdza, że to jego konto. Wówczas przypisać dokładny production owner ID. Nie zmieniać istniejącego staging ownera.
5. Na osobnym, przeznaczonym do QA koncie wykonać confirmation i recovery przez rzeczywisty e-mail: prośba w A, otwarcie w B, brak panelu przed ustawieniem hasła, nowe hasło, odrzucenie starego, replay/expiry/logout. Nie zmieniać hasła właściciela, nie logować linków ani tokenów.
6. W `owner-setup` właściciel osobiście skanuje nowy produkcyjny QR i potwierdza TOTP; administracja wymaga AAL2. Istniejący stagingowy czynnik pozostaje bez zmian. Nie włączać restartu pending TOTP jako obejścia.
7. Udostępnić portal bez plików i sprawdzić właściciela + dwa testowe konta: przypisania, role wiadomości, statusy, liczniki odczytu i bezpośrednie odmowy dostępu do cudzych realizacji.
8. Załączniki uruchomić po odrębnej kontroli prywatnego produkcyjnego R2, kluczy, PDF/JPEG/PNG, limitu rozmiaru/ilości/miejsca i operacji całego konta. Alarm kosztowy nie jest limitem rachunku. Zachować izolację internal/client i brak publicznych domen.

Przy regresji Auth wyłączyć jego fazę i wrócić do katalogu, zachowując utworzone już konta i dane. Sam rollback kodu nie odtwarza danych Supabase/D1/R2. Nie usuwać kont dla powrotu do wcześniejszej wersji. D1 nie zawiera haseł ani czynników Supabase, więc jego backup nie jest backupem tożsamości.

## 4. Rzeczywiste ograniczenia i prace niezależne

- Zachować ręczne stagingowe recovery E2E **na koncie testowego klienta**, potwierdzone przez właściciela. Nie opisywać jako testu hasła właściciela ani produkcji.
- Pięć pozycji sejfu: wcześniejszy ręcznie zgłoszony offline PASS na obecnym komputerze bez DPAPI; odtworzenie na drugim urządzeniu niepotwierdzone. SMTP, hasło DB i Apibara mają ręczne potwierdzenie zapisu, nie techniczną weryfikację. Sejfu nie odczytywano.
- Potrzebne działania właściciela w fazie kont: osobista rejestracja/potwierdzenie produkcyjnej tożsamości i własne TOTP; zakres roli wspólnika dopiero przed przyznaniem mu dostępu; rozstrzygnięcie konkretnych niejasności kosztowych/umownych tylko dla zależnych od nich funkcji. Pro pozostaje odłożoną opcją niezawodności — nie blokuje katalogu ani niezależnych prac nad kontami. Nie potrzeba haseł, kluczy ani kodów w czacie.
- Aktualny katalog, kontrolowane odświeżanie Apibara, wydajność, UI oraz przygotowanie bezpiecznych reguł kalkulatora można rozwijać niezależnie od produkcyjnego MFA i odpowiedzi bankowych. Nie zamieniać brakujących lub sprzecznych kosztów w zero.

W podzadaniu analizy arkusza i kodu nie wysłano e-maila, nie wykonano testu logowania/recovery ani zmiany usług. Resume wykonał koordynator po osobnym potwierdzeniu właściciela; jego wynik został przytoczony powyżej. Nowe kontrole koordynatora i wdrożenia opisuje raport bieżącego etapu.

## 5. Wdrożony w kodzie kalkulatora zakres ustaleń partnera

W istniejącym `public/rexbid-calculator-v4.js` przygotowano rozwijaną sekcję **Dalsze koszty i trasa — ustalenia do wyceny**. Nie dodaje skryptu, żądań sieciowych ani usługi. Pokazuje datę przyjęcia materiału 14.10.2026, Rotterdam/Holandię, pozycję obsługi 180 USD poza obecnym podsumowaniem oraz opcjonalne oględziny 250 USD poza sumą. Dla BEV przy potwierdzonym naliczeniu 150 USD wyraźnie mówi, że ta pozycja jest już uwzględniona i nie należy doliczać jej ponownie. Dla HEV/PHEV wskazuje nową informację 150 USD do uzgodnienia zakresu pełnej wyceny, poza obecnym podsumowaniem. Brak potwierdzonego dopasowania trasy lub napędu nie zamienia się w zero.

Zachowano istniejące V4: stawki transportu, mnożniki, obliczenia, zakres częściowej sumy i brakujące składniki. Nowa informacja nie jest pełną ceną importu. Nie zsumowano niejasnych opłat EUR, nie wdrożono sprzecznych podatków ani kwot bez waluty. Nie opublikowano danych prywatnych osób, rachunków ani kontaktów.

Kontrole lokalne rzeczywiście wykonane:

- `node --test tests/partner-reference.test.cjs tests/calculator-v4.test.cjs tests/calculator-polish.test.cjs tests/calculator-price-visibility.test.cjs`: **17/17 PASS**.
- Nowy test DOM potwierdza aktualizację komunikatu po zmianie napędu; przykład BEV 10 000 USD zachowuje znany subtotal **11 030 USD**, a HEV/PHEV/FCEV/nieznany napęd **10 880 USD** oraz brak wyliczonej opłaty za napęd. Dopłaty 180/250 USD nie są dodawane do obecnej sumy. Dla BEV 150 USD nie jest naliczane ponownie.
- Test DOM blokuje połączenia: **0 żądań sieciowych**. Oryginalne etykiety brakujących kosztów oraz częściowy wynik pozostają zachowane.
- `node --check public/rexbid-calculator-v4.js`: **PASS**.

To kontrole lokalne. Wersję wdrożenia, odświeżenie identyfikatora zasobu i kontrolę przeglądarkową po wdrożeniu zapisuje koordynator w raporcie zbiorczym.

## 6. Minimalne zależności następnego etapu

To lista dla konkretnych rozszerzeń. Nie wymaga ponownego podania potwierdzonych danych operatora, adresu, Rotterdamu ani obecnych stawek V4 i nie blokuje rozwoju publicznego katalogu.

1. **Rozszerzenie sumy importu:** jednym uzupełnieniem wskazać, co obejmują obecny fracht oraz dodatkowe 180 USD; rozstrzygnąć ubezpieczenie 1% czy 1% + 100 USD; nazwać „podatek 10” w pakiecie portowym i jednostkę opłat. Kwoty 150/180/250 USD mają źródło w arkuszu, ale ich samo podanie nie potwierdza wszystkich zasad naliczania.
2. **Opłaty aukcyjne i podatki:** potrzebny właściwy typ konta zakupu i płatności, żeby dobrać oficjalne tabele Copart/IAAI, oraz potwierdzona przez brokera podstawa/stawki dla odprawy w Holandii. Tabele i przepisy można sprawdzać samodzielnie; brakujących warunków konta ani niepoprawnych stawek nie należy zgadywać.
3. **Prowizja i dostawa do Polski:** waluta dla 2500 prowizji i 2500 dostawy, netto/brutto, czy dwa opisy dostawy oznaczają tę samą pozycję, oraz rozliczenie kaucji przy niewygranej/rezygnacji. Numery rachunków są potrzebne dopiero przed publikacją instrukcji płatności.
4. **Konta produkcyjne:** po technicznej gotowości właściciel sam potwierdza własne konto i ustanawia TOTP; zespół wykonuje produkcyjne E2E na osobnym koncie testowym, w tym confirmation i recovery. Zakup Pro jest odłożony i nie stanowi warunku tych prac. Konta wspólnika nie trzeba tworzyć, żeby uruchomić konta klientów.
5. **Obsługa klientów przez wspólnika i dokumenty:** przed nadaniem mu dostępu ustalić rolę dodatkowego polskiego podmiotu, zakres dostępu i retencję danych kont/realizacji. Dane bankowe, dodatkowe publiczne kontakty i pozostałe umowy blokują wyłącznie zależne od nich płatności, publikację kontaktów lub zawieranie konkretnych umów.
