# REXBID — panel realizacji importu i poczta firmowa

Data: 6 października 2026. Domena: `rexbid.pl`, zarejestrowana przez właściciela w OVHcloud. Dokument określa zakres i decyzje techniczne; nie potwierdza wdrożenia ani aktywacji poczty.

## Cel i własność

REXBID rozwijamy na istniejącym projekcie Cloudflare Workers/D1. Właściciel zachowuje administrację domeną, kontami usług i portalem. Doświadczenie wspólnika w imporcie wykorzystujemy do potwierdzania etapów, dokumentów i cen. Dostęp wspólnika do obsługi konkretnych zamówień może powstać jako osobna rola z ograniczonymi uprawnieniami; wspólne hasło administratora nie służy do współpracy.

Praca nad treścią i kodem w jednej sesji Work upraszcza sprawdzanie zgodności odpowiedzi z faktycznym działaniem aplikacji. Źródłem projektu pozostaje repozytorium i zaakceptowana baza plików. Nie tworzmy drugiej niezależnej wersji. Lokalny Codex może wdrożyć sprawdzony pakiet z tego samego repozytorium w środowisku mającym wymagany dostęp. Dostęp do usług, konfiguracja, koszty i publikacja wymagają rzeczywiście działającego uwierzytelnienia; sama zgoda właściciela nie tworzy sesji ani kluczy.

## Co potwierdzają publiczne materiały BidCars

Oficjalny harmonogram opisuje 16 etapów od wygranej i płatności za pojazd, przez odbiór, terminal, wysyłkę, odprawę i dostawę, do dokumentów i zakończenia obsługi. Zakładka Transport pokazuje odbiór z aukcji, przyjazd na terminal, ETD/ETA, numer kontenera i odbiór w UE. Mapa statku jest dostępna tylko dla części transportów. Galeria dokumentuje stan auta na terminalu. Skany dokumentów i powiadomienia o wysyłce oryginałów trafiają do klienta e-mailem/SMS.

Nie wykonano logowania do BidCars. Prywatnego wyglądu panelu, czatu z operatorem ani pobierania wszystkich dokumentów z dashboardu nie zweryfikowano. Takie funkcje w REXBID są naszym projektem. Nie kopiujemy przykładów danych, tekstów umów ani polityki bezpieczeństwa prywatnego panelu konkurenta.

Źródła oficjalne, sprawdzone 6 października 2026:

- Harmonogram: https://bid.cars/pl/schedule
- FAQ i opis zakładki Transport: https://bid.cars/pl/help

## Pierwszy panel realizacji REXBID

Klient po zalogowaniu ma widzieć wyłącznie własne sprawy importu. Każda sprawa zawiera pojazd, historię potwierdzonych etapów, lokalizację zapisaną przez operatora, szacowany termin przybycia, dane statku/kontenera, zdjęcia, dokumenty i wiadomości. Szacowany termin nie jest gwarantowaną datą dostawy. Bez integracji śledzenia statku nie przedstawiamy aktualnej pozycji na mapie.

Właściciel zakłada sprawę dla zweryfikowanego konta, uzupełnia potwierdzone informacje i udostępnia materiały. Notatki wewnętrzne nie trafiają do klienta. Każdy dokument i wiadomość są przypisane do sprawy. Pobranie załącznika wymaga autoryzacji dla tej sprawy; sam numer zamówienia albo znajomość adresu pliku nie daje dostępu.

Oznaczenia etapów dostosowujemy do rzeczywistej pracy partnera. Pierwsza wersja nie zakłada automatycznej licytacji, przyjmowania depozytów ani księgowania przelewów. Etap „płatność potwierdzona” wprowadzamy dopiero po rzeczywistym potwierdzeniu.

## Poczta: sprawdzenie istniejącego pakietu przed zakupem

OVHcloud obecnie podaje, że skrzynka Starter jest zawarta w cenie domeny. Publiczne strony różnią się informacją o pojemności: strona ogólna domen podaje 15 GB, a strona `.pl` 5 GB. Faktyczny zakres pakietu `rexbid.pl`, aktywację i dostępne skrzynki należy sprawdzić w koncie właściciela. Nie zamawiamy drugiego pakietu na podstawie samego założenia, że poczty nie ma.

- Oferta domen: https://www.ovhcloud.com/pl/domains/
- Oferta `.pl`: https://www.ovhcloud.com/pl/domains/tld/pl/
- Aktualna oferta poczty: https://www.ovhcloud.com/pl/emails/

Proponowany główny adres to `kontakt@rexbid.pl`. Jest to propozycja, nie adres potwierdzony jako aktywny. Skrzynka firmowa odbiera zwykłą korespondencję. Portal zapisuje rozmowę przy sprawie importu, aby historia obsługi nie zależała wyłącznie od jednego telefonu lub konta pocztowego.

Powiadomienia systemowe można wysyłać z osobnej subdomeny, np. `powiadomienia.rexbid.pl`, korzystając z dostawcy poczty transakcyjnej. Nazwa subdomeny nie oznacza jeszcze utworzonej skrzynki. Adres odpowiedzi powinien prowadzić do obsługiwanej skrzynki lub wdrożonego systemu wiadomości.

Resend obsługuje wysyłanie oraz odbieranie przez API/webhook. API przychodzące nie jest gotowym webmailem właściciela. W pierwszym etapie nie zmieniamy MX głównej domeny na inbound Resend. Taka zmiana wymaga osobnego planu odbioru i zachowania istniejącej poczty. Poczta transakcyjna i skrzynka kontaktowa mogą działać niezależnie.

- Weryfikacja domen i subdomen: https://resend.com/docs/dashboard/domains/introduction
- Odbieranie przez API: https://resend.com/docs/dashboard/receiving/introduction

SPF, DKIM i DMARC konfigurujemy u dostawcy, który faktycznie utrzymuje strefę DNS. Rejestracja domeny w OVH nie przesądza o lokalizacji DNS. Wartości rekordów muszą pochodzić z aktywnej usługi i jej konta; nie wklejamy przykładowych kluczy. Zmiany nie mogą przerwać działania obecnych nadawców ani odbioru poczty.

- DKIM OVHcloud: https://docs.ovhcloud.com/pl/guides/web-cloud/domains/dns-zone-dkim
- DMARC OVHcloud: https://docs.ovhcloud.com/pl/guides/web-cloud/domains/dns-zone-dmarc

Używany w projekcie Supabase Auth wymaga do produkcyjnej wysyłki e-maili własnego SMTP. Serwer domyślny służy testom, ogranicza odbiorców i nie stanowi produkcyjnej usługi doręczania. Konfiguracja nadawcy, domeny, limitów i próby doręczenia muszą być zakończone przed udostępnieniem recovery/confirmation klientom.

- Oficjalna instrukcja: https://supabase.com/docs/guides/auth/auth-smtp

## Odpowiedzi do klientów

Moduł `portal/reply-drafts.cjs` generuje deterministyczne polskie szkice dla właściciela: aktualizacja statusu, nowe pliki, aktualizacja terminu i potwierdzenie płatności. Korzysta wyłącznie z danych sprawy udostępnianych klientowi. Nie pobiera treści skrzynki, nie ustala adresata, nie korzysta z modelu AI i nie wysyła wiadomości. Każdy wynik ma `ready_to_send: false` i `requires_owner_review: true`.

Szkic nie dopisuje kwot, przyczyn opóźnienia, obiecanego terminu ani kompletności dokumentów. Późniejszy etap logistyczny sam w sobie nie potwierdza płatności. Szkic płatności wymaga jawnego potwierdzenia widocznego dla klienta; szkic nowych plików wymaga co najmniej jednego pliku oznaczonego jako klientowski. Notatki i pliki wewnętrzne są pomijane. Daty mają strefę Europe/Warsaw, a ETA pozostaje oszacowaniem.

W następnym etapie można wdrożyć zatwierdzane przez właściciela szablony powiadomień po wybranych zdarzeniach, kolejkę, historię doręczeń i obsługę błędów. Automatyczna odpowiedź zawierająca cenę, zmianę terminu, zobowiązanie lub rozstrzygnięcie reklamacji wymaga osobnego zakresu i zasad. Przy każdej sesji asystent może pomagać przygotować odpowiedź na podstawie wskazanej sprawy; ciągłe monitorowanie poza sesją wymaga faktycznie skonfigurowanej automatyzacji.

## Kontrola dostępu i uruchomienie

Konta właściciela w OVHcloud, Cloudflare, GitHub i dostawcy uwierzytelniania mają własne zabezpieczenia i MFA. Włączenie MFA w jednej usłudze nie zabezpiecza pozostałych. Konto właściciela portalu wymaga zweryfikowanego poziomu MFA; własność nie jest przyznawana z publicznego formularza, adresu e-mail ani edytowalnych metadanych użytkownika. Rola wspólnika, jeśli potrzebna, powstaje osobno.

Hasła obsługuje dostawca uwierzytelniania; portal nie przechowuje ich w postaci jawnej. Prywatne dane i treści załączników wymagają skonfigurowanych kluczy oraz uprawnień. Klucze są sekretami środowiska, a odzyskanie danych musi uwzględniać ich bezpieczne zachowanie i rotację. Logi nie mogą zawierać haseł, tokenów, treści prywatnych dokumentów ani pełnych danych klientów. Szyfrowanie uzupełnia kontrolę dostępu, kopie zapasowe i testy; nie daje obietnicy odporności na każde włamanie.

Przed publikacją potrzebne są: autoryzowane usługi, migracja i kopia właściwej bazy, prywatny magazyn załączników, klucze, potwierdzona konfiguracja MFA właściciela, testy izolacji kont, logowanie/reset w rzeczywistej przeglądarce, sprawdzenie poczty i procedura odtworzenia danych. Sam pakiet kodu nie potwierdza wykonania tych kroków na produkcji. Brak konfiguracji nadawcy pozostawia wysyłkę wyłączoną.
