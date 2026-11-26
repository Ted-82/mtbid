# Aktualizacje danych produkcji — 29.10.2026



**Oba indeksy ZAKOŃCZONE i sprawdzone na produkcji.** Ostatni odczyt: 2026-10-29T10:49:53.169Z.
Nie wznawiać tych samych ukończonych operatorów. Łącznie 4941856 zdarzeń,
153921 różnych ofert ze zmianą co najmniej jednego dozwolonego pola
(cena/status/termin). Baza w kontroli: 247738 ofert; zero duplikatów i błędów FK,
brak pozostawionej blokady, osiem tabel klientów/panelu bez zmian.

- Pierwszy indeks: 3656876 zdarzeń / 180435 grup, 134135 zaktualizowanych grup;
  sekwencje 40563105–44267593, pliki4948–5029.
- Drugi indeks night-v2: 1284980 zdarzeń / 127807 grup, 58941 zaktualizowanych grup;
  sekwencje44267594–45570246, przez29.10 09:43:17 UTC. Sumy zmian obu indeksów
  obejmują powtórzenia tych samych aut; unikalny wynik podano wyżej.
- Plik5331 zachowany i zweryfikowany osobno: 47218 zdarzeń,45570247–45617472,
  przez29.10 10:13:15 UTC. NIE został dołączony do ukończonego night-v2 ani zastosowany.

Pełna automatyzacja plików nadal NIE jest wdrożona. Istniejący Cron15min obsługuje
ograniczone odświeżanie API. Nowe LOT i niejednoznaczne zmiany mają trwałą kolejkę
uzupełnień, lecz globalny konsument zależy od nieustanowionego streamu.
Nie ustawiać najnowszego globalnego kursora bez dowodu ciągłości; nie oznaczać
katalogu jako pełnego/live. Daty pełnej obserwacji kart nie są sztucznie odświeżane.

Kopia przed zmianami:1377001443 B SQL, DPAPI+ACL i odtworzenie w pamięci PASS.
Każda partia ma prywatne before/after, niezależny readback i plan selektywnego cofnięcia.
70/70 testów lokalnych importer/czytnik/rollback/budżet PASS (31+39).
Końcowy publiczny QA11 odczytów PASS:4 karty z obu platform,4 marki>=2025,
3 kategorie current/timed/buy-now. Dowody w Documents/Codex/REXBID_LIVE_UPDATES_20261029:
apply-result.json,night-v2/apply-result.json,database-audit-all.json,final-public-qa.json.

Bez nowego abonamentu i bez nowego wdrożenia Workera; zmiany D1 są widoczne na rexbid.pl.
Wersja produkcyjna nadal a31b016e-3bcb-4ebf-9c1d-aef131f276ef. DNS/konta/MFA/portal/kalkulator
nie były zmieniane. Opłacone pakiety: Workers Paid i Apibara Pro; ostatni nagłówek puli
z10:48 UTC wynosi90063/100000, nie jest pomiarem końca dnia.


## Odtwarzalność i kontrola kosztów

Źródło D1: rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d.
Pełna kopia sprzed importu zachowana pod Documents/Codex/private-backups/rexbid/file-changes-production-before-20261029.
Plaintext SHA256:49b3f5912041287b43d1477426f97a6d4e02734c4f9087c1213c9a17bb18e8b4;
plik SQL zabezpieczony DPAPI, poprawny roundtrip i odtworzenie247686 ofert oraz8 chronionych tabel.

Każdy indeks ma sprawdzony SHA, liczbę zdarzeń i liczbę całych grup przed pierwszym zapisem.
Partia do100 LOT chroni pełny stan rekordu oraz tożsamość źródła; obejmuje atomowo
dozwolone zmiany, kolejkę uzupełnienia, receipt i checkpoint. Before fsync poprzedza
wysłanie, po potwierdzeniu transportu następuje pełny odczyt i niezależna walidacja rollbacku.
Niepewne zapisy zachowują pending i rezerwację; częściowe before/after blokuje wznowienie.
Cofnięcie jest selektywne i odrzuca konflikt z nowszymi danymi. Nie dodaje ani nie usuwa aut.

Limity operatora pozostały8 mln zapisów/450 mln odczytów konta na dzień UTC,
z rezerwami20 tys./500 tys. i max5000 zapisów na żądanie. Miesięczny pomiar plus
cały lokalny rejestr i cała dopuszczona dzienna pula pozostają w pakiecie Paid.
Odczyt statystyk Cloudflare ma osobny limit zapytań; po jego błędzie stosowany jest
jeden5-minutowy backoff wyłącznie odczytu. Nie powtarza się niepewnych zapisów.
To ograniczenia aplikacji, nie twardy limit całej faktury.

## Incydenty rozstrzygnięte przed wznowieniem

1. Offset35120 pierwszego indeksu: readback wykazał not_committed; brak pending/rezerwacji,
   zapis zachowany w uncommitted-verified. Wznowiono od tego offsetu bez pomijania danych.
   Pierwotna diagnostyka nie zachowała przyczyny zatrzymania, dlatego jej nie przypisujemy.
2. Offset180120: zapis był wykonany, rzeczywiste308 wierszy przekroczyło szacunek300.
   Dowód atomowego readbacku potwierdził commit oraz checkpoint180220; odtworzono
   brakujące after. NIE wykonano partii ponownie. Rejestr zachował308 zapisów/228 odczytów.
   Dodano jawne acknowledgeEstimateHalt, wymagające zahashowanego dowodu, braku niepewnych
   rezerwacji i tej samej polityki limitów. Trwały nowy dolny szacunek dla publication:
   5000 zapisów/50000 odczytów; nie podniesiono limitów, nie wyzerowano użycia.
3. Night-v2 offset0: commit i pełny readback poprawne; końcowy test liczby ofert porównywał
   baseline sprzed5-minutowego oczekiwania na statystyki ze stanem po uzyskaniu blokady.
   W tym oknie mógł działać Cron; importer nie wykonuje INSERT/DELETE ofert.
   Niezależny readback0 ponownie potwierdził commit15 kart/14 zadań, bez zapisu.
   Baseline jest teraz pobierany po uzyskaniu blokady. Kolejna partia20 (offset20→40)
   przeszła wszystkie kontrole; pełny przebieg wznowiono od40, bez replay0.

## Źródła i zaległości

Pierwszy hash indeksu:3fda74d196098cdc94d4d21c36d40e917b231dc784ffee3f01f985d7e7019c85.
Night-v2 hash:a5afcc99992ffb1a22606ded8badf0ff67c0069b3747d616ab431c9f6990f7a3.
Nocny indeks zawiera odzysk API506602 zdarzenia oraz pliki5202,5214,5226,5238,5250,
5262,5273,5285,5296,5308,5320. Lokalny sourceId2026102901 jest jawnie api_recovery,
vendorGeneration=false; nie jest generacją dostawcy. Odzysk:1014 stron+5 pomiarów,
1019 wywołań bez ponowień. Dwie późniejsze próbki Open/full zużyły2 wywołania.
Jedna dodatkowa kontrola limit2000/include_record=created zwróciła HTTP422 z limitem500.
Publiczny OpenAPI1.1.1 podaje2000, lecz serwer tego nie akceptuje. Bez ponowień i
bez zapisów D1; raport changes-2000-probe.json. Opcja include_record w API nie została
przez tę próbę potwierdzona; pełne record w pobranych plikach są potwierdzone lokalnie.
Starszy przygotowany indeks night/v1 NIE został użyty na produkcji.

Końcowa kolejka nie oznacza jednakowo pilnych odczytów dla każdego auta:

| Stan zadania | Stan oferty | Liczba |
|---|---|---:|
| identity_error | missing | 2106 |
| identity_error | open | 74 |
| pending | ended | 66944 |
| pending | finished | 21 |
| pending | live | 296 |
| pending | missing | 42863 |
| pending | open | 30173 |

Najpierw nowe aktywne LOT, otwarte/live, brakujące media i niejednoznaczne daty.
Zakończone odłożyć; konflikty VIN nie są zgadywane. Zmiany cen nie potwierdzają
wszystkich pól karty ani możliwości licytowania. Potwierdzona zmiana dostawcy:
pliki5320 i5331 mają pełny obiekt record w329/329 lot.created, zgodny platformą/LOT/VIN.
Obecny importer jeszcze go nie wykorzystuje. Następny etap powinien najpierw
walidować i stosować te pełne rekordy, a API przeznaczać na rzeczywiste braki.
Szczegóły oraz ograniczenia świeżości record są w projekcie automatyzacji.

Końcowy test przeglądarki: Copart33136450 pokazuje5200USD i przyjmuje5200 w kalkulatorze,
bez błędów konsoli. Dowód production-updated-ram-final.png. Interfejs nadal pokazuje
datę ostatniej pełnej obserwacji (27.10), nie osobną datę zastosowanej ceny. Następny
etap powinien rozdzielić te informacje bez przedstawiania częściowej aktualizacji
jako odświeżenia całej karty. Podana cena nie oznacza potwierdzenia aktywnej licytacji.

## Punkt wznowienia

Nie uruchamiać ponownie ukończonych operatorów rexbid-apply-file-changes-20261029.cjs
i rexbid-apply-night-v2-changes-20261029.cjs. Zachowane5331 zaczyna dokładnie za granicą
night-v2. Następny indeks musi mieć rozłączny zakres; potrzebne są późniejsze paczki
lub kontrolowana naprawa luki. Nie seedować stream:changes na najnowszej pozycji.

Gotowy projekt następnego etapu: [automatyzacja plików](FILE_SYNC_AUTOMATION_PLAN_2026-10-29.md).
Jeszcze niewdrożone: R2/Queues, serwerowy walidator i grupowanie, kolejka nowych kart,
maszynowa naprawa brakujących generacji, test przerwy. Istniejący Cron i jego limity
500/dzień/12000 miesiąc/8 na przebieg zachowane. Historyczny ręczny test panelu
klienta w osobnym oknie prywatnym nadal oczekuje, niezależnie od synchronizacji.

Prywatne before/after, źródła i dowody są poza Git. Nie publikować sekretnego URL feedu,
tokenów, kopii SQL ani danych klientów. Szczegółowe raporty: Documents/Codex/REXBID_LIVE_UPDATES_20261029.
