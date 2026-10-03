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
2. Production `wrangler.jsonc` dry-run tylko po audycie targetu. To nie jest deploy ani dowód dostępności sekretów.
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

## Maksymalnie pięć wymaganych działań właściciela

1. Wybrać finalną domenę i canonical host.
2. Wybrać SMTP z trzech opcji oraz zatwierdzić koszt/nadawcę i DNS SPF/DKIM/DMARC.
3. Zatwierdzić production daily caps (global + klasy), alerty oraz ewentualną rezerwę retry; do tego czasu provider w produkcji fail-closed.
4. Zatwierdzić produkcyjny plan włączenia Auth/D1 sync, legal drafts i warunki zewnętrzne platform aukcyjnych/mediów.
5. W osobnym oknie wydać jawne zatwierdzenie na migracje/deploy produkcji po ukończeniu checklisty i staging E2E.
