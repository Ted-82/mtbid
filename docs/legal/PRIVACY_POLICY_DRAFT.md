# Polityka prywatności Rex.Bid

**DRAFT — REQUIRES OWNER/LEGAL REVIEW**

Ten dokument jest technicznym szkicem opartym na obecnym kodzie. Nie jest poradą prawną ani publikowaną polityką. Przed użyciem właściciel musi wskazać administratora, adres kontaktowy, podstawy i okresy przetwarzania oraz zweryfikować role dostawców.

## Zakres danych widoczny w obecnej architekturze

- Supabase Auth może obsługiwać adres e-mail, dane logowania, potwierdzenie adresu i sesję dostawcy.
- Rex.Bid D1 przechowuje identyfikator użytkownika, issuer/subject, dostawcę logowania, stan potwierdzenia i znaczniki czasu oraz ulubione identyfikowane przez VIN lub LOT/platformę.
- Przeglądarka przechowuje gościnne ulubione i ograniczony cache ulubionych konta. Tokeny sesji nie są zapisywane w localStorage/sessionStorage.
- Sesja BFF jest przenoszona w szyfrowanym cookie `HttpOnly`, `Secure`, host-only. Cookie PKCE jest krótkotrwałe.
- Logi techniczne mają pomijać hasła, e-maile, tokeny, cookies i pełne treści formularzy; rzeczywisty okres retencji logów Cloudflare wymaga ustalenia.
- Dane pojazdów/aukcji są osobnym zbiorem od danych kont. Prawa do danych i zdjęć opisuje `docs/APIBARA_DATA_RIGHTS.md`.
- Rex.Bid przechowuje referencje URL do części zdjęć/miniatur dla wyświetlenia pojazdu. Są to third-party media; nie przechowujemy tu trwałego archiwum binarnych oryginałów. Retencja URL-i i metadanych wymaga potwierdzenia w polityce retencji.

## Prawa i ustawienia do ustalenia

Uzupełnić administratora i kontakt privacy, cele/podstawy, retencję kont/favorites/logów/kopii, region i umowy z Cloudflare/Supabase/dostawcą poczty, obsługę dostępu/sprostowania/usunięcia oraz mechanizm usunięcia konta. Usuwanie identity z Supabase wymaga backendowego uprawnienia administracyjnego, którego nie skonfigurowano. Nie deklarować pełnego usunięcia, zanim nie obejmie ono dostawców i backupów.

## Cookies i bezpieczeństwo

Sesyjne cookies są niezbędne do BFF Auth; szczegóły, czas życia i polityka zgody wymagają potwierdzenia. Nie ma podłączonego zewnętrznego analytics w obecnym zakresie. Końcową treść, podstawy prawne i wymagania zgody zatwierdza prawnik/właściciel.
