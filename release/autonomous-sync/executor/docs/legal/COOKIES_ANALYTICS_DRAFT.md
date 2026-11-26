# REXBID — pamięć przeglądarki i analityka

**DRAFT — REQUIRES OWNER/LEGAL REVIEW**

Operator i administrator danych w wariancie A: **REX AUTO CARGOLOOP L.L.C**, 1209 Mountain Road Pl NE, Ste N, Albuquerque, NM 87110, United States. Kontakt: kontakt@rexbid.pl. Użytkownik obsługuje korespondencję w imieniu spółki i pozostaje administratorem technicznym; bez zmiany uprawnień. NM Entity ID nieustalony; nie publikować numeru zastępczego.

Stan pakietu na 15.10.2026: publiczny katalog, karty, galerie, historia aukcji i obserwacji, Calculator V4, lokalne ulubione i kontakt działają. Dane katalogu są odświeżane w kontrolowanym harmonogramie; otwarcie strony nie uruchamia pobierania z providera. Zakres auth-setup dodaje opcjonalne konto, potwierdzenie e-maila, logowanie, odzyskiwanie dostępu, ulubione w chmurze i eksport danych konta. Zatwierdzona 15.10.2026 faza portal-no-files dodaje profil, przypisane realizacje, rozmowy i osobisty eksport; załączniki pozostają wyłączone. Wdrożenie i zatwierdzenie zasad panelu dokumentuje bieżący raport etapu. Właściciel zatwierdził 14.10.2026 kryteria kont i ich kopii; nie jest to opinia prawna ani wynik produkcyjnego testu e-mail E2E. Zakres techniczny: [ACCOUNT_DATA_PRIVACY.md](../ACCOUNT_DATA_PRIVACY.md).

Lokalne ulubione i historia obserwacji korzystają z localStorage. Nie ma TTL; usunięcie ulubionego nie usuwa oddzielnej historii. Użytkownik może wyczyścić dane witryny. Historia ma limit 500 obserwacji na pojazd, bez łącznego limitu pojazdów. Import starego klucza ulubionych nie usuwa go automatycznie.

Od 20.10.2026 powrót z karty pojazdu wykorzystuje także sessionStorage `rexbid.catalog-return.v1`: dozwolone filtry i kryterium wyszukiwania z adresu katalogu, liczba stron (maksymalnie 10), przewinięcie i czas zapisu. Brak danych konta, treści kontaktu i payloadów ofert. Zapis starszy niż 30 minut jest usuwany przy próbie odczytu; brak odrębnego zegara usuwania w zamkniętej stronie. Dane ofert odtwarza publiczne API D1/cache bez wywołań providera. Stan przycisku Wstecz nadal może korzystać z dotychczasowego history.state (ważność 2 minuty).

Nie podłączono zewnętrznej analityki marketingowej. Samo przeglądanie katalogu nie wymaga sesji konta. Nie deklarujemy braku technicznych cookies infrastruktury bez kontroli publicznej domeny. Osobna ocena wymogów dostępu do pamięci urządzenia nie sprowadza się do pytania, czy użyto cookies czy localStorage. Nie wdrażano nowego banera ani marketingu.

Formularz tworzy szkic w pamięci; kontekst pojazdu i opcjonalnej kwoty może być w URL nawigacji. Pobrany TXT i schowek pozostają u użytkownika. Szczegóły: [prywatność](../../public/prywatnosc.html), [retencja](../DATA_RETENTION_REVIEW.md).

## Opcjonalne konto

Obsługa kont używa zabezpieczonego cookie sesji dostępnego tylko dla serwera. Jego okres w przeglądarce wynosi do 30 dni od ostatniego ustawienia i może być odnawiany podczas korzystania z konta; nie jest to gwarantowany maksymalny czas całej sesji. Osobne krótkotrwałe cookies służą potwierdzeniu dostępu i odzyskaniu hasła. Lokalna kopia ulubionych konta nie zawiera tokenów logowania. Aplikacja usuwa ją przy wylogowaniu lub utracie autoryzacji; nie ma osobnego czasowego terminu wygaśnięcia. Przeniesienie lokalnych ulubionych do konta wymaga potwierdzenia użytkownika.

Cookie potwierdzania rejestracji ma do 24 godzin, ponowienia potwierdzenia lub prośby o recovery do 1 godziny, OAuth do 10 minut. Odrębny grant po otwarciu linku recovery ma 10 minut i sam nie umożliwia wejścia do konta. Czasy dotyczą kodu REXBID, nie retencji kont/logów u dostawcy ani ważności wiadomości e-mail. Szczegóły i ograniczenia: [inwentarz kont](../ACCOUNT_DATA_PRIVACY.md). Wersję wdrożenia i rzeczywiste testy potwierdza osobny raport; opis cookies nie jest dowodem produkcyjnego E2E.
