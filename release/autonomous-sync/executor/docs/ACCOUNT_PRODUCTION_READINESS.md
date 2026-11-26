## Aktualne bramki kont — 2026-10-07

Właściciel potwierdził **LOCAL VERIFYVAULT PASS — SAME COMPUTER** dla pięciu pozycji: REXBID_AUTH_COOKIE_SECRET, pełnego REXBID_PORTAL_DATA_KEYS, REXBID_PORTAL_ACTIVE_KEY_ID, SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY. Wszystkie wartości, cały keyring i aktywny ID były zgodne ze źródłem, bez użycia DPAPI. To ręcznie zgłoszony wynik rzeczywistego lokalnego weryfikatora; agent nie otwierał Bitwarden ani nie odczytywał sekretów.

Osobno zapisano produkcyjny klucz SMTP Resend, hasło bazy Supabase i APIBARA_API_KEY. Ich zapis ma status **MANUAL OWNER-CONFIRMED / NOT TECHNICALLY VERIFIED**. Nie regenerowano ani nie zmieniano sekretów.

Odzyskanie na drugim urządzeniu jest **NOT VERIFIED**. Lokalny PASS bez DPAPI nie potwierdza przenośnego odtworzenia danych Git/SQL/R2. Kopie zaszyfrowane DPAPI nadal wymagają osobnej przenośnej kopii. Nie trzeba powtarzać zakończonego transferu ani lokalnej kontroli. Zewnętrzny receipt zawiera wyłącznie nazwy i statusy, bez wartości sekretów.

Produkcyjny Supabase kkwbqzndildovbblbkcx: ponownie odczytano Site URL https://rexbid.pl, pojedynczy callback https://rexbid.pl/api/auth/callback?state=* oraz włączone Custom SMTP: nazwa REXBID, smtp.resend.com, port 465, odstęp 60 s. Hasło pozostało ukryte. Limit liczby maili/h był redagowany przez narzędzie; nie obchodzono tej ochrony. Bieżące zużycie Resend i tracking nie zostały odczytane bez sesji. Nie wysłano wiadomości ani nie zmieniono ustawień.

Rzeczywisty stagingowy recovery E2E wykonał **testowy klient**, a wynik potwierdził właściciel. Nie testowano zmiany hasła właściciela ani jego MFA. Produkcyjna wysyłka, E2E na domenie docelowej i rzeczywisty test w innej przeglądarce pozostają niewykonane.

Wybrana ścieżka używa odseparowanej D1 c8a… i Workera rexbid-production-preflight. Po osobnej zgodzie i TLS: Auth setup → nowe, potwierdzone konto produkcyjnego właściciela → dokładne issuer/subject i D1 users.id → jawne potwierdzenie właściciela → test confirmation/recovery osobnego klienta → konfiguracja osobnego MFA/AAL2 właściciela → portal bez załączników. Nigdy pierwsze konto ani domysł po e-mailu. Konfiguracja MFA udostępnia wyłącznie istniejące endpointy bezpieczeństwa; reszta API portalu pozostaje zamknięta. Produkcyjne pliki są wyłączone i nie mają bindingu R2.

[Jedyny aktualny profil, komendy i bramki](PRODUCTION_CUTOVER_RUNBOOK.md). Historyczny generator dla mtbid nie jest generatorem tej odseparowanej publikacji.

---

## Historia wcześniejszych kontroli — poniższe statusy nie zastępują aktualizacji powyżej

# REXBID — gotowość kont i portalu do produkcji

**2026-10-07: PRODUCTION AUTH CONFIGURATION PREPARED / NOT ACTIVATED.** Kontynuacja checkpointu `b887297`; ręczny stagingowy recovery E2E z checkpointu `f9776eea26f3b56d904075efa5646693b750a5b2` pozostaje zachowany. Dokument zastępuje wcześniejsze, sprzeczne statusy recovery. Nie jest zgodą na deploy, migracje obecnej produkcji ani DNS.

## Dowody i granice weryfikacji

| Obszar | Dowód | Status |
|---|---|---|
| Recovery e-mail | Właściciel: mail dotarł, nowe hasło zapisano, stare odrzucono, nowe pozwala zalogować osobnego klienta | **STAGING REAL EMAIL RECOVERY E2E VERIFIED — PASS** |
| Portal na osobnym koncie klienta | Właściciel: poprawni nadawcy, etap widoczny, internal hidden, klientowski download/open | **STAGING OWNER VERIFIED — PASS** |
| Izolacja endpointów | Wcześniejszy rzeczywisty QA: internal file, foreign order i foreign file denied | **STAGING VERIFIED — PASS** |
| MFA właściciela | Działający verified TOTP/AAL2 | **OWNER VERIFIED; UNCHANGED** |
| Niezależny Supabase produkcyjny | Projekt `rexbid-production`, ref `kkwbqzndildovbblbkcx`; zapisany Site URL/redirect oraz pełna treść dwóch szablonów | **UI CONFIGURATION VERIFIED — 2026-10-07**, nie oznacza mailowego E2E |
| Produkcyjny custom SMTP | Toggle ON, host/port, zapisane ukryte hasło i interval 60 s widoczne w panelu; sender/user potwierdzone przez właściciela | **CONFIGURATION VERIFIED / DELIVERY NOT VERIFIED** |
| Cross-browser/replay/expiry/CSRF/restricted grant | Behavioral tests | **AUTOMATED VERIFIED**; mail cross-browser/replay/expiry niepotwierdzone osobno |
| Final-domain konta/mail/MFA/portal | Production Auth nieaktywny | **NOT PRODUCTION DEPLOYED / NOT VERIFIED** |
| Inbox delivery, spam cause, tracking | Brak pełnych nagłówków i odczytu tracking | **NOT VERIFIED** |

Staging `rexbid-auth-test`, Version `24e5f914-0b9e-4222-95d6-5ccf8e9c44bb`, Supabase `ydfsuncohsntqwmtmnhe`. Checkpoint recovery **658/658 PASS**. Bieżący suite/zasoby: handoff. [Recovery QA](ACCOUNT_RECOVERY_QA_2026-10-06.md), [historyczny portal audit](PRODUCTION_READINESS_2026-10-06.md). Nie powtarzać potwierdzonego mail E2E bez powodu.

## Profil i separacja

Bazowy `wrangler.rexbid-production.jsonc` zachowuje pełny worker.js, provider-backed katalog i Calculator V4. **Nie używać wyłączonego wrangler.release.jsonc zwracającego 503.** Generator `scripts/prepare-production-portal.cjs` przygotowuje profil kont/portalu po komplecie dowodów. Przygotowanie zasobów nie zmienia mtbid, jego D1 i routingu.

| Ustawienie / zasób | Docelowo |
|---|---|
| AUTH_CANONICAL_ORIGIN / AUTH_ALLOWED_ORIGINS | tylko `https://rexbid.pl`, bez wildcardów |
| AUTH_ENABLED | false do osobnej zgody |
| AUTH_D1_SCHEMA_VERSION | 0003 po schema readback |
| AUTH_RECOVERY_MODE | email-token + nowy recovery template |
| AUTH_RATE_LIMITING_MODE | cloudflare + sprawdzony AUTH_RATE_LIMITER |
| Portal schema | 0006 po 0003; nie wymaga Sync2 |
| SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY | niezależny production project; staging ref/key niedozwolone |
| REXBID_AUTH_COOKIE_SECRET | nowy losowy sekret pozaGit |
| REXBID_OWNER_USER_ID | jawnie potwierdzony production D1 user ID |
| REXBID_PORTAL_DATA_KEYS / ACTIVE_KEY_ID | nowy production keyring; staging keys bez zmian |
| REXBID_PRIVATE_FILES | osobny Standard R2 rexbid-production-private-files, publicOFF |
| www | redirect do apex z path/query; bez drugiej sesji Auth |

Brak kompletnej konfiguracji = fail-closed. Sama flaga nie dowodzi schematu/limitera/R2. Katalog/kalkulator nie wymagają Auth/portal/D1-first/Cron. Nie kopiować staging kont, MFA, realizacji, wiadomości, plików ani kluczy. Rzeczywiste ID/stan nowych zasobów zapisuje handoff.

## Supabase — odczyt i dokładne pola

Odczyt panelu **2026-10-07**: org REX.Bid **Free**, spend cap **ENABLED**, dwa projekty. Właściciel utworzył niezależny **rexbid-production**, ref **kkwbqzndildovbblbkcx**, region **eu-west-1 — West EU / Ireland**. Nie kopiowano stagingowego projektu ani kont. Hasło bazy i SMTP pozostają ukryte, poza Git oraz raportem. [Projekt produkcyjny](https://supabase.com/dashboard/project/kkwbqzndildovbblbkcx), [projekty](https://supabase.com/dashboard/projects).

W produkcyjnym panelu zapisano i potwierdzono po ponownym odczycie **Site URL = https://rexbid.pl** oraz dokładnie jeden **Redirect URL = https://rexbid.pl/api/auth/callback?state=***. Potwierdzono **Confirm email ON**, **Anonymous sign-ins OFF**, **Manual account linking OFF**. Polskie szablony confirmation i recovery zapisano oraz porównano ich pełną treść z lokalnymi plikami. Nie wysłano maila, nie utworzono konta i nie aktywowano Auth/portalu.

Publiczne metadata `REXBID_PRODUCTION_SUPABASE_PROJECT_REF=kkwbqzndildovbblbkcx` wskazują właściwy projekt; `SUPABASE_URL` i publishable key operator wpisuje bezpośrednio do secret store odseparowanego Workera. Production guard odrzuca stagingowy ref, niezgodny URL, stare recovery oraz dodatkowe originy. Nazwanie projektu lub obecność sekretu nie jest zgodą na `AUTH_ENABLED=true`; kod kont pozostaje fail-closed. Aktualny stan podłączenia Workera zapisuje handoff.

1. **Authentication → URL Configuration → Site URL**: `https://rexbid.pl`.
2. **Redirect URLs**: `https://rexbid.pl/api/auth/callback?state=*`. Wildcard wyłącznie dla state na exact host/path, bez `https://**` / `https://rexbid.pl/**`. BFF sprawdza state/PKCE/flow cookie/TTL. Final-domain confirmation musi sprawdzić zachowane query.
3. **Sign In / Providers → Email → Confirm email** ON, autoconfirm OFF.
4. **Emails → Templates → Confirm sign up**: [polski REXBID template](../config/supabase-production-confirmation-email.html) z `{{ .ConfirmationURL }}` dla istniejącego signup PKCE.
5. **Reset password**: [polski szablon](../config/supabase-production-recovery-email.html) z `{{ .SiteURL }}/api/auth/recovery/confirm?token_hash={{ .TokenHash }}&amp;type=recovery`. SiteURL podstawia właściwy projekt: staging→staging, production→apex.
6. **Emails → SMTP Settings**: tabela poniżej; **Rate Limits**: cooldown co najmniej 60 s/ta sama osoba i limity wspólnej puli Resend.
7. **Project Settings → API / API Keys**: URL/publishable key bezpośrednio do production Worker secrets; service-role niepotrzebny do normalnego loginu/portalu.

Nie usuwać projektu dla zwolnienia limitu ani nie akceptować płatnego upgrade. [Redirecty](https://supabase.com/docs/guides/auth/redirect-urls), [szablony](https://supabase.com/docs/guides/auth/auth-email-templates).

## Ograniczony recovery grant / inna przeglądarka

Email-token flow nie potrzebuje PKCE cookie przeglądarki inicjującej. Link otwarty w B tworzy na właściwym originie odrębny AES-GCM `__Host-rexbid_recovery`, TTL 600 s. GET usuwa TokenHash z URL i **nie konsumuje go w Supabase**; recovery-session GET zwraca boolean gotowości, nie upstream ważność.

Jawny same-origin password POST weryfikuje TokenHash/type recovery, JWT identity i istniejącego D1 usera. Grant nie daje me/favorites/portalu/plików/MFA ani normalnej sesji, nie zamienia sesji właściciela na resetowane konto. Po sukcesie recovery/lokalna sesja są czyszczone; wymagane zwykłe logowanie. Global sign-out best-effort raportuje wynik; access JWT innych sesji może pozostać ważny do expiry.

Nie osłabiać origin/cookies dla tymczasowego adresu. Cross-browser automated PASS nie zastępuje final-domain mail E2E. Późniejszy pojedynczy test: request w A, link w B, panel denied przed zapisem, nowe hasło, old/new login, użyty link bezpiecznie odrzucony. Bez nowych maili/zmiany hasła właściciela teraz. [Prefetch/tracking](https://supabase.com/docs/guides/deployment/going-into-prod#email-link-validity).

## SMTP Resend Free

OVH odbiór `kontakt@rexbid.pl → rexbid.kontakt@gmail.com` działa według właściciela. Wysyłka aplikacji `no-reply@powiadomienia.rexbid.pl` odrębna; root MX/SPF bez zmian.

| Supabase SMTP Settings | Wartość |
|---|---|
| Enable custom SMTP | ON — odczyt panelu produkcyjnego 2026-10-07 |
| Sender email address | no-reply@powiadomienia.rexbid.pl |
| Sender name | REXBID |
| Host | smtp.resend.com |
| Port number | 465, implicit TLS |
| Username | resend |
| Password | osobny production Sending access key, bezpośrednio w panelu |
| Minimum interval per user | co najmniej 60 s |

Odczyt UI potwierdził toggle ON, `smtp.resend.com`, port `465`, minimum interval `60` i obecność zapisanego ukrytego hasła. Narzędzie redagowało wartości pól nadawcy i username; dokładne `no-reply@powiadomienia.rexbid.pl` oraz `resend` są **potwierdzeniem właściciela**, a nie odczytanym pełnym dowodem. Klucz produkcyjny jest odrębny według właściciela; jego wartości nie odczytywano. **Produkcyjna wysyłka, confirmation i recovery E2E nadal NOT VERIFIED** — Auth/portal nie są aktywne. Dotychczasowy stagingowy test na osobnym kliencie nie jest testem produkcyjnego projektu ani resetem właściciela.

Właściciel już utworzył odrębny klucz produkcyjny; nie tworzyć kolejnego bez potrzeby. Procedura odtworzenia: [Resend → API Keys](https://resend.com/api-keys) → **Create API Key**, Name `rexbid-production-auth`, Permission **Sending access**, Domain **powiadomienia.rexbid.pl**, bez All domains/Full access. Istniejąca verified domena wystarcza. Klucz w menedżerze właściciela i production SMTP Password; raport/Git tylko nazwa/zakres/ID. Staging key osobny, bez rotacji. [SMTP](https://resend.com/docs/send-with-smtp), [permissions](https://resend.com/docs/dashboard/api-keys/introduction).

Publiczny Free:100/dzień, 3000/miesiąc, 3 domeny; panel musi potwierdzić plan/usage. Pula wspólna staging + production; obejmuje również inbound w Resend, a limit dzienny resetuje się o północy UTC. Zero paid overages/add-ons/upgrade. Proponowane20 wiadomości/h per projekt nie gwarantuje limitu miesięcznego: monitorować sumę i zatrzymywać testy przed wyczerpaniem puli. SMTP unavailable: neutralny recovery response bez enumeration/pętli retry. [Cennik](https://resend.com/pricing), [dokładne quota](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

[Domains](https://resend.com/domains) → powiadomienia.rexbid.pl: verified/DKIM/return-path oraz **Click tracking OFF / Open tracking OFF** dla auth. Tracking NOT VERIFIED bez panelu. Spam nie dowodzi przyczyny: potrzebne sanitizowane Authentication-Results SPF/DKIM/DMARC+domeny i Return-Path, bez linków/tokenów/PII. [DNS/DMARC](DNS_CUTOVER_REXBID_PL.md).

## Owner / AAL2 / izolacja

1. Właściciel tworzy nowe production konto, potwierdza mail i loguje się; bez importu staging identity/TOTP.
2. Verified issuer/subject, mapowanie D1 i jawne potwierdzenie ownera → konkretny REXBID_OWNER_USER_ID. Nie pierwszy rekord/domysł na podstawie e-maila.
3. Faza owner-setup: owner-only enrollment, pliki OFF; administracja nadal właściciel + verified AAL2. QR/kod wykonuje właściciel, nic w czacie.
4. Po challenge/verify, zwykły klient denied i SMTP E2E można zatwierdzić portal/prywatny R2. Staging MFA/role bez zmian; czasowy restart pending enrollment usunięty.

Sender = serwerowa sesja/rola + zapisany nadawca; browser nie deklaruje roli. Klient tylko przypisane orders/„Dla klienta”. Internal i cudze IDs blokowane także bezpośrednim URL. PDF/JPEG/PNG: typ/rozmiar, szyfrowanie, autoryzowany Worker download, brak publicznego bucket URL. Production smoke bez danych stagingu.

### Kosztowa bramka załączników

Prywatny, pusty bucket Standard nie stanowi limitu kosztowego. R2 jest usługą rozliczaną według zużycia; samo alertowanie nie zatrzymuje przekroczenia bezpłatnej puli. Finalna faza `portal` generatora wymaga dodatkowego dowodu **`r2_free_usage_controls_verified=true`**: zweryfikowanej kontroli łącznego storage i operacji Class A/Class B, uwzględniającej pozostałe buckety konta. Nie zaznaczać tego pola na podstawie samego alertu, limitu rozmiaru pojedynczego pliku albo per-user/per-colo limitera. Do zamknięcia tej bramki produkcyjne pliki pozostają **OFF**. Faza `owner-setup` ma pliki OFF i nie wymaga tej bramki; działające załączniki stagingu pozostają zachowane.

## Security / bramki

- Session __Host-rexbid_session: AES-GCM, Secure/HttpOnly/SameSite=Lax/Path=/, brak Domain, TTL zgodnie z kodem; PKCE/recovery odrębne. Logout czyści cookies/cache/UI.
- Mutacje canonical Origin, cross-site Sec-Fetch-Site denied, bez credentials+CORS*. PKCE GET state/verifier, recovery GET grant, password POST CSRF/limiter.
- Prywatne HTML/API private/no-store, recovery no-referrer, logi bez auth body, query credentials, e-maili, cookies i tokenów.
- Limiter IP + operation oraz user, nie samego e-maila. Per-colo/eventual nie zastępuje Supabase ani globalnego budżetu.
- Refresh single-flight/race-safe w isolate; brak globalnego locka między colo.
- Export tylko bieżący user. Usunięcie identity wymaga osobnej decyzji/uprzywilejowanego backendu, service-role nie jest skonfigurowany.

Przed publikacją: niezależny Supabase, sekrety, limiter i prywatny R2, świeży backup + rehearsal, osobno zatwierdzone 0003 → 0006, TLS finalnej domeny, callback i SMTP, jawnie wskazany owner + MFA, legal review i konkretna zgoda. Sync2/D1-first/Cron odrębne. [Runbook](PRODUCTION_CUTOVER_RUNBOOK.md), [Backup/rollback](BACKUP_RECOVERY.md).

Kalkulator: nie pytać ponownie o 610 stawek, preferred terminals, land multipliers i BEV 150 USD. Pierwszy pakiet: **port docelowy + kraj odprawy; zakres frachtu; cena/zakres port-broker-dokumenty**, waluta, per auto/kontener, netto/brutto i data. Braki blokują pełną cenę pod dom; nie oznaczają 0.

## Ograniczenia usług Free i kopii Auth

Supabase Free może wstrzymywać nieaktywne projekty; monitoring musi wykrywać pause/niegotowość Auth, zamiast traktować samą konfigurację jako SLA. Nie uruchamiać płatnych dodatków/PITR ani upgrade. D1/R2 backup nie jest kopią Supabase: nie odtwarza haseł, refresh tokens ani MFA. Oddzielny produkcyjny runbook musi uwzględniać odtworzenie konfiguracji projektu i bezpieczną, dostępną metodę eksportu Auth przy uprawnieniach właściciela; brak takiej kopii jest ograniczeniem, nie dowodem wykonanej archiwizacji. [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

Działający staging owner/MFA pozostaje zachowany. Recovery konta właściciela po utracie drugiego składnika wymaga osobnej polityki i jawnego potwierdzenia tożsamości; zwykły reset hasła nie może sam zdejmować MFA ani nadawać owner. Nie włączać dawnego restartu niezweryfikowanego enrollmentu jako produkcyjnego obejścia.

## Poczta kontaktowa — aktualizacja10.10.2026

OVH potwierdziło redirect 0/0 skrzynek i jedno przekierowanie kontakt@rexbid.pl do Gmaila projektu. Osobna posiadana Zimbra Starter jest zawarta w zamówieniu domeny; organizacja REXBID przygotowana, domena i skrzynka nieaktywowane. Nie kupiono nowej usługi. Zmiana odbioru kontaktu nie jest zmianą SMTP Resend. Nie modyfikowano Supabase, MFA, kluczy, forwardingów ani DNS.

Resend UI wymaga odrębnej sesji; nie odczytano aktualnie obu flag trackingu ani pełnych nagłówków odebranego maila. Odczyt publicznego DNS 10.10 potwierdził obecne MX/SPF, DKIM i oba CNAME; DMARC root i powiadomienia zwróciły NXDOMAIN w resolverze rekursywnym, nie odpowiedź autorytatywną. Propozycja przyszłego zakresu: TXT _dmarc.rexbid.pl oraz _dmarc.powiadomienia.rexbid.pl, każde v=DMARC1; p=none; (dla root można jawnie sp=none). Bez rua do nieistniejącej skrzynki, bez wdrażania teraz i bez gwarancji uniknięcia spamu. Zaostrzenie polityki dopiero po sprawdzeniu faktycznych nadawców i alignmentu.

Pierwsza publikacja nie używa produkcyjnego Auth ani automatycznych maili; productionSMTP E2E i tracking pozostają wymagane przed osobną fazą Auth. Rzeczywisty recovery staging wykonano na osobnym testowym kliencie i potwierdził go właściciel; nie zmieniano hasła właściciela.
