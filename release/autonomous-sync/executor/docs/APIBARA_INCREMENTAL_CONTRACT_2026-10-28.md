# Ustalenia potrzebne do kompletnej synchronizacji plikowej

Stan28.10.2026. To notatka implementacyjna oparta na rzeczywistych plikach,
nie wiadomość wysłana do dostawcy ani zgoda na zmianę pakietu.

## Potwierdzone obserwacje

- Pliki4948–4996 mają kolejne granice zakresów sekwencji. Wewnątrz zakresów
  występują poprawne luki globalnej numeracji. Zachowujemy oryginalne bajty i SHA256.
- Dziesięć wpisów w pięciu zachowanych paczkach dotyczy Copart LOT75041876
  z niedozwolonym znakiem kontrolnym U+001A w VIN. Są w jawnej kwarantannie;
  nie poprawiamy identyfikatora i nie przypisujemy tych zdarzeń innemu pojazdowi.
- Przykład zdarzenia40563801, Copart67325176, `auction.rescheduled`:
  `auction.auction_at = "2026-11-03 17:00:00"`, bez strefy czasowej.
  Zdarzenie40565891, Copart73904546, `lot.created` również ma datę bez strefy.
  Samo `recorded_at` ma jawne `+00:00`. Nie dowodzi to strefy pola aukcji.
- `lot.created` zawiera markę/model/rok, VIN, termin, ceny i część danych o stanie;
  w sprawdzonym zdarzeniu nie było zdjęć, lokalizacji ani dokumentu. To nie jest
  pełna karta pojazdu. Istniejący rekord i naprawdę nowy LOT wymagają osobnej ścieżki.
- Aktualnie potwierdzone maksimum listy API na koncie:20pozycji, mimo Pro.
  OpenAPI opisuje limit zależny od uprawnień konta; nie zakładamy większej strony.
  Zwykła lista wspiera `updated_within_minutes`, ale aktualizacje cen mogą ponownie
  obejmować dużą część rynku. API nie opisuje osobnego odczytu całych kart dla
  listy wielu LOT w jednym wywołaniu.

## Pytania kontraktowe do wyjaśnienia

1. Czy wszystkie daty bez przesunięcia UTC w `before/after` pliku zmian oznaczają
   UTC, dla obu platform i pól `auction_at` / `timed_end_at`? Czy dostawca ujednolici
   format do jawnego ISO8601 ze strefą?
2. Jak dostawca zaleca efektywnie pobierać kompletną kartę i media nowych LOT
   w Pro: dodatkowy plik, zbiorczy endpoint czy odczyt pojedynczego pojazdu?
3. Czy może poprawić VIN dla LOT75041876 i wskazać zdarzenie korygujące?
4. Jak jednoznacznie uzyskać deklarowany początkowy checkpoint i identyfikator
   generacji z pobranego pliku/odpowiedzi, również przy użyciu `/latest`?

Źródła kontraktu:
[OpenAPI](https://apibara.tech/openapi/v1.json),
[przykłady odpowiedzi](https://apibara.tech/en/products/vehicle-auction-data-api/endpoints),
[synchronizacja bazy](https://apibara.tech/en/guides/copart-iaai-database-sync).
Przykłady API pokazują daty ze strefą; nie stanowią potwierdzenia znaczenia dat bez
strefy z rzeczywistego pliku zmian.

## Kontynuacja bez zgadywania

Pełny import snapshotu jest niezależny od tych pytań. W znanych ofertach można
planować potwierdzone ceny i zamknięcia aukcji, pozostawiając daty niejednoznaczne
oraz nowe/brakujące karty w trwałej kolejce. Żadna z tych częściowych aktualizacji
nie nadaje całej ofercie nowej daty potwierdzenia. Wymagane są pomiar napływu nowych
LOT, przepustowości ich uzupełniania i opóźnienia kolejki przed ogłoszeniem pełnej
automatycznej synchronizacji. Nie kupować większego pakietu na podstawie samej
liczby zdarzeń — liczyć unikalne pojazdy i rzeczywiste odczyty.

Indeks lokalny + reducer są przygotowane i przetestowane, lecz nie zastępują
autonomicznego procesu serwerowego. Następny operator ma zatwierdzać dane, kolejkę
i postęp pliku w jednej transakcji z kontrolą lease oraz pierwotnego stanu.
Globalny stream można ustanowić dopiero po rozliczeniu wszystkich paczek do
konkretnej granicy, bez utraty kwarantanny lub kolejki uzupełnień.
