# REXBID — wydanie testowe z 24 listopada 2026

## Trzy oddzielne składniki

| Katalog | Co zawiera | Punkt odniesienia |
|---|---|---|
| [public-site](public-site/) | Źródła strony, publicznego API, widoku testowego i jego testów. Wydanie testowe ma zablokowaną indeksację. | Publiczny staging REXBID. |
| [executor](executor/) | 16 plików do nałożenia na kompletny, działający proces zapisu ofert. Obejmują m.in. uzgadnianie LOT z VIN, pełną nazwę dokumentu, kolor i testy zgodności. | `large-delivery-20261124/executor`, wersja `a95d53bb-a169-4371-ba7c-08dae26a2431`. |
| [photos](photos/) | 3 pliki osobnego procesu uzupełniania galerii Copart. Ponowienie po VIN i obsługa pustej galerii podlegają dotychczasowym ograniczeniom. | `write-priority-20261122/photos`, wersja `0caccbfa-67a8-41e5-bd4c-500265d6df99`. |

Wdrożenie strony testowej i sprawdzenie wyglądu karty dotyczy pierwszego składnika. Każdy z dwóch procesów ma osobny kod wejściowy, konfigurację i wersję w Cloudflare. Do budowy używa się kopii właściwego procesu. Współdzielony kod na stronie i w wykonawcy może pochodzić z różnych wdrożeń. Wykonanie migracji D1, włączenie harmonogramów i zmiany w produkcji wymagają osobnego zatwierdzenia właściciela.

## Jak sprawdzić pliki i złożyć pełną kopię

[Rejestr SHA-256](operators-sha256.json) zawiera dla każdego pliku ścieżkę, sumę sprzed i po zmianie oraz rodzaj zmiany. Pusta wartość sumy początkowej oznacza nowy plik. Zachowano dwie identyczne kopie zależności sterujących pracą procesów, w tym moduł budżetu wykonawcy. Rejestr wskazuje także trzy bezpośrednie zależności procesu zdjęć z sąsiednich historycznych katalogów.

Polecenia poniżej można uruchomić w PowerShell z katalogu repozytorium. Do testów potrzebny jest Node.js z wbudowanym `node:sqlite`. Ścieżka `$kopie` ma wskazywać katalog zawierający sprawdzone kopie z 18, 19, 22 i 24 listopada oraz ich pierwotne zależności. Skrypt zatrzyma się, jeżeli suma pliku w kopii wyjściowej będzie inna niż w rejestrze. Skrypt wymaga nowej nazwy katalogu wyjściowego i sprawdza każdą sumę ponownie po złożeniu.

```powershell
node release/capture-operators.cjs --verify
$kopie = 'C:/Users/nowic/Documents/Codex/REXBID_BOOTSTRAP_20261101'
$nazwaProby = 'rexbid-proba-operatorow-01'
node release/capture-operators.cjs --assemble $kopie $nazwaProby
$proba = Join-Path $kopie $nazwaProby
```

Kompletne kopie powstaną jako `$proba/executor` i `$proba/photos`. Taki układ zachowuje względne ścieżki galerii do modułu budżetu wykonawcy oraz wcześniejszych bibliotek w katalogu kopii. Konfiguracje do lokalnego złożenia pochodzą z oryginalnych wersji. Klucze, katalogi sesji narzędzi i zainstalowane biblioteki są pomijane. Do samego złożenia i testów nie jest potrzebny dostęp do Cloudflare. Jeden test integracji dokumentu i koloru otwiera szablon z wydania strony. Poniższe polecenia podstawiają go na czas próby do lokalnego drzewa testów i przywracają wersję wyjściową.

```powershell
$kartaWydania = (Get-Item 'release/public-site/public/car.html').FullName
$plikProby = Join-Path $proba 'executor/public/car.html'
$poprzedniSzablon = [IO.File]::ReadAllBytes($plikProby)
Push-Location (Join-Path $proba 'executor')
try {
  [IO.File]::Copy($kartaWydania, $plikProby, $true)
  $testy = @(Get-ChildItem -LiteralPath tests -Filter 'feed-*.test.cjs' -File | ForEach-Object FullName)
  $testy += (Get-Item 'tests/listing-display-facts.test.cjs').FullName
  node --test --test-concurrency=4 @testy
  if ($LASTEXITCODE -ne 0) { throw 'Nie przeszły testy wykonawcy' }
} finally {
  [IO.File]::WriteAllBytes($plikProby, $poprzedniSzablon)
  Pop-Location
}
Push-Location (Join-Path $proba 'photos')
try {
  node --test repair.test.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Nie przeszły testy galerii' }
} finally { Pop-Location }
```

## Materiał wyjściowy i cofnięcie

Kopie źródłowe to `large-delivery-20261124/executor` i `write-priority-20261122/photos` we wspólnym archiwum technicznym. Odtworzenie obu drzew na innym komputerze wymaga również wskazanych w rejestrze zależności zdjęć i ich zależności. Brak takiej kopii jest powodem do wstrzymania publikacji procesu. W lokalnym katalogu audytu `master-audit-20261124/evidence` znajdują się skrypt budujący wydanie oraz `vehicle-executor-identity.patch` i `vehicle-gallery-identity.patch`. Pierwszy patch obejmuje samą kolizję LOT, a pełna nakładka wykonawcy w tym repozytorium zawiera dodatkowo obsługę informacji o pojeździe.

Przed zatwierdzonym wdrożeniem produkcyjnym trzeba ponownie sprawdzić wersje Workerów, wykonać kopię D1 i próbę odtworzenia oraz uwzględnić migrację `0019_catalog_exterior_color.sql`. W przypadku regresji każdy Worker można przywrócić osobno do właściwego identyfikatora wersji. Przy cofnięciu oprogramowania należy zachować dane użytkowników oraz historię aukcji zapisaną od momentu wdrożenia. Podane polecenia wykonują wyłącznie kroki lokalne.
