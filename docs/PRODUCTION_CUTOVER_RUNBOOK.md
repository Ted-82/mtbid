# Rex.Bid — runbook przygotowania cutoveru produkcyjnego

**Status: plan do review. Żaden krok produkcyjny opisany niżej nie został wykonany.**

## Aktualna bramka

- Ostatni stan checkoutu na początku sprintu: `def8b43 Prepare Rex.Bid release candidate staging`.
- Produkcyjny Worker `mtbid` i D1 `rexbid-db` nie były zmieniane. Produkcyjne Accounts i D1-first pozostają wyłączone.
- Staging pozostaje `rexbid-auth-test` + `rexbid-auth-test-db`; D1 ma 260 Copart i 120 IAAI listingów, oba scope `partial`. To próbka, nie pełny rynek.
- Nie uruchamiać produkcyjnego Cron, discovery, backfillu ani D1-first przed zatwierdzeniem budżetów, migracji, monitoringu i rollbacku.

## Backup i odtworzenie

1. Potwierdzić konto Cloudflare, nazwę oraz UUID docelowej bazy; osobna osoba powinna sprawdzić target przed operacją zdalną.
2. Wykonać zdalny D1 export poza repo, zapisać UTC timestamp, checksum, wersję Wrangler, migracje i tabelaryczne county. Ograniczyć dostęp do pliku i uzgodnić retencję.
3. Odtworzyć najpierw do nowej disposable D1; porównać schemat, indeksy, foreign keys, `users`, `user_favorites`, Sync i legacy county.
4. Produkcyjny restore do `rexbid-db` jest destrukcyjny i wymaga osobnej, jawnej zgody właściciela. Nigdy nie nadpisywać staging/prod podczas rehearsal.
5. Po błędzie aplikacji preferować rollback wersji Workera/flag. Nie wykonywać automatycznego D1 restore.

Rehearsal 2026-10-03: staging export odtworzono do tymczasowej zdalnej D1 `rexbid-restore-rehearsal-20261003-0809` (`6ed87387-7501-4a1c-8fa8-cdcc02c05779`), porównano 41 obiektów DDL, istotne county i `foreign_key_check`; baza testowa została usunięta po walidacji. Eksport tymczasowy usunięto. `rexbid-auth-test-db` i `rexbid-db` pozostały nietknięte. To jest stagingowy remote restore rehearsal, nie próba produkcyjnego restore.

## Kolejność migracji produkcyjnych

Najpierw backup i restore rehearsal. Następnie, w oddzielnych zatwierdzonych oknach:

1. **0003 Accounts** (`docs/proposals/0003_accounts_foundation.sql`) — dopiero po wyborze domeny, production Supabase, cookie secret/origin allowlist, limiterze, SMTP i zatwierdzonych privacy/terms. Nie włączać Auth w tym samym kroku.
2. **0004 Sync 2** (`docs/proposals/0004_d1_sync_2.sql`) — po audycie pojemności/retencji i potwierdzeniu schematu repozytorium na staging D1. Addytywna; pozostaje propozycją do osobnej zgody.
3. **0005 media URL fields** (odpowiednik `migrations-staging/0005_listing_media_urls.sql`) — po 0004, bo zależy od `auction_listings`. Przeniesienie do aktywnego katalogu produkcyjnego wymaga osobnego review nazwy/versioning.

Nie uruchamiać 0003/0004/0005 przez pojedynczy `migrations apply` bez porównania z repo i stagingu. Nie przygotowywać destrukcyjnych down migrations. Rollback aplikacji: flaga OFF i poprzedni Worker; rollback schematu tylko po analizie i osobnej zgodzie.

## Budżet providera i obserwowalność

Kod rezerwuje atomowo budżet globalny i klasę operacji w staging D1 przed prawdziwym fetch. Obecne stagingowe propozycje limitów na dobę: global 500; katalog 250; detail 150; historia 60; discovery 30; media enrichment 10. Suma klas = 500. Limity wymagają strojenia po realnym ruchu; są twardymi limitami ochronnymi, nie prognozą wolumenu.

Produkcja ma `REXBID_PROVIDER_BUDGET_MODE=required`, ale nie ma limitów ani schematu Sync 0004: adapter ma fail-closed bez wykonania upstream requestu. Budżety produkcyjne muszą być uzgodnione, zmigrowane i skonfigurowane przed jakimkolwiek provider traffic po przyszłym deployu. Automatyczne retry są wyłączone; retry bucket pozostaje 0, dopóki polityka nie zatwierdzi małej, jawnej rezerwy.

Logi `rex.bid.provider_request` rejestrują jeden wpis na próbę HTTP rzeczywiście rozpoczętą do Apibara z `upstream_request=true`; zliczaj tylko te wpisy. D1 `provider_request_budgets` przechowuje dokładne UTC-day sumy attempts (`apibara:all` i `apibara:<class>`); licznik zwiększa się tuż przed fetch, więc timeout po rozpoczęciu fetch też zużywa limit. Rezerwacja odrzucona przed fetch nie jest upstream requestem. Przykład read-only:

```sql
SELECT provider, budget_day, normal_limit, normal_consumed, normal_reserved,
       retry_limit, retry_consumed, retry_reserved
FROM provider_request_budgets
WHERE provider LIKE 'apibara:%'
ORDER BY budget_day DESC, provider;
```

Logi `Rex.Bid staging public read` opisują każde stagingowe D1 read/fallback z route template, platformą, freshness i reason bez VIN/PII. To log telemetry, nie archiwalna księga fallbacków. Trwałe fallback agregaty wymagają osobnej decyzji o retencji/sinku.

### Alerty Cloudflare — bez nowej płatnej usługi

- W panelu Worker → **Issues** skonfiguruj próg occurrence i webhook/e-mail dla powtarzających się exceptions/5xx; Issues wykrywa nieobsłużone wyjątki, failed invocation, Worker 5xx i logi error bez konieczności Logpush.
- W Worker → **Observability / Logs** filtruj `rex.bid.provider_request` i `Rex.Bid staging public read`; zapisuj dashboard/query dla `upstream_request=true`, `provider_fallback=true`, `fallback_reason`, 429 i `safe_error_code`. Każdy log to wiersz tylko wtedy, gdy sampling go zachował.
- Według obecnej dokumentacji Workers Logs są dostępne na Free/Paid z limitami (Free: do 200k log events/dzień, 3 dni retencji; Paid: 20M/miesiąc w cenie i 7 dni, później opłata). Sprawdź plan przed włączeniem sampling 100%; nie eksportuj PII. Custom Alerts mogą analizować dostępne SQL API datasets, ale dostępność/retencję właściwego datasetu należy sprawdzić na koncie. Nie włączaj Logpush/OTel/Workers Analytics Engine jako trwałego sinka bez zatwierdzenia ceny i retencji.
- Sam Cloudflare Workers Metrics/Issues nie daje dokładnego, długoterminowego countera provider fallback. Dokładny upstream attempts pochodzi z D1 budget counters; logi służą do diagnostyki/segmentacji.
- Brak automatycznej wysyłki webhooka z Rex.Bid w tym etapie; nie skonfigurowano odbiorcy ani sekretnych URL-i.

## Scheduled Provider Sync — docelowy plan, teraz wyłączony

- Nie aktywować cron triggera produkcyjnego. Nie aktywować staging schedule w tym sprincie.
- Gdy zatwierdzone: mały scheduled orchestrator rozpoczyna niezależne Copart/IAAI scope; każda strona wymaga osobnego globalnego i operation budget reservation oraz niezależnego lease/cursora.
- Jeden run: discovery summary → canonical normalization → atomic page commit + checkpoint. Tylko po pełnym dojściu do końca paginacji scope staje się `complete`; page limit/budget exhaustion zostawia `partial`.
- HOT/WARM/COLD planować na podstawie aukcji i jawnych konfigurowalnych interwałów. Discovery nie pobiera automatycznie detali. Detail/history/media enrichment to osobne małe kolejki z własnymi limitami.
- 429: zapisać bezpieczny kod i odroczyć; brak retry w tym samym przebiegu. 5xx/timeout: ograniczony backoff w osobnym przebiegu; cap dzienny nie może być omijany. Błędy i backlog alarmować.
- Cron może jedynie enqueue bounded work; kolejka lub consumer musi ponownie sprawdzić lease i budżet. Nie dodawać Durable Objects bez wykazanego konfliktu.
- Alerty: ostatni udany sync ponad próg, failure rate, 429, dzienny budżet 80/100%, kolejka zaległa, rosnące fallbacky. Nie zawierać identyfikatorów pojazdów ani PII.

## Production Auth i recovery

Production Auth pozostaje wyłączony do czasu: production Supabase projektu Rex.Bid; finalnej Site URL i ścisłej callback allowlist; osobnego losowego cookie secret; exact origins; D1 0003; działającego Cloudflare limiter binding; zatwierdzonej poczty transakcyjnej; privacy/terms i E2E na finalnej domenie. Recovery UI/kod istnieją, ale mail delivery i recovery callback nie są potwierdzone na docelowej domenie. Nie powtarzać default Supabase mailera: jest tylko dla adresów zespołu i ma bieżący limit 2/h, bez SLA.

### Krótkie porównanie SMTP (stan cen sprawdzony 2026-10-03)

| Opcja | Koszt publikowany | Domena / uwierzytelnienie | Supabase SMTP | Uwagi |
|---|---|---|---|---|
| Resend | Free: $0, 3k/mies. i 100/dzień; Pro $20/mies. za 50k | własne domeny; skonfigurować SPF/DKIM i DMARC | SMTP jest obsługiwany | Najmniej skomplikowany start; limity planu/free i retencja danych do sprawdzenia przed wyborem. |
| Postmark | Free: 100/mies.; Basic $15/mies. za 10k | własne domeny, SPF/DKIM/DMARC | SMTP jest obsługiwany | Skupienie na poczcie transakcyjnej; czytelny pakiet dla małego ruchu. |
| Amazon SES | à-la-carte outbound $0.10/1000; Essentials $0.16/1000 na obecnej stronie cenowej | weryfikacja domeny i SPF/DKIM/DMARC; konfiguracja AWS | SMTP jest obsługiwany | Najniższy koszt jednostkowy, ale większa obsługa AWS, reputacji i limitów konta/regionu. |

Nie kupiono/usług nie skonfigurowano. Wybór zależy od wolumenu, regionu danych, wymagań supportu/deliverability i akceptacji kosztu. Supabase narzuca własny początkowy limit połączenia custom SMTP, obecnie 30/h, dopóki nie zostanie zmieniony. Źródła: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend pricing](https://resend.com/pricing), [Postmark pricing](https://postmarkapp.com/pricing), [Amazon SES pricing](https://aws.amazon.com/ses/pricing/).

## Domain cutover package

Po wyborze domeny, bez wildcardów:

1. Właściciel potwierdza własność domeny i strefy w Cloudflare; DNS proxied/origin zgodnie z wybranym Worker custom domain, HTTPS/TLS aktywne.
2. Wybrać pojedynczy canonical host (np. apex albo `www`), ustawić redirect pozostałego wariantu, canonical/meta i `sitemap.xml` na ten host.
3. Produkcyjny `robots.txt` ma indeksować wyłącznie publiczne strony; staging nadal noindex. Prywatne konto/login/reset pozostają noindex.
4. Ustawić Supabase Site URL i dokładne callbacki: `/api/auth/callback` oraz dozwolone reset/recovery routes na finalnym originie; PKCE/state testować bez wildcardów.
5. Wybrać oddzielny subdomenowy nadawczy host/adres dla Auth; dodać rekordy SPF, DKIM, DMARC bez duplikatów, weryfikować TLS/SMTP i From/Reply-To.
6. Po zmianach wykonać test linków, callback, login/session/logout, canonical/robots/sitemap i redirecty. Zachować poprzedni host/Worker config do szybkiego rollbacku.

## Legal drafts

Dokumenty w `docs/legal/` pozostają `DRAFT — REQUIRES OWNER/LEGAL REVIEW`, nie są publikowane poradą prawną. Muszą jasno mówić: dane aukcyjne mogą być niepełne/opóźnione i nie są gwarantowanymi oficjalnymi danymi Copart/IAA; kalkulator to niewiążący szacunek, nie oferta transportowa ani wycena podatkowa; zdjęcia są third-party media. Niezależne warunki auction platforms i prawa do oryginalnych zdjęć pozostają osobnym review.

## Dry-run / release order

1. Konfig validator → rate data generator `--check` → testy/składnia/diff-check.
2. Production `wrangler.jsonc` dry-run tylko po audycie targetu. 2026-10-03 local dry-run PASS wskazał wyłącznie `mtbid`/`rexbid-db` i D1-first OFF; to nie jest deploy ani dowód zdalnego dostępu/sekretów. `whoami` w tej sesji wymaga re-auth.
3. Zweryfikować backup/export + restore rehearsal i listę zdalnych migracji.
4. Dodać wymagane production secrets/bindingi dopiero po owner config: Supabase, cookie secret, SMTP, limiter, provider quotas; nic nie wypisywać.
5. Osobno wdrożyć addytywne migracje z zatwierdzonymi checkpointami. Utrzymać Auth OFF i D1-first OFF.
6. Staging E2E finalnego originu, publiczny smoke, fallback/budget logs i rollback drill.
7. D1-first/Auth/cron włączać po jednym feature fladze po osobnej zgodzie; po każdym monitorowany rollout/rollback.

### Rollback

- Provider API / D1-first: `REXBID_D1_PRIMARY_READS=false`, redeploy tylko właściwego Worker configu; produkcja wymaga oddzielnego owner approval.
- Scheduled sync: wyłączyć cron trigger, następnie kolejkę/runner; aktywne page commit może dokończyć bezpieczny checkpoint, ale nie planować kolejnych requestów.
- Auth: `AUTH_ENABLED=false`, zachować cookie clearing i nie usuwać tabel.
- Schemat: kod rollback nie cofa addytywnego schematu; nie usuwać tabel/kolumn. Restore jest osobnym zatwierdzanym działaniem.

## Skonsolidowane działania właściciela — maksymalnie trzy

1. Ponownie zalogować Wrangler; wtedy wykonać wyłącznie `whoami` i read-only audyt produkcyjnej D1 (target, migracje, schema, FK i county). Nie aplikować migracji.
2. Wybrać finalną domenę/canonical host i zatwierdzić Resend/nadawcę oraz rekordy SPF/DKIM/DMARC; konto ani subskrypcja nie są tworzone w tym sprincie.
3. Po audycie D1 zatwierdzić dzienne capy providera, limiter/alerty, legal drafts i kolejność osobnych migracji. Zgoda na deploy lub migrację produkcji musi być osobna i jawna; jej brak pozostawia Auth/Cron/D1-first wyłączone.

## Production Environment Build — 2026-10-03 (bez aktywacji)

Ten dodatek jest aktualnym planem przygotowania środowiska. Nie oznacza wykonania migracji, konfiguracji sekretów, aktywacji flag ani deployu.

### Stan audytu produkcyjnego D1

Target z konfiguracji lokalnej: `rexbid-db` / `971879fe-04ed-4e8c-9dc6-5306980bb872`. Zdalnego audytu schematu, migration history ani countów **nie udało się wykonać**: OAuth Wrangler wygasł, a próba odświeżenia tokenu nie mogła połączyć się z Cloudflare. Żadne zapytanie SELECT do produkcyjnej D1 nie zostało wykonane. Nie wyciągać wniosku o aktualnych remote tables wyłącznie z plików repo.

Po ponownym uwierzytelnieniu pierwszym krokiem jest tylko odczyt: potwierdzenie konta i ID, `wrangler d1 migrations list rexbid-db --remote --config wrangler.jsonc`, `sqlite_schema`, `PRAGMA foreign_key_check` i countów tabel. Jeżeli nazwa/ID odbiegają od targetu powyżej, przerwać.

### Kolejność produkcyjnych migracji

Aktywne `migrations/` zawiera obecnie tylko `0000_rexbid_base.sql` i `0001_auction_history_events.sql`; proposal `0003` i `0004` nie są aktywnymi migracjami produkcyjnymi. Zdalnej historii migracji nie udało się potwierdzić.

1. Backup/export `rexbid-db`, checksum, readback countów i niezależny restore rehearsal do osobnej tymczasowej bazy; nie nadpisywać production.
2. W review zamrozić SQL proposal `0003_accounts_foundation.sql`; skopiować do aktywnego katalogu migracji jako następny poprawny numer dopiero po porównaniu z remote migration history. Najpierw zastosować ją osobno, potem sprawdzić tabele, PK/FK/indexy i brak zmian legacy rows.
3. Po osobnym backupie zastosować zatwierdzony `0004_d1_sync_2.sql`, sprawdzić DDL/FK/indexy. Nie wykonywać discovery ani backfillu jako części migracji.
4. **Uwaga o media columns:** aktualny proposal `0004_d1_sync_2.sql` już tworzy `media_urls_json` i `media_thumbs_json`. Dlatego po zastosowaniu tej dokładnej wersji proposal nie wolno dodatkowo wykonać stagingowego `0005_listing_media_urls.sql` — byłoby to drugie dodanie tych samych kolumn. Zweryfikować `PRAGMA table_info(auction_listings)`. Jeśli review wymaga odrębnej migracji 0005, najpierw przygotować zatwierdzony wariant 0004 bez tych pól i osobny addytywny 0005; nie uruchamiać migracji stagingowej bezpośrednio.
5. Dla każdej migracji osobny target check, backup, apply, direct SELECT/foreign-key check, smoke kompatybilności i zatrzymanie przed kolejną operacją. Żadna migracja nie wykonuje masowego importu.

Rollback jest aplikacyjny: wyłączyć przyszłą flagę, wrócić do poprzedniego Workera. Schemat pozostaje addytywny; brak automatycznych down migrations. Restore produkcji wymaga odrębnej zgody właściciela.

### Provider caps — propozycja do zatwierdzenia

Nie znamy limitu/request quota planu Apibara ani produkcyjnego baseline ruchu. Poniższe są **proponowanymi początkowymi twardymi limitami canary**, nie wartościami skonfigurowanymi ani gwarancją braku 429: global **2 000/dzień**; katalog **1 000**; detail **650**; history **250**; discovery **80**; media enrichment **20**. Suma klas = limit globalny. Discovery/media nie powinny być wykorzystywane bez osobnego włączenia syncu. Każda rzeczywista próba HTTP zużywa licznik; brak auto-retry; retry bucket pozostaje 0.

Przed zatwierdzeniem porównać z pisemnym limitem planu Apibara i co najmniej 7-dniowym ruchowym pomiarem; globalny cap nie może przekraczać 80% jawnie potwierdzonego dziennego limitu providera, a miesięczny model powinien pozostawić minimum 30% marginesu. Jeżeli plan ma niższy limit, capy trzeba proporcjonalnie obniżyć. Alerty proponowane: 60% informacyjny, 80% ostrzegawczy, 100% hard stop; alarm przy każdym 429, trzech kolejnych błędach provider/transport w 5 minut, 5xx Worker >2% przez 5 minut i stale/fallback ponad 2× 7-dniową medianę. Nie aktywować production Cron.

### Release config, flagi i izolacja

- Produkcja pozostaje provider-backed. `REXBID_D1_PRIMARY_READS=false` jest jawnie wpisane w `wrangler.jsonc`; D1-first nie jest zaimplementowane jako produkcyjna ścieżka w tym buildzie. Przyszłą implementację wolno włączyć tylko po osobnym review. Jednosetting rollback po jej wdrożeniu: ustawić tę flagę z powrotem na `false` i redeployować wyłącznie po odrębnym zatwierdzeniu.
- `worker.staging.js` i staging routes nie są importowane przez `worker.js`. Config validator blokuje produkcyjne D1-primary flag `true`, cron i staging identifiers. Produkcyjne `triggers.crons` nie występują.
- Production provider budgets są `required`, ale brak caps i brak zatwierdzonego Sync schema oznaczają fail-closed przed upstream. Proponowane wartości powyżej nie są aktywowane w `wrangler.jsonc`.
- Auth pozostaje OFF. Nie dodawać `AUTH_ENABLED=true`, `AUTH_D1_SCHEMA_VERSION=0003`, `AUTH_CANONICAL_ORIGIN`, `AUTH_ALLOWED_ORIGINS` ani `AUTH_RATE_LIMITING_MODE=cloudflare` przed wdrożeniem wszystkich zależności. Nie kopiować żadnego staging secret.

### Production Supabase/Auth setup — wartości i kontrola

1. Utworzyć oddzielny production Supabase project Rex.Bid. Zanotować project ref; nie kopiować staging URL/key.
2. Po zatwierdzeniu domeny ustawić Site URL `https://<canonical-host>/`; allowlista redirectów zawiera dokładny `https://<canonical-host>/api/auth/callback`. Dla linków confirmation/recovery przekierowanie kończy się na callbacku, a callback kieruje recovery do `/reset-hasla.html?recovery=ready`. Bez wildcard origins.
3. W produkcyjnym Worker secrets/config dopiero po migracji: `SUPABASE_URL` (project root HTTPS), `SUPABASE_PUBLISHABLE_KEY`, `REXBID_AUTH_COOKIE_SECRET` (losowy, co najmniej 43 znaki). Nie logować wartości. `AUTH_CANONICAL_ORIGIN` i `AUTH_ALLOWED_ORIGINS` muszą być identyczne z finalnym HTTPS hostem.
4. Najpierw utworzyć Cloudflare Rate Limiting binding `AUTH_RATE_LIMITER` i zatwierdzić limity per operation/key; następnie `AUTH_RATE_LIMITING_MODE=cloudflare`. Ograniczać login/signup/recovery po route + klient IP, mutacje favorites po zweryfikowanym Rex.Bid user ID; nie limitować po samym e-mailu. Cloudflare binding jest lokalny do colo i eventual, więc łączyć z Supabase limits i monitoringiem.
5. Dopiero po odczycie tabelek 0003 ustawić `AUTH_D1_SCHEMA_VERSION=0003`; następnie Auth pozostaje wyłączony aż do osobnej zgody na `AUTH_ENABLED=true` i finalnym staging E2E.

### Supabase + Resend SMTP — przygotowana konfiguracja

Preferowany przez właściciela Resend; nic nie kupiono ani nie skonfigurowano. Po wyborze domeny utworzyć w Resend osobną domenę nadawczą, np. `auth.<canonical-domain>`, i osobny adres `no-reply@auth.<canonical-domain>`. W Resend zweryfikować domenę, następnie skopiować **wygenerowane dla tej domeny** rekordy SPF/DKIM do Cloudflare DNS; nie wpisywać uniwersalnych rekordów z przykładu. Dodać DMARC pod `_dmarc.auth.<domain>` z polityką monitorującą `p=none` i zatwierdzonym adresem raportowym, a dopiero po obserwacji owner/legal może zatwierdzić ostrzejszą politykę. Nie tworzyć drugiego SPF TXT.

W Supabase → Auth → SMTP Settings: host `smtp.resend.com`, port `465` (SSL; alternatywa 587 TLS, po testach), username `resend`, password = Resend API key przechowywany tylko w Supabase SMTP secret field, sender email = zweryfikowany adres `no-reply@auth.<domain>`, sender name `Rex.Bid`. Ograniczyć klucz Resend do wysyłki i nie wkładać go do Cloudflare/Repo. Ustawić confirmation oraz password-reset templates i linki przez callback. Wyłączyć link tracking/rewrite dla wiadomości uwierzytelniających. Po aktywacji wykonać po jednym kontrolowanym confirmation i password-reset E2E, sprawdzić SPF/DKIM/DMARC, bounces i dostarczenie.

Aktualna dokumentacja Supabase wskazuje, że ich domyślna poczta wysyła tylko na adresy zespołu, obecny limit to 2 wiadomości/h bez SLA; po skonfigurowaniu custom SMTP początkowy limit Auth to 30/h. Te limity trzeba sprawdzić ponownie w panelu przed testem.

### Backup production — komenda i retencja

Po odzyskaniu dostępu i przed zmianą, dopiero po sprawdzeniu UUID, operator może wykonać:

```powershell
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backup = "<approved-secure-backup-dir>\rexbid-db-$stamp-pre-migration.sql"
npx wrangler d1 export rexbid-db --remote --config wrangler.jsonc --output $backup
Get-FileHash -Algorithm SHA256 $backup
```

Plik zawiera dane użytkowników i ma być szyfrowany w zatwierdzonym magazynie poza repo/komputerem roboczym; nazwa zawiera środowisko, D1, UTC i checkpoint/migrację. Retencja do zatwierdzenia; propozycja startowa: szyfrowane kopie dzienne 30 dni oraz kopia przed każdą migracją do czasu potwierdzenia RPO/RTO i kosztu. Restore zawsze najpierw do nowego, jednoznacznie tymczasowego D1; porównanie schematu, FK i countów. Nie kierować restore do `rexbid-db` w trakcie próby.

## Właścicielskie kroki — maksymalnie trzy grupy

1. Zatwierdzić canonical domain i oddzielną domenę nadawczą Auth; wybrać Resend i zaakceptować koszt/limity DNS-email.
2. Utworzyć production Supabase + Resend pod wybraną domeną i wprowadzić ich prywatne wartości bezpiecznym kanałem do odpowiednich dashboardów/secrets; nie przesyłać kluczy w czacie.
3. Ponownie uwierzytelnić Wrangler. Po read-only audycie produkcyjnej D1 przedstawić właścicielowi gotową listę SQL/checksum/caps; migracje i finalny deploy nadal wymagają osobnej jawnej zgody.
