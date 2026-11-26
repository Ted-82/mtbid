## 12.10.2026 — rexbid.pl uruchomione za zgodą właściciela

Publiczne https://rexbid.pl; www308 zachowuje path/query, HTTP301 doHTTPS. Worker rexbid-production-preflight **1cd69740-fda8-495a-a895-587f135cf077**, odseparowana D1c8a30088. Auth/portal/files/Cron/Sync/fallbackOFF. Staging **85a44ee5-5b9d-4a6d-ac35-1b7456535a12**, zachowane dane/MFA; mtbid351ac4e7 nietknięty. Delegacja blair/titan potwierdzona w OVH i pięciu odpowiedziach parent; DS0 na b/d/f/h/j, a timeout. Cloudflare active,13 wpisów (11 zachowanych zwykłych +2 managedWorker), poczta32/32PASS. Workers Paid aktywowany samodzielnie przez właściciela:5USD/mies.+usage, nie hard cap.

Naprawiono ujawniony w rzeczywistym QA błąd mobilnego menu (stara reguła ukrywała Jak to działa/Ulubione). **913/913 repo,47/47 celowane,31/31 final-domainHTTP/API PASS**; desktop/mobile, VIN/LOT, karty obu platform, galerie, częściowyV4, lokalne ulubione i kontakt sprawdzone. Fresh backup+readback; dane1817/3253/19044/1638/private0 zachowane,0 migracji i nowychApibara. Daty8–9.10 nadal wymagają kontrolowanego odświeżenia; nie udają danych live.

[Raport uruchomienia i konkretny rollback](PUBLIC_LAUNCH_QA_2026-10-12.md). Starsze wpisy poniżej są historią, w tym dawne „brak zgody/Free/pending”; nie wykonywać ponownie delegacji, tworzenia zasobów ani transferu danych. DNSSEC i produkcyjne konta/portal pozostają osobnym etapem. Treści prawne zachowały oznaczenie wersji do przeglądu, nie przypisano im prawnej akceptacji. Bez pusha.

---

## Uaktualnienie12.10.2026

Dashboard Workers plans potwierdził Current plan:Free0USD; Paid5USD/mies.+usage. API/subscriptions403 pozostaje oddzielnym ograniczeniem odczytu. Nie aktywowano abonamentu. Zimbra kontakt@rexbid.pl jest już aktywna w posiadanym Starter i działa w obie strony; stare przekierowanie usunięto za zgodą właściciela. Cena odnowienia5.10.2027 pozostaje niepotwierdzona. Dane poniżej są wcześniejszą wyceną, nie dowodem nowego zakupu. [QA](PUBLICATION_TECHNICAL_QA_2026-10-12.md).

---

# Budżet uruchomienia i utrzymania REXBID

Stan: 10.10.2026. Właściciel zaakceptował poniesienie przedstawionych, potrzebnych kosztów i wymaga informacji o każdym nowym koszcie przed aktywacją. Dane wspólnika do pełnej wyceny spodziewane 12–14 października; nie blokują przygotowania katalogu z wyraźnie częściowym kalkulatorem. Zgoda finansowa nie jest zgodą na DNS ani publikację.

## Koszt dokończenia

Brak dodatkowej jednorazowej licencji za budowanie obecnego kodu, kalkulatora, panelu, galerii lub wdrożenia. Obecna subskrypcja ChatGPT/Codex i ewentualne dodatkowe użycie są odrębnym kosztem tworzenia, nie kosztem działania serwisu. W tym etapie nie zakupiono usługi ani nie podniesiono planu: transfer D1 udało się ukończyć po odnowieniu darmowej puli.

## Podstawowe abonamenty poza Apibara

| Usługa | Pierwszy katalog | Pełny zakres kont i portalu | Decyzja wykonawcza |
| --- | ---: | ---: | --- |
| Workers Paid, w tym pakiet D1 | 5 USD/mies. | 5 USD/mies. | Rekomendowane przed publicznym ruchem; najpierw sprawdzić rzeczywistą subskrypcję i kwotę checkoutu |
| Supabase | Free, Auth OFF | 35 USD/mies. dla dwóch Micro w obecnej jednej organizacji Pro | Produkcja + zachowany staging; nie usuwać projektu. Nie kupować podczas publikacji samego katalogu |
| Resend | 0 USD w Free | 0 USD w Free, 3000/mies. i 100/dzień | Wysyłka aplikacji wymaga limiterów i kontroli wspólnej puli. Wyższy pakiet wycenić przed zakupem |
| R2 Standard | Pliki OFF | 0 USD do 10 GB-month/1 mln Class A/10 mln Class B | Prywatność nie jest limitem rachunku; wdrożyć limit miejsca i liczbę plików przed aktywacją |
| Razem abonamenty | 5 USD/mies. | 40 USD/mies. | Przed podatkami, domeną, pocztą, Apibara i przekroczeniami pakietów |

Wariant jednego płatnego projektu Supabase ma cenę bazową 25 USD/mies., ale **nie opisuje obecnego układu dwóch projektów w jednej organizacji**. Rozdzielenie organizacji i przenoszenie projektów nie zostało wykonane ani wliczone jako gotowa oszczędność.

Apibara Basic: publiczny cennik 25 USD/mies./30000 requestów. Nie podniesiono planu. Odnowienie domeny według umowy OVH pozostaje rocznym kosztem poza powyższą tabelą. Odczyt zamówienia OVH 10.10 potwierdził istniejącą Zimbra Starter: Free starter account with domain. Za przygotowanie posiadanej licencji nie dodano abonamentu ani zamówienia; nie aktywowano jeszcze skrzynki. Przyszła cena odnowienia usługi 5.10.2027 nie została potwierdzona. Osobny publiczny cennik Starter nie dowodzi kwoty przyszłego odnowienia tej licencji. Nie kupować Workspace lub kolejnej skrzynki w celu powielenia posiadanej usługi. [OVH — poczta](https://www.ovhcloud.com/pl/emails/), [pakiet domeny](https://www.ovhcloud.com/pl/domains/).

## Kontrola kosztów i odświeżania

- Plan Paid usuwa małe dzienne limity Free, ale nie zapewnia sztywnego rachunku 5 USD. Workers: po pakiecie 10 mln żądań/30 mln CPU ms opłaty 0,30 USD/mln żądań i 0,02 USD/mln CPU ms. D1: po 25 mld odczytów/50 mln zapisów miesięcznie 0,001 USD/mln odczytów i 1 USD/mln zapisów; po 5 GB 0,75 USD/GB-month.
- R2 Standard ponad pakiet: 0,015 USD/GB-month, 4,50 USD/mln Class A, 0,36 USD/mln Class B; jednostki rozliczeniowe są zaokrąglane. Przykład 100 GB-month przez pełny miesiąc to 1,35 USD za miejsce ponad 10 GB, plus ewentualne operacje. To przykład, nie pomiar naszego ruchu.
- Alarm kosztowy nie zatrzymuje automatycznie naliczania. Zachować limiter, prywatność, kontrolę rozmiaru/ilości plików i trwały budżet importów. Nie deklarować automatycznego miesięcznego capu, którego dostawca nie oferuje.
- Publiczne wejście nie pobiera Apibara; odczyt pochodzi z D1/cache. 1817 osobnych odczytów dziennie to około 54510 przez 30 dni, więc nie mieści się w Basic. Projekt regularnego refreshu musi korzystać z list i priorytetu aktywnych ofert, osobno określając świeżość szczegółów i historii. Ten etap nie włączył Cron/Sync ani automatycznego fallbacku.
- Nowy abonament, dodatek i zmiana pakietu wymagają podania ceny właścicielowi przed aktywacją. Przy obecnym stanie publikacja kont, plików i delegacja nadal mają osobne bramki wykonania; sama zgoda na budżet nie zastępuje ich testów.

## Źródła cen, sprawdzone 9–10.10.2026

[Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Supabase](https://supabase.com/pricing), [Resend](https://resend.com/pricing), [Resend Free](https://www.resend.com/blog/new-free-tier), [R2](https://developers.cloudflare.com/r2/pricing/), [Apibara](https://apibara.tech/en/pricing).
