# REXBID — pierwsza publikacja 12.10.2026

## Wynik

https://rexbid.pl działa publicznie. Worker **rexbid-production-preflight**, wersja **1cd69740-fda8-495a-a895-587f135cf077**, 100%; odseparowana D1 **c8a30088-70af-43a6-9a7f-c4018279d37d**. Staging **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**. Istniejący mtbid nadal **351ac4e7-2175-4d51-813b-5f85d9527f64**; jego kod i D1 nie były zmieniane. Bez pusha.

Właściciel zatwierdził uruchomienie („uruchamiamy już teraz”), sam aktywował Workers Paid i zastosował delegację OVH. Osobno przy wykonaniu zatwierdził usunięcie trzech konkretnych rekordów parkingu/FTP. Nie odczytywano sekretów, haseł ani Bitwarden, nie zmieniano MFA. Zgody dotyczą tego pierwszego zakresu; nie przypisujemy im opinii prawnej ani zgody na późniejsze funkcje.

## DNS, TLS i poczta

- Przed zmianą pełne wartości 14 rekordów Cloudflare porównano z OVH/Cloudflare: 38/38 kontroli PASS. Świeży odczyt DS przed oknem zmiany: 12.10, 20:55:25 CEST; b/d/f/h/j potwierdziły authoritative NOERROR/NODATA, DS=0. a-dns.pl timeout, IPv6 ENETUNREACH — nie są dowodem braku DS.
- Właściciel zastosował wyłącznie **blair.ns.cloudflare.com / titan.ns.cloudflare.com**. Readback OVH: obydwa Aktywne, konfiguracja Niestandardowa. Odczyt parent 12.10 **21:35:26 CEST**: b/d/f/h/j zwracają referral NOERROR do tych dwóch NS (AA=false dla referral); odpowiedzi DS na tych pięciu są AA=true, NOERROR/NODATA, DS=0. a timeout zachowany w receipcie. Cloudflare status **active** potwierdzony UI i API.
- Usunięto tylko A apex i A www → 213.186.33.5 oraz CNAME ftp → rexbid.pl, po osobnym potwierdzeniu właściciela. Wrangler początkowo odmawiał podłączenia z kodem100117, bez usunięcia tych rekordów; nie omijano kontroli. Następnie podłączono oba Custom Domains do właściwego Workera.
- Strefa pokazuje **13 wpisów**: 11 zwykłych pocztowych/TXT i2 zarządzane rekordy Workera. Końcowy eksport BIND zawiera tylko11 zwykłych wpisów; zarządzanych rekordów Workera NIE eksportuje. Pełne wartości tych11 zachowane 11/11; dwa hosty i service/enabled/previews OFF potwierdzone osobno przez metadane Workera. Początkowe założenie weryfikatora o13 rekordach BIND poprawiono, zachowując wynik pierwszej kontroli.
- Po delegacji/routingu **32/32** bezpośrednie kontrole RRset na obu OVH i obu Cloudflare PASS: MX OVH1/5/100, SPF, pełny DKIM Resend, oba CNAME Resend, dwa DKIM Zimbra oraz pozostałe TXT. Strefa OVH i skrzynka Zimbra zachowane. Nie wysyłano maili. To kontrola DNS, nie nowy test dostarczenia/DKIM wiadomości.
- Bezpłatny Universal SSL widoczny jako Active. Rzeczywiste HTTPS obu nazw przeszło standardową kontrolę certyfikatu bez pomijania weryfikacji. Nowe zarządzane certyfikaty Custom Domains mogły pozostawać Pending Validation(TXT); działający Universal SSL pokrywa obie nazwy. Nie kupowano ACM.
- Włączono **Always Use HTTPS**. HTTP apex/www → HTTPS301, zachowane path/query. HTTPS www → apex **308**, zachowane path/query, bez Set-Cookie; POST aliasu421. Początkowy HTTP421 przed włączeniem ustawienia jest zachowany w receipcie. DNSSEC nadal OFF, bez nowego DS. Włączenie Cloudflare DNSSEC i publikacja nowego DS w OVH to następny, osobno zatwierdzany krok po stabilizacji. Nie włączać starego podpisu OVH.

## Zakres aplikacji i danych

Aktywne: zapisany częściowy katalog, filtry i VIN/LOT/platforma, karty, zewnętrzne galerie, historia aukcji i obserwacji, CalculatorV4, lokalne ulubione, lokalny szkic kontaktowy. Publiczne wejścia korzystają z D1/cache; provider fallback OFF.

Auth, portal, załączniki, Cron, Sync i automatyczne pobieranie providera OFF. Brak bindingu R2, workers.dev i preview OFF. Metadane6 istniejących sekretów potwierdzone bez wartości. Produkcyjny Supabase nie uruchamia tutaj sesji ani wiadomości. Konta i materiały testowe stagingu nie zostały skopiowane.

Readback po ruchu publicznym (22:23:16 CEST): **1817 ofert (945Copart/872IAAI), 3253 obserwacje, 19044 wydarzenia, 1638 potwierdzeń historii** — bez zmiany. Users/favorites/orders/messages/files produkcyjnej D1:0. Brak migracji/zapisów D1 w tym etapie. Ostatni odczyt katalogu9.10 o14:54:25CEST; poszczególne dane8–9.10 i starsze. Zapis nie jest dzisiejszym odczytem aukcji. Pozostają179 nowych historii niepobranych i167 wcześniejszych nierozstrzygniętych przypadków; nie oznaczano ich jako pustych. Home może mieć puste świeże kategorie — to ograniczenie wieku/zakresu danych, nie dowód braku ofert na rynku.

**0 nowych prób Apibara**. Nasz wcześniejszy licznik1774 i historyczny STOP56 pozostają zachowane. Ostatni5833/30000 jest wcześniejszym odczytem dostawcy, nie dzisiejszym pomiarem ani gwarancją, że inne operacje konta nie zużyły puli.

## Poprawka i rzeczywiste QA

W publicznym mobile Home wykryto starszą regułę CSS ukrywającą drugi i trzeci link menu. Usunięto tylko tę regułę, dodano regresję. Teraz Aukcje/Jak to działa/Ulubione/Kontakt są dostępne; Konto w produkcji pozostaje ukryte. Staging zachowuje konta. Poprawkę wdrożono na staging i publikacyjny Worker.

- Pełny lokalny suite **913/913 PASS**; celowane publication/company/inquiry **47/47 PASS** (wchodzą w pełny suite, nie sumować jako960 niezależnych testów). Generator profilu i git diff --check PASS.
- Rzeczywiste final-domain HTTP/API **31/31 PASS**: HTML, /ready z rzeczywistą D1 i HTMLasset, robots/sitemap właściwej domeny, oba katalogi, filters, dokładny VIN+LOT, ukryte strony kont/portalu, niedostępna diagnostyka stagingowa, disabled config, HTTPS/308/421. Siedem .html ma oczekiwane same-origin307 do adresu bez rozszerzenia z tym samym query; kontrola sprawdza ten redirect oraz końcowe200. Pierwszy zbyt prosty weryfikator nie uwzględniał307; zachowano jego wynik i poprawiono kontrolę.
- Cztery przykłady detail/history: **8/8 HTTP200**,4/4 właściwa tożsamość, źródło D1, provider_fallback_enabled=false. Honda3 wydarzenia, TeslaCopart1, TeslaIAAI5; Polestar not_fetched, nie pusta historia.
- Własna ścieżka w przeglądarce na domenie: Home → LOT44593083 → Honda → galeria/lightbox → V4 → lokalne ulubione → lokalny szkic kontaktowy → karta → katalog z zachowanym wyszukiwaniem → wyszukanie VIN5YJ3E1EA3PF683202 → właściwa TeslaCopart.
- Ulubione zachowane po odświeżeniu, oferta25USD zgodna z kartą; usunięto tylko utworzone testowe obserwowanie. Szkic zawiera link **https://rexbid.pl** i oryginalną datę ceny; dane fikcyjne, bez wysłania e-maila.
- Honda: zapis oferty25USD / KupTeraz2000USD, odrębne etykiety; ubezpieczyciel zielony. Wybrany Sedan: znany transport **870USD**, subtotal **895USD**; brakujące opłaty poza sumą. CopartTesla: potwierdzona cena sprzedaży9100USD osobno od poprzedniej oferty9000USD; transport V4 **1055/1130USD** dla4/3aut, BEV zachowane. Nie jest to pełna cena pod dom.
- Desktop viewport1280 i mobile390; zmierzone widths1265/375, bez poziomego overflow na sprawdzonych widokach. Mobilne menu po poprawce rzeczywiście pokazuje4 publiczne linki. Zdjęcie Hondy HD w lightboxie załadowane (naturalWidth845); miniatura17 nadal niedostępna z czytelnym stanem zastępczym. Nie twierdzimy, że wszystkie zewnętrzne zdjęcia/wideo działają.
- Nie powtarzano rzeczywistego recovery, logowania właściciela/MFA lub E2E portalu; wcześniejsze potwierdzenia właściciela dotyczą stagingowych kont testowych. Produkcyjny portal OFF.

## Kopia i rollback

Świeża kopia przed zmianą: private-backups/rexbid/publication-launch-before-20261012 poza Git. SQL30194905B, SHA256 **098e4d0b00d8bd9d8182cd7825c42e897a155b8f2d3c0afebc53f7008972bee1**, DPAPI roundtripPASS; identyczny plaintext SHA jak kopia faktycznie odtworzona12.10 w lokalnym SQLite (integrity/FK/countsPASS). Nie jest to test odzyskania na drugim komputerze ani przenośny backup danych. Bitwarden nie był odczytywany; jego wcześniejsze same-computerPASS pozostaje osobnym wynikiem.

1. Przy regresji kodu cofnąć **wyłącznie nowy Worker** do030b1343-1dfa-4204-80ff-e65d555f4f0d, zachowując domains i D1. Ten build ma wcześniejszy błąd ukrytych linków mobile, ale ten sam działający katalog. Komenda do wykonania tylko po rozpoznanym incydencie:

~~~powershell
Set-Location -LiteralPath 'C:\Users\nowic\Desktop\stona_auta-www'
$env:XDG_CONFIG_HOME='C:\Users\nowic\AppData\Roaming\xdg.config'
node 'C:\Users\nowic\AppData\Local\npm-cache\_npx\32026684e21afda6\node_modules\wrangler\bin\wrangler.js' rollback 030b1343-1dfa-4204-80ff-e65d555f4f0d --config wrangler.production-publication.jsonc --message 'Rollback publikacji katalogu'
~~~

2. Po rollbacku powtórzyć /ready, katalog/VIN/LOT/V4, HTTPS i308. Rollback Workera nie zmienia NS, ustawienia Always Use HTTPS ani danych. Nie używać mtbid jako zastępczego targetu.
3. Gdy trzeba całkowicie wycofać routing, usuwać tylko dwa Custom Domains nowego Workera, po sprawdzeniu incydentu i wymaganego potwierdzenia; odtworzyć parkingowe A apex/www z kopii cloudflare-before.txt. Nie importować BIND w trybie zastępującym całą strefę i nie usuwać11 zachowanych wpisów. Zarządzane rekordy Workera wymagają osobnego przywrócenia przez Custom Domains, nie przez sam eksport BIND. Nie odtwarzać nieużywanego FTP bez potrzeby.
4. Nie cofać delegacji jako pierwszej reakcji na błąd aplikacji. Jeśli regresja jest w delegacji, sprawdzić aktualny DS i TTL przed osobno uzgodnionym powrotem do dns111/ns111.ovh.net. Po przyszłym dodaniu DS Cloudflare najpierw zapewnić zgodność/usunięcie DS i odczekać TTL; nigdy nie mieszać nowego DS ze starymi NS.
5. Brak migracji oznacza, że zwykły rollback kodu nie wymaga restoreD1. Przy utracie danych: freeze, kopia incydentu, restore do odrębnej D1, integrity/FK/schema/count/reconciliation i zgoda na rebind; bez dumpu w miejscu i bez usuwania kont/plików.

## Koszty i pozostałe prace

Workers Paid aktywowany przez właściciela i potwierdzony UI: **5USD/miesiąc plus użycie ponad pakiet**, nie twardy limit rachunku. Website/DNS Free, UniversalSSL bez osobnego abonamentu. Nie kupiono ACM ani innych usług. ZimbraStarter pozostaje w posiadanym pakiecie; ResendFree i istniejący Apibara bez zmian. Załączniki publiczne OFF i brak R2bindingu ograniczają ten zakres; nie jest to limit naliczania dla całego konta, stagingu lub innych bucketów. Monitorować rzeczywiste zużycie Workers/D1/R2/Resend/Apibara.

Nierozstrzygnięte: świeżość katalogu przed pokazem13.10, dane wspólnika do pełnej wyceny,179 niepobranych historii/167 źródłowych braków, niektóre zewnętrzne media, osobne uruchomienie produkcyjnych kont/portalu i DNSSEC po stabilizacji. Publiczne warunki i prywatność pozostały w istniejącej wersji do przeglądu; ten cutover nie oznacza zatwierdzenia prawnego ani wdrożenia proponowanej retencji. Nie kasowano korespondencji, backupów ani danych użytkowników.

Dowody poza Git: **C:/Users/nowic/Documents/Codex/REXBID_LAUNCH_20261012** — manifest backupu w private-backups, ds-before/ds-at-delegation/delegation receipty, pełne eksporty przed/po,32 kontrole poczty, metadane, final-dns-data-audit, production-http-qa, production-examples, logi testów/deployu oraz screeny. Poprawny końcowy desktop: public-catalog-desktop-final.png; mobile: public-mobile-menu-fixed.png/public-honda-mobile.png/public-lightbox-mobile.png. Plik public-copart-desktop.png uchwycił wcześniejszy rozmiar podczas zmiany viewportu i nie jest dowodem desktop1280.
