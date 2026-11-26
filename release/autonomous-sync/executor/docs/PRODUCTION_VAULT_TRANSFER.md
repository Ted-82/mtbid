## Aktualne potwierdzenie sejfu — 2026-10-07

Właściciel potwierdził **LOCAL VERIFYVAULT PASS — SAME COMPUTER** dla pięciu pozycji: REXBID_AUTH_COOKIE_SECRET, pełnego REXBID_PORTAL_DATA_KEYS, REXBID_PORTAL_ACTIVE_KEY_ID, SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY. Wszystkie wartości, cały keyring i aktywny ID były zgodne ze źródłem, bez użycia DPAPI. To ręcznie zgłoszony wynik rzeczywistego lokalnego weryfikatora; agent nie otwierał Bitwarden ani nie odczytywał sekretów.

Osobno zapisano produkcyjny klucz SMTP Resend, hasło bazy Supabase i APIBARA_API_KEY. Ich zapis ma status **MANUAL OWNER-CONFIRMED / NOT TECHNICALLY VERIFIED**. Nie regenerowano ani nie zmieniano sekretów.

Odzyskanie na drugim urządzeniu jest **NOT VERIFIED**. Lokalny PASS bez DPAPI nie potwierdza przenośnego odtworzenia danych Git/SQL/R2. Kopie zaszyfrowane DPAPI nadal wymagają osobnej przenośnej kopii. Nie trzeba powtarzać zakończonego transferu ani lokalnej kontroli. Zewnętrzny receipt zawiera wyłącznie nazwy i statusy, bez wartości sekretów.

Pięć pozycji nie wymaga ponownego wpisywania ani testowania na obecnym komputerze. Poniższa instrukcja pozostaje dostępna do przyszłego odtworzenia. Klucz SMTP, hasło bazy i APIBARA_API_KEY są już ręcznie zabezpieczone; nie prosić o ich wartości w czacie. Przed publikacją trzeba zainstalować zachowany klucz API w nowym Workerze, bez odczytu sejfu przez agenta.

---

## Historia wcześniejszych kontroli — poniższe statusy nie zastępują aktualizacji powyżej

# Produkcyjne sekrety REXBID → Bitwarden

Stan 2026-10-07: **MANUAL TRANSFER OWNER-CONFIRMED — pięć pozycji zapisanych w Bitwarden według potwierdzenia właściciela; odczyt z sejfu na obecnym komputerze i odzyskanie na drugim urządzeniu NOT VERIFIED**. Właściciel potwierdził normalne zamknięcie programu po transferze oraz brak przesyłania wartości w czacie. Nie obserwowano niezależnie końcowego stanu schowka. Nie zmieniono kluczy, Workera, D1, R2, DNS, stagingu ani MFA. Sejf obsługuje wyłącznie właściciel; narzędzie nie zna hasła głównego, nie łączy się z Bitwarden ani inną usługą.

## Co obejmuje kontrolowany transfer

Każda pozycja otrzymuje osobny wpis typu **Login** w Bitwarden:

| Nazwa pozycji | Status źródła | Zawartość pola Password |
| --- | --- | --- |
| REXBID_AUTH_COOKIE_SECRET | PASS | Istniejący sekret cookie, bez zmiany |
| REXBID_PORTAL_DATA_KEYS | PASS | **Cały** keyring JSON, wraz z zachowanymi starszymi IDs |
| REXBID_PORTAL_ACTIVE_KEY_ID | PASS | Dotychczasowy aktywny ID |
| SUPABASE_URL | PASS | URL niezależnego projektu produkcyjnego, metadane konfiguracji |
| SUPABASE_PUBLISHABLE_KEY | PASS | Dotychczasowy publishable key produkcji |

Nazwa wpisu: **REXBID production — nazwa pozycji**; pole **Username**: nazwa pozycji; pole **Password**: skopiowana wartość; **URI pozostaje puste**, aby wyłączyć automatyczne uzupełnianie na stronach. Nie używać pól ukrytych z limitem krótszym niż pełny keyring. JSON jest normalizowany do jednej linii, z zachowaniem wszystkich nazw i wartości kluczy; nie eksportuje się jedynie aktywnego klucza.

Źródła są sprawdzane przed transferem:

- chroniony katalog `C:/Users/nowic/Documents/Codex/private-backups/rexbid/production-environment-20261006T182151Z`: aktywny plik wskazany w `manifest.json` to **new-production-keys-v1.json.dpapi**. Zastąpiony plik bez `-v1` nie jest używany;
- chroniony katalog `C:/Users/nowic/Documents/Codex/private-backups/rexbid/production-auth-20261007`: **production-supabase.json.dpapi**;
- kontrola ACL katalogów i plików, brak reparse points, zgodność checksum manifestu kluczy, format całego keyringu, aktywny ID oraz dokładny produkcyjny projekt Supabase. Brak starego osobnego manifestu checksum dla kopii Supabase uzupełnia uwierzytelnienie DPAPI i walidacja konfiguracji; nie jest to dowód porównania z aktualnym secret store Workera.

## Uruchomienie na obecnym komputerze

1. Zaloguj się na **to samo konto Windows**, które ma kopie DPAPI. Nie uruchamiaj jako inne konto lub administrator. Odblokuj swój Bitwarden, wyłącz nagrywanie i udostępnianie ekranu. W Windows **Ustawienia → System → Schowek** wyłącz **Historię schowka** oraz **Synchronizację między urządzeniami**; usuń wcześniejszą historię. Zamknij dodatkowe menedżery schowka i nie używaj RDP z przekierowaniem schowka.
2. Dwukrotnie kliknij:
   `C:\Users\nowic\Desktop\stona_auta-www\scripts\production-vault-launch.cmd`
   Alternatywnie w PowerShell uruchom wyłącznie ten publiczny kod, bez sekretów w poleceniu:
   ```powershell
   powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "C:\Users\nowic\Desktop\stona_auta-www\scripts\production-vault-transfer.ps1" -Mode Transfer
   ```
   Bypass dotyczy jedynie uruchamianego procesu; nie zmienia systemowej polityki PowerShell. Nie omijaj blokady firmowej polityki lub antywirusa. W takim przypadku STOP i odczyt bezpiecznego kodu błędu, bez wyświetlania wartości.
3. W oknie potwierdź przygotowanie schowka. Dla każdej z pięciu pozycji kliknij **Kopiuj do schowka na 45 sekund**, wklej do pola **Password** właściwego wpisu w Bitwarden i zapisz. Zaznacz **Wkleiłem i zapisałem tę pozycję w Bitwarden**, następnie **Wyczyść i przejdź dalej**. Po ostatniej pozycji okno kończy pracę i ponownie czyści schowek.
4. Gdy potrzebujesz przerwać, użyj **Wyczyść i zakończ**. Zajęty schowek blokuje normalne zamknięcie zamiast zgłaszać sukces. Przy awarii lub siłowym zamknięciu procesu, po zamknięciu aplikacji blokującej schowek uruchom `production-vault-clear.cmd` z tego samego folderu. Ten awaryjny launcher czyści bieżący schowek, nie historię innych programów.

Narzędzie nie pokazuje wartości w oknie ani terminalu. Publikuje formaty Windows wyłączające zapis do historii/cloud clipboard **przed** tekstem, w jednym otwarciu schowka; nie ma niezabezpieczonego fallbacku. Sam zapis w sejfie jest Twoją czynnością i deklaracją, nie wynikiem automatycznego API Bitwarden.

### Granice ochrony schowka i pamięci

Normalne zakończenie, przejście dalej i upływ 45 sekund czyszczą schowek. Weryfikator ma 30-sekundowe czyszczenie po wklejeniu i ponowne czyszczenie przy sprawdzeniu/zamknięciu. Awaria Windows, wyłączenie zasilania, zabicie procesu, malware, zewnętrzny clipboard manager, RDP lub nagrywanie ekranu nie są objęte gwarancją. Nie ma jawnego eksportu ani plików tymczasowych z wartościami; .NET/Windows mogą utrzymywać kopie w pamięci/pagefile lub crash dump. Nie włączać transkrypcji wartości, pełnych dumpów ani debugowania procesu podczas transferu. Nie należy opisywać tego mechanizmu jako odpornego na przejęty komputer.

## Weryfikacja na obecnym komputerze — odrębny wynik

Zapis pięciu pozycji został potwierdzony ręcznie przez właściciela 2026-10-07. Teraz użyć **VerifyVault**, a nie ponownie Transfer. Odczyt z Bitwarden na obecnym komputerze może potwierdzić zgodność zapisanych wartości, ale nie jest odzyskaniem na drugim urządzeniu, odtworzeniem produkcji ani porównaniem z aktualnymi sekretami Workera.

1. Zachowaj wyłączone historię/synchronizację schowka i dodatkowe clipboard managers; bez RDP, screenshotów i nagrywania. Odblokuj Bitwarden samodzielnie.
2. Uruchom `C:\Users\nowic\Desktop\stona_auta-www\scripts\production-vault-verify.cmd`. Powinno otworzyć pięć maskowanych pól i przycisk **Sprawdź i wyczyść schowek**. W rozmowie przekazuj tylko etap/wynik, nie wartości.
3. Dla każdego wpisu **REXBID production — nazwa pozycji** użyj w Bitwarden kopiowania pola **Password** i od razu wklej do właściwego maskowanego pola: REXBID_AUTH_COOKIE_SECRET → REXBID_PORTAL_DATA_KEYS → REXBID_PORTAL_ACTIVE_KEY_ID → SUPABASE_URL → SUPABASE_PUBLISHABLE_KEY. Nie używaj edytora pośredniego ani odsłaniania. Cały keyring pozostaje jedną linią JSON; nic nie przepisuj ręcznie.
4. Kliknij **Sprawdź i wyczyść schowek**. Zapisz wyłącznie PASS, FAIL lub bezpieczny kod błędu. Program czyści pola również po błędzie; przy `VAULT_CLIPBOARD_BUSY` zamknij aplikację blokującą schowek i ponownie wklej wszystkie pięć pól przed ponowną kontrolą. Nie regeneruj żadnej wartości.
5. Po kontroli wybierz **Wyczyść i zakończ**. Przy awarii korzystaj z `production-vault-clear.cmd`. Timer weryfikatora czyści schowek po 30 sekundach od ostatniej zmiany pola; zakończenie ponownie czyści schowek.

W raporcie występują osobne pola: **MANUAL TRANSFER OWNER-CONFIRMED**, **LOCAL VAULT READBACK PASS/FAIL/NOT VERIFIED**, **OTHER-DEVICE VAULT READBACK PASS/FAIL/NOT VERIFIED**. PASS na tym komputerze nie zmienia `portable_off_device_backup=false`; ta bramka wymaga rzeczywistego drugiego urządzenia. Obecnie oba odczyty mają status NOT VERIFIED. Nie przekazywać wartości ani screenshotów pól w rozmowie.

## Kontrola zapisanych pozycji bez oryginalnego DPAPI

W chronionym katalogu `production-auth-20261007` istnieje **vault-verification-proof-v1.json**. To trwały lokalny dowód integralności: nazwy, losowy nonce oraz HMAC, **bez wartości sekretów**. Nie jest eksportem umożliwiającym odzyskanie kluczy. Nie dodawać go do Git; kopię zachować z dokumentacją odtwarzania poza repo.

Przygotowano już kompletny folder do skopiowania na drugie urządzenie: **`C:/Users/nowic/Documents/Codex/vault-transfer-kit-20261007/portable-verifier`**. Zawiera cztery publiczne pliki narzędzia i dowód HMAC; **nie zawiera źródłowych DPAPI ani sekretów**. Możesz skopiować cały ten folder zamiast kompletować pliki ręcznie.

1. Na innym kontrolowanym komputerze Windows z Windows PowerShell 5.1/.NET Framework skopiuj **tylko publiczne narzędzia** `production-vault-core.cs`, `production-vault-transfer.ps1`, `production-vault-verify.cmd`, `production-vault-clear.cmd` oraz `vault-verification-proof-v1.json` do jednego folderu. Nie kopiuj źródłowych plików DPAPI w celu tej kontroli. Publiczne pliki narzędzia są w `scripts/`; dowód jest w chronionym katalogu powyżej.
2. Otwórz Bitwarden na tym urządzeniu. Wykonaj te same przygotowania schowka. Uruchom **production-vault-verify.cmd**. Wklej pięć zapisanych pól Password do maskowanych pól. Keyring wklej jako kompletną jedną linię JSON, bez ręcznych zmian.
3. Kliknij **Sprawdź i wyczyść schowek**. **PASS** wymaga zgodności wszystkich pięciu pozycji, każdego zachowanego klucza oraz aktywnego ID. Żadna funkcja odczytu DPAPI nie jest wywoływana w tym trybie. Pola są czyszczone po sprawdzeniu; schowek jest czyszczony po wklejeniu, sprawdzeniu i zakończeniu. Przy FAIL nie regeneruj kluczy: sprawdź kompletność i zapis właściwych pozycji w sejfie.

Bezpośrednie polecenie dla przeniesionego folderu:
```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File ".\production-vault-transfer.ps1" -Mode VerifyVault -ProofPath ".\vault-verification-proof-v1.json"
```

Po rzeczywistym PASS na drugim urządzeniu można zapisać **nowy zewnętrzny receipt** z datą, nazwami pozycji, wynikiem oraz `portable_off_device_backup=true`. Dotychczasowy status pozostaje false/NOT VERIFIED, dopóki właściciel tego nie wykona. Lokalny test formatów/proof lub deklaracja zapisania wpisów nie jest testem odzyskania z Bitwarden. Nie wysyłaj wartości ani screenshotów pól.

Wartości w sejfie są zwykłymi sekretami/JSON i nie zależą od Windows ani DPAPI; wskazany weryfikator działa na Windows. Dla osobnej kopii całego Bitwarden, jeśli właściciel ją tworzy, wybierz **Password protected encrypted export**, nie account-restricted export. Hasło kopii zachowaj niezależnie i nie przesyłaj go w czacie. Narzędzie nie tworzy eksportu Bitwarden. Git/SQL/R2 backupy w DPAPI nadal wymagają osobnego planu przenośnego odtworzenia: samo zabezpieczenie kluczy nie oznacza pełnego off-device DR.

## Trzy odrębne wpisy z kopii właściciela

W opisanych dwóch kopiach lokalnych **nie znaleziono** poniższych wartości. To kontrola konkretnych źródeł, nie przeszukanie wszystkich plików komputera:

| Wpis w Bitwarden | Źródło do użycia | Jeśli kopii brak |
| --- | --- | --- |
| REXBID production — Resend SMTP key | Zachowana przez właściciela kopia produkcyjnego klucza **Sending access** ograniczonego do właściwej domeny; nigdy klucz stagingowy | Resend nie pokazuje ponownie pełnego klucza po utworzeniu. Po sprawdzeniu swoich kopii uzgodnić osobno zastąpienie: nowy ograniczony klucz → bezpieczne wpisanie w produkcyjnym SMTP → test → dopiero uzgodnione wycofanie starego. **Nie wykonano rotacji.** |
| REXBID production — Supabase database password | Zachowana przez właściciela kopia hasła bazy produkcyjnego projektu | Jeśli nie ma kopii, przygotować osobno zatwierdzony reset hasła DB po inventory bezpośrednich klientów/integracji, oknie zmiany i backupie. Nie jest to hasło użytkownika aplikacji; reset nie może być wykonany automatycznie. |
| REXBID production — APIBARA_API_KEY | Zachowana kopia właściciela albo istniejący dostęp do panelu providera | Cloudflare/Wrangler pokazuje nazwę sekretu, nie odzyskiwalną wartość. Jeżeli źródła nie pozwalają odzyskać klucza, oddzielne zatwierdzenie reissue z ustalonym zakresem i testem. **Nie wykonano reissue ani requestów Apibara.** |

Twórz również oddzielne wpisy typu Login, wartość w **Password**, bez URI/autofill; kopiuj wyłącznie z zaufanej istniejącej kopii. Po zapisie ręcznym użyj `production-vault-clear.cmd` i sprawdź działanie później w zatwierdzonym środowisku. **Ten mechanizm nie potwierdza kompletności kopii SMTP/DB/API key i nie odczytuje zamaskowanych pól dashboardów.**

### Procedura zabezpieczenia trzech zachowanych kopii — bez zmiany usług

Po sprawdzeniu pięciu pozycji wykonuj kolejno **SMTP → hasło DB Supabase → APIBARA_API_KEY**, po jednym wpisie. Weryfikator pięciu pól nie obejmuje tych dodatkowych danych.

1. Ustal źródło: wyłącznie istniejąca zachowana kopia wartości produkcyjnej. Nie kopiuj gwiazdek z dashboardu, nazwy sekretu zamiast wartości, klucza stagingowego ani hasła użytkownika aplikacji zamiast hasła DB. Nie wypisuj kopii przez terminal ani nie zapisuj nowego jawnego pliku.
2. W swoim Bitwarden utwórz wpis typu **Login** o dokładnej nazwie z tabeli powyżej. Wartość skopiuj bezpośrednio z zaufanej istniejącej kopii do maskowanego pola **Password**. Nie odsłaniaj, nie przepisuj, nie wysyłaj w czacie. **URI puste**; w notatce wolno zapisać tylko środowisko i źródło, bez sekretu.
3. Dla SMTP metadane: produkcyjny Resend Sending access, właściwa domena wysyłkowa; dla DB: projekt `rexbid-production`; dla API: produkcyjny klucz Apibara. Zapis w sejfie nie wymaga kliknięcia Create/Reset/Regenerate w usługach i nie zmienia konfiguracji SMTP, projektu lub Workera.
4. Zapisz wpis i uruchom `C:\Users\nowic\Desktop\stona_auta-www\scripts\production-vault-clear.cmd`. Pozostaw wyłączoną historię/sync schowka. Zgłoś wyłącznie nazwę zapisanej pozycji albo **BRAK KOPII**.
5. Jeśli źródła brakuje, zatrzymaj tę pozycję; sprawdź pozostałe zachowane kopie. Nie wykonuj automatycznego resetu/reissue. Proponowana ścieżka osobno zatwierdzonej naprawy znajduje się w tabeli powyżej. Nie deklarować funkcjonalnego testu SMTP/DB/API na podstawie samego zapisu do sejfu.

`REXBID_OWNER_USER_ID`, bindingi D1/R2, origin, limity i feature flags to metadane konfiguracji. Produkcyjnego właściciela trzeba potwierdzić jawnie później, nie odgadywać z kont stagingowych. Service-role Supabase, JWT private keys, R2 S3 access keys i Wrangler OAuth token nie są dodatkowymi sekretami wymaganymi przez obecny kod/binding; nie tworzyć ich dla tej kopii. Nie eksportować TOTP/QR ani kont testowych.

## Wykonane kontrole i procedura odtwarzania

- aktywne kopie DPAPI/manifest/checksum/ACL oraz pełny keyring: **PASS**, wyłącznie w pamięci;
- cookie seal/open i portal text/binary AES-GCM roundtrip **dla każdego zachowanego key ID**, rzeczywistym kodem aplikacji na syntetycznej treści: **PASS**; zero zapisów i zmian kluczy;
- 17 syntetycznych kontroli C#/WinForms: kopiowanie dopiero po działaniu właściciela, brak pominięcia pozycji, TTL, zajęty schowek, Finish nawet po wcześniejszym TTL, błędy publikacji, maskowane pola i weryfikacja pełnego keyringu bez DPAPI: **PASS**;
- pełny suite **671/671 PASS**, w tym 3 nowe regresje; rzeczywisty schowek nie był używany przez agenta;
- zapis pięciu pozycji w Bitwarden: **MANUAL OWNER-CONFIRMED**, program zamknął się według potwierdzenia właściciela; brak wartości w czacie;
- odczyt z sejfu na obecnym komputerze / odzyskanie na drugim urządzeniu: **NOT VERIFIED — owner action**.

Przy zatwierdzonym odtworzeniu najpierw zweryfikuj kompletność sejfu i checksum backupów, potem użyj pełnego zachowanego keyringu oraz aktywnego ID. Nie rotować przed odczytem starych danych. Wpisanie wartości do secret store jest odrębną czynnością; niniejszy tool nie wykonuje deployu, secret put, migracji ani zmian usług. Odtworzenie D1 bez zaszyfrowanych obiektów R2 i odpowiedniego pełnego keyringu nie odzyska załączników.

Źródła mechanizmu: [Microsoft — clipboard formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats), [clipboard ownership](https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard), [Bitwarden custom fields](https://bitwarden.com/help/custom-fields/), [encrypted exports](https://bitwarden.com/help/export-your-data/).
