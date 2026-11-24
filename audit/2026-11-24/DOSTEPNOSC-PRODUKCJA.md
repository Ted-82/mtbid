# Galeria na rexbid.pl przy obsłudze klawiaturą

24 listopada 2026 o 20:55 czasu polskiego. Na publicznej karcie Toyoty Sienny LE 2014, Copart LOT 48332546, zaliczono 32 sprawdzenia obsługi galerii klawiaturą i 4 kontrole dostępności samej strony. W każdej próbie galeria miała 14 zdjęć. [Sprawdzona karta](https://rexbid.pl/car?platform=copart&lot=48332546&vin=5TDKK3DC8ES447415)

| Przeglądarka na Windows | Obszar strony | Próby funkcjonalne | Odpowiedź karty |
|---|---|---:|---|
| Chrome 157 | 390 × 844 i 1366 × 768 | 16/16 | HTTP 200 w obu próbach |
| WebKit 27.2 | 390 × 844 i 1366 × 768 | 16/16 | HTTP 200 w obu próbach |

Tab pozwolił dojść od początku dokumentu do przycisku głównego zdjęcia. Enter otworzył okno nazwane „Galeria zdjęć pojazdu” i przeniósł do niego fokus. Przeglądarki rozpoznawały wszystkie sześć widocznych kontrolek po polskich nazwach. Strzałka w prawo wybierała zdjęcie 2/14, a strzałka w lewo wracała do 1/14. Przy 32 naciśnięciach Tab i 32 naciśnięciach Shift+Tab w każdej próbie fokus pozostawał wewnątrz okna. Escape zamykał galerię i przywracał fokus do zdjęcia otwierającego. [Wyniki każdego sprawdzenia](browser/keyboard-gallery-production.json) · [Procedura powtórzenia](browser/keyboard-gallery-production.cjs)

Próba obejmowała przeglądarki na komputerze i emulowane rozmiary ekranu. Sprawdzenie z rzeczywistym czytnikiem ekranu, fizycznym telefonem i pełny odbiór WCAG 2.2 AA pozostają otwarte. Weryfikacja korzystała z publicznych odczytów, blokowała wysyłanie formularzy i zapis licznika wizyt.
