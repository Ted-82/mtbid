# Odbiór publicznej wersji testowej REXBID

24 listopada 2026 r. na [publicznym stagingu](https://rexbid-audit-staging.tedn828.workers.dev/) przeszły trzy ścieżki klienta w każdej z sześciu konfiguracji. Test klikał i wypełniał pola normalnie. Użył strefy Europe/Warsaw, oznaczenia ruchu testowego i wyłącznie żądań odczytu. Wersję `f2a176fa-f7dc-4f3e-819d-dde214b7e575` wskazuje [rejestr wdrożenia](./odbior-kontynuacji/stage-version.json). Odpowiedź strony miała nagłówek `X-REXBID-Environment: read-only-staging`.

| Przeglądarka | Rozmiary ekranu | Kalkulator otwarty z „Masz budżet?” | LOT oraz VIN małymi literami | Powrót z karty przez „Wróć do samochodów” |
| --- | --- | --- | --- | --- |
| Chrome 157 | 390 × 844 i 1366 × 768 | 2/2 | 2/2 | 2/2 |
| Firefox 159 | 390 × 844 i 1366 × 768 | 2/2 | 2/2 | 2/2 |
| WebKit 27.2 | 390 × 844 i 1366 × 768 | 2/2 po powtórzeniu mobilnego odczytu | 2/2 | 2/2 |

## Sprawdzony pojazd

**2025 Subaru Forester Touring, IAAI LOT 46294903, VIN JF2SLDTC5SH513294.** W chwili sprawdzenia odczyt danych karty zwrócił termin sesji zaplanowanej na 25 listopada o 14:30 UTC, platforma oznaczyła ofertę jako `open`. Sprzedawcą według zapisu jest Florida Farm Bureau Group, lokalizacją Orlando. Zarówno numer LOT, jak i VIN pisany małymi literami zwróciły dokładnie jeden identyfikator pojazdu. Każda otwarta karta miała właściwe dane i wyświetlała **25 listopada, godz. 15:30 czasu polskiego (CET, UTC+01:00)**. [Karta testowa](https://rexbid-audit-staging.tedn828.workers.dev/car?platform=iaai&lot=46294903&vin=JF2SLDTC5SH513294)

W kalkulatorze **30 000 zł dało limit 1 699 USD**, z szacowanym zapasem 55 zł. Wpisanie **100 000 zł zmieniło limit na 12 265 USD**, z zapasem 2 zł, bez ponownego naciskania przycisku. Kwoty powtórzyły się we wszystkich przebiegach, w których załadowano kalkulator. Ten test potwierdza działanie i spójność wyświetlanego szacunku. Osobny audyt taryf i podatków odpowiada za ocenę założeń finansowych.

Po kliknięciu katalogu, ustawieniu marki Subaru i rocznika od 2025 otwarłem tę samą ofertę i wróciłem przyciskiem karty. **W każdej konfiguracji zachowano oba filtry, listę wszystkich 20 widocznych identyfikatorów oraz ich kolejność.** Pierwsze cztery wiersze z pustym czasem regularnej sesji miały w danych termin zakończenia aukcji czasowej.

## Rozstrzygnięte rozbieżności

- We wcześniejszej próbie wybrano dawny przypadek testowy Copart 66837846. W chwili ponownego pomiaru wyszukiwanie zwróciło 0 ofert, a odczyt zapisanej karty zwrócił HTTP 404. Kalkulator pokazał brak oferty. Ten wynik nie pozwala ustalić przyczyny wycofania rekordu.
- Pierwsze próby ustawienia rocznika startowały podczas przejścia z głównej na katalog. Obie strony zawierają te same identyfikatory kontrolek. Po oczekiwaniu na docelowy adres katalogu i pojawienie się pierwszej karty wszystkie sześć kombinacji zachowało filtry i wyniki.
- W jednej mobilnej próbie WebKit zgłosił błąd połączenia TLS przed otwarciem strony. Inne ścieżki w tej samej przeglądarce zadziałały, a ponowne otwarcie kalkulatora i przeliczenie w pełni się powiodło. Przyczyna jednostkowego błędu TLS pozostaje nieustalona.

Wyniki przebiegów zapisano dla [Chrome](./STAGING-SMOKE-F2A176FA-chromium.json), [Firefox](./STAGING-SMOKE-F2A176FA-firefox.json) i [WebKit](./STAGING-SMOKE-F2A176FA-webkit.json). Druga seria obejmuje przeliczenie po samym wpisaniu kwoty w [Chrome](./STAGING-SMOKE-F2A176FA-chromium-input.json), [Firefox](./STAGING-SMOKE-F2A176FA-firefox-input.json) i [WebKit](./STAGING-SMOKE-F2A176FA-webkit-input.json). [Skrypt próby](./STAGING-SMOKE-F2A176FA.cjs) przyjmuje ścieżkę do zainstalowanego Playwrighta, katalog wyników, nazwę silnika i opcjonalnie `budget-input`. Test wykonywano na Windows z emulacją szerokości ekranu i dotyku. Potwierdzenie automatycznego importu na produkcji wymaga odrębnej obserwacji.
