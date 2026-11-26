# Porównywanie aut i domknięcie audytu D1 — 25.10.2026

## Zakres

Kontynuacja istniejącej platformy po `4de145bc01f493457de1ca994662b5f84bea6196`. Nowa porównywarka do trzech aut, poprawki identyfikacji ulubionych i naprawa kosztownego zapytania kontrolnego. Brak zmian stawek kalkulatora, danych aukcyjnych i klientów, schematu, kont, MFA, DNS, zakupów oraz pusha. **0 nowych requestów Apibara**; subskrypcja wygasła według właściciela.

## Funkcje

- „Porównaj” na wynikach katalogu, karcie auta i w ulubionych. Pasek wyboru, limit trzech, usuwanie, pusty stan, „Tylko różnice” i kopiowanie linku. Porównanie pokazuje zdjęcia, VIN, LOT, platformę, ceny, daty obserwacji, parametry, uszkodzenia, dokumenty i typ sprzedawcy.
- Wybrane identyfikatory LOT/platforma są przechowywane tylko w sessionStorage tej karty przeglądarki (`rexbid.compare.v1`). Maksymalnie trzy, bez danych konta i snapshotów cen. Zapis starszy niż 30 minut jest usuwany przy kolejnym odczycie; ręczne czyszczenie usuwa tylko ten wybór. Opis dodany do prywatności. Nie jest to automatyczne usuwanie o konkretnej minucie.
- Odczyt z istniejącego `/api/car`, D1/cache. Maksymalnie trzy odczyty na otwarcie; wybieranie przyciskami nie odpytuje API. Timeout 12 s, brak samoczynnych ponowień. Ręczne ponowienie dotyczy tylko błędnej kolumny. HTTP404 nie oznacza sprzedaży; niezgodna platforma/LOT nie jest prezentowana.
- Oferta, Kup teraz, oferta warunkowa i cena sprzedaży są osobnymi wierszami. Zero pozostaje zerem, brak danych nie staje się kwotą. Rzeczywista Tesla IAAI 43806658: końcowa kwota warunkowa 2975 USD pochodzi z `source_price_usd`; wcześniejsze `current_bid_usd=25` nie zastępuje wyniku. Sprzedaż pozostaje niepotwierdzona. Daty zachowane, nie przemianowano zapisów na świeże dane.
- Powrót porównanie → karta → kontakt → karta → porównanie zachowuje wybrane aukcje. Parametry powrotu ograniczone do bezpiecznej lokalnej ścieżki i poprawnych identyfikatorów.
- Ulubione konta wcześniej mogły otwierać kartę wyłącznie po VIN i używać snapshotu innego LOT-u. Link zachowuje VIN/platformę/LOT, a cache nie zastępuje właściwej aukcji inną aukcją tego VIN. Przebudowano sam widok zapisanych pozycji, bez zmian logowania i API uprawnień.
- Na telefonie tabela przewija się we własnym obszarze, bez rozpychania dokumentu; etykiety parametrów pozostają przypięte. Kolory granatowo-czerwone i oznaczenie ubezpieczyciela zachowane. Nieznany RCC nie jest oznaczany jako zweryfikowany ubezpieczyciel.

## Audyt D1 — przyczyna i rzeczywisty wynik

Wcześniejszy HTTP429/code7429 pochodził z **limitu czasu CPU pojedynczego zapytania**, nie z udowodnionego wyczerpania płatnego pakietu. Pełna odpowiedź: `D1 DB exceeded its CPU time limit and was reset.` Dotyczyła kontrolnego JOIN identyfikatorów receiptów z konkatenacją `history-import:`. Nie dotyczyła zwykłego otwarcia karty.

Zapytanie dostało indeksowalny warunek `l.listing_id=substr(p.scope_key,16)` z zachowaniem oryginalnej równości. Regresja SQLite: 3000 poprawnych rekordów i siedem błędnych przypadków; stary i nowy wynik równy 7, plan używa istniejącego indeksu po listing_id. Nie dodano indeksów ani migracji. Oryginalny skrypt audytu skopiowano przed zmianą. Rzeczywisty audyt obu D1, z odstępem 1,5 s i bez ponowień, zakończył się PASS.

| Stan odczytany 25.10 | Produkcja | Staging |
|---|---:|---:|
| Oferty | 4535 | 1817 |
| Snapshoty | 8301 | 3253 |
| Wydarzenia | 20989 | 19044 |
| Duplikaty platforma/LOT | 0 | 0 |
| Błędne powiązania wydarzeń | 0 | 0 |
| Niezgodność tożsamości receiptów | 0 | 0 |
| Błędnie oznaczone kompletne receipty | 0 | 0 |
| Naruszenia FK | 0 | 0 |
| Chronione tabele zgodne z baseline 20.10 | 8/8 | 8/8 |

Chronione: users, user_favorites, import_orders, import_order_events, import_order_messages, import_order_files, portal_customer_profiles, import_order_message_reads — kontrola liczby i SHA zawartości. Stan tożsamości/MFA w Supabase nie był zmieniany. Liczniki publicznych tabel nie spadły względem baseline, co **nie jest pełnym porównaniem każdej wcześniejszej wersji wydarzenia**. Audyt nie rozstrzyga ostatniego niepewnego zapisu kampanii20.10.

### Pokrycie historii na produkcji

| Wynik | Copart | IAAI |
|---|---:|---:|
| Oferty | 2106 | 2429 |
| Odczyt kompletny z wydarzeniami | 873 | 846 |
| Odczyt kompletny, pusty | 17 | 105 |
| Częściowy | 3 | 5 |
| Niepobrany | 1091 | 1428 |
| Błąd | 122 | 45 |

To stan zapisanej bazy, nie pełne pokrycie rynku ani świeże odczyty aukcji. Nie wykonano transferu publicznych danych do stagingu, siedmiu proponowanych indeksów ani wznowienia kampanii. Historyczny ledger pozostaje **7293 prób łącznie**, poprzedni etap2262; odczyt konta11249/30000 pochodzi z20.10 i nie określa obecnego abonamentu. Historyczny STOP56 zachowany.

## Weryfikacja i wdrożenia

- Pełny końcowy suite **1190/1190 PASS**; 19 nowych testów względem1171 poprzedniego checkpointu. Regresje obejmują zero/null, odrębne ceny, daty bez przesunięcia dnia, faktyczny kształt DTO oferty warunkowej, limit trzech, TTL, usuwanie tylko wyboru, timeout, błędną tożsamość, bezpieczne HTML/URL, częściową awarię, brak automatycznych ponowień, właściwy LOT ulubionych i blokadę providera po STOP.
- Generator stawek V4: 610 lokalizacji /24 stawek morskich, hash rex-partner-v4-f0a67460b203286f — bez zmian. Składnia zmienionych skryptów, git diff --check oraz walidacja rzeczywistego profilu publikacji PASS. Nie używano historycznego walidatora mtbid jako dowodu bieżącej produkcji.
- Staging desktop/mobile: dwie i trzy kolumny; czwarty wybór odrzucony z komunikatem; czyszczenie/pusty stan; przejście z katalogu i ulubionych. Filtr „Tylko różnice” usuwał identyczne wiersze. Zachowano dwa istniejące lokalne ulubione. Kalkulator Tesla10000USD → zapytanie zachowało purchase_usd=10000, VIN/LOT i return_to; kontakt→karta→porównanie PASS, bez wysyłania wiadomości.
- Staging i produkcja: Tesla Copart57660876 cena sprzedaży9100USD, Tesla IAAI43806658 oferta warunkowa2975USD i sprzedaż niepotwierdzona. Honda44593083 na stagingu ma wcześniejszy zapis25USD/KupTeraz2000USD; jej produkcyjny stan pochodzi z późniejszego odczytu. Różnych obserwacji środowisk nie utożsamiono. Na produkcji porównane Tesle zachowały datę20.10.2026,19:43; staging08.10.2026,22:16.
- Mobilne390×844: document clientWidth/scrollWidth375/375, tabela750px przewija się wewnętrznie; klawiatura ArrowRight przesunęła tabelę o40px. Desktop1366×1100 i mobile mają zapisane screenshoty. Nie deklarujemy pomiaru Core Web Vitals ani przyspieszenia całej witryny na podstawie tego testu.
- HTTP po finalnym wdrożeniu **22/22 PASS**: obie strony główne, porównanie, ulubione, kontakt, karta, nowe assety, po trzy rzeczywiste API aut z obu środowisk. D1 jako źródło; /ready catalog/assets/auth OK i refresh blocked; www→apex308 zachowuje ścieżkę i parametr porównania.
- Finalna produkcja **2eef63a9-32d3-4bb7-92de-8b43db92d933**; finalny staging **f0034777-cfca-48ed-aee5-b4afb0e7f26b**. Wcześniejsze pośrednie wydanie produkcyjne2cf5bc42 miało błędny fallback kwoty warunkowej w nowej porównywarce; finalny pakiet skorygował go po kontroli rzeczywistego DTO. Dane D1 nie były zmieniane.

Automatyczna kontrola odrzuciła jedną próbę końcowego deployu ze względu na zachowany harmonogram i flagę `enabled`. Nie obchodzono blokady. Osobny SELECT25.10 18:30UTC potwierdził `OPERATOR_STOP`, lease_owner=null, lease_until=null. Kod konfiguracji/harmonogramu nie zmieniał się; nabycie lease wymaga blocked_reason IS NULL przed utworzeniem transportu providera. Dodano offline regresję dwóch nowych instancji harmonogramu z utrwalonym STOP: zero wywołań providera, zero prób, niezmieniony stan. Ponowna ocena z tymi dowodami dopuściła wdrożenie; końcowy publiczny /ready nadal potwierdza blocked. Nie proszono właściciela o ponowne włączenie odświeżania ani nie rozszerzano uprawnień.

## Rollback i następny etap

Rollback wyłącznie kodu: produkcja **a9872685-d467-4d40-9e26-89e5acf85c2b**, staging **d837146e-35d9-42fb-948d-54c7ba8ded00**. Przypięty Wrangler4.149.0 i profile odpowiednio wrangler.production-publication.jsonc / wrangler.staging.jsonc. Zachować OPERATOR_STOP; po cofnięciu ready/katalog/karta/kontakt/konto. Nie przywracać starszej D1 dla tej zmiany UI. Wybór porównania można wyczyścić bez usuwania ulubionych.

Nadal zależne zadania: rozliczenie ostatniego niepewnego zapisu20.10 i pełne zachowanie wydarzeń, transfer publicznych danych na staging, aktualizacje aukcji po odnowieniu Apibara, potwierdzone brakujące koszty pełnego importu. Rzeczywisty E2E klient–właściciel w dwóch sesjach pozostaje odłożony przez właściciela; nie został zaliczony na podstawie testów syntetycznych. Dodatkowe nowe usługi/abonamenty: **0**.

Dowody: `C:/Users/nowic/Documents/Codex/REXBID_COMPARISON_20261025` — audyt, trace przed/po, kopia wcześniejszego skryptu, testy, logi wdrożeń, HTTP i screenshoty. Publiczne przykłady: https://rexbid.pl/porownaj?items=copart%3A57660876%2Ciaai%3A43806658 oraz https://rexbid.pl/?catalog=1 .
