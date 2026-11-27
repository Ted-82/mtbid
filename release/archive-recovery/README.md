# Wznowienie archiwum aukcji REXBID

`worker.archive-auto.js` zawiera dokładne bajty aktywnego wydania `700b5244-51ed-4bfe-8547-cd7b566d1607` z 27 listopada 2026. Suma SHA-256 to `ee7470f698dc32cb6e9b678fc9625013fc79a9bac3d850cc6c87bf34cbb36995`. Wydanie bazowe i punkt powrotu kodu to `8805e4d5-4fcf-4958-8790-bee995902e8b`. Zmiana dotyczy wyłącznie Workera `rexbid-auction-archive-auto` z harmonogramem co 5 minut.

- `auction-archive-recovered.cjs` weryfikuje zakres odtworzony przez Apibara REST dla paczki 18968, której oryginał wygasł. Czyta wyłącznie po dokładnie przypiętym punkcie i sprawdza sekwencje, źródło oraz SHA-256.
- `read-terminal-sidecar.cjs` sprawdza manifest i porcje odzyskanych wyników dla dużej paczki 25281. Czyta najwyżej dwie porcje po maksymalnie 64 KiB dla jednego odczytu okna. Zapis materiału po przetworzeniu nadal wymaga aktualnej ochrony widoczności, tożsamości i budżetu.
- Dla wygasłych kolejnych paczek działa odczyt kopii z prywatnego R2. Oryginalny rozmiar i suma kontrolna D1 obowiązują także dla kopii. Brak kopii zatrzymuje bieg w tym miejscu. Przy braku sprawdzonej galerii zapis prywatnego zadania poprzedza przesunięcie punktu. Istniejące karty nie są usuwane przez procedurę odzyskania.

Pliki źródłowe Apibara, wartości `REXBID_ARCHIVE_RECOVERY_PIN` i `REXBID_ARCHIVE_TERMINAL_PIN`, kopia indeksu i potwierdzenia R2 znajdują się w prywatnym katalogu operatora. Kopia indeksu sprzed wydania odzwierciedla sekwencję `106678308` i 18 890 galerii. Zachowaj najnowszy indeks przy rollbacku kodu, aby nie cofnąć zatwierdzonych galerii.

Testy uruchomiono lokalnie na rzeczywistej paczce i bezpiecznych obiektach testowych. Pokryły restart, niewłaściwą sumę, błąd zapisu zadania, zapis galerii z potwierdzoną ceną i wznowienie bez ponownego rozpakowywania paczki 25281. Osobny pełny audyt wymaga nadal automatycznego konsumenta prywatnej kolejki, ochrony późniejszych paczek przed retencją oraz pomiaru tempa odbudowy.
