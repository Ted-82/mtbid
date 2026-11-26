## Nadrzędny zakres proponowanej delegacji — 2026-10-07

**PRZYGOTOWANY DO AKCEPTACJI / NIE WYKONANY.** Udany bezpośredni odczyt DS o 15:52:30 CEST na a-dns.pl (192.102.225.53) i b-dns.pl (192.195.72.53): autorytatywne NOERROR/NODATA, DS=0, bez ucięcia, SOA .pl. Delegacja nadal OVH dns111/ns111. Okno oczekiwania minęło. Dowód: C:/Users/nowic/Documents/Codex/REXBID_PARENT_DS_PUBLICATION_20261007.json. Ponowić tuż przed zatwierdzoną zmianą; brak DS nie oznacza zgody na delegację.

Pełne 12 rekordów eksportu Cloudflare z 7 października, 10:21:12 porównano ponownie z oboma OVH o 16:47:35 CEST: **12/12 + 12/12 PASS**, łącznie z całym DKIM i priorytetami MX. Ten późniejszy odczyt rekordów korzysta z osobnego dowodu DS z 15:52; nie twierdzi, że ponownie odczytał DS o 16:47. Dowód: REXBID_DNS_PUBLICATION_FULL_20261007.json poza Git. Aktualny dostęp API Cloudflare do DNS: 403; zgodność dotyczy przekazanego eksportu, nie nieznanych późniejszych edycji panelu.

Proponowane dwa Custom Domains rexbid.pl i www.rexbid.pl wskazują **nowy Worker rexbid-production-preflight**, nie mtbid. Wrapper daje www GET/HEAD → apex 308 z zachowaniem ścieżki/query, bez cookies; mutacje aliasu odrzuca. Nie dodawać równolegle CNAME www → apex ani drugiej reguły przekierowania. Historyczne propozycje CNAME poniżej są alternatywą, a nie tym zakresem.

Po osobnej akceptacji i kontrolach kopii/DS/quota: zmiana delegacji OVH na blair.ns.cloudflare.com i titan.ns.cloudflare.com → potwierdzenie aktywnej strefy Cloudflare → usunięcie wyłącznie parkingowych A apex/www 213.186.33.5 oraz nieużywanego ftp w Cloudflare → powiązanie obu Custom Domains. Cloudflare zarządza ich DNS; nie wymyślać adresu IP. MX OVH (priorytety 1/5/100), root SPF, oba pozostałe TXT i trzy rekordy Resend zostają zachowane; CNAME Resend mają DNS only. Strefa OVH i przekierowanie kontaktowe pozostają zachowane jako droga odwrotu. Działający mtbid workers.dev nie jest częścią tej operacji.

HTTPS dla obu hostów, bez pętli www, musi być potwierdzone przed Auth. Przekierowanie HTTP → HTTPS w Cloudflare wymaga osobnego jawnego ustawienia w zatwierdzonym diffie; wrapper przyjmuje tylko HTTPS. Po stabilizacji: DNSSEC Cloudflare ON → **nowy DS z panelu** w OVH → kontrola rodzica i walidujących resolverów. Przy odwrocie po nowym DS najpierw bezpiecznie zmienić/usunąć DS, zachowując działające podpisy i NS, poczekać TTL, potem cofnąć delegację. Rollback Workera nie cofa DNS ani DS.

DMARC to propozycja późniejszego, osobno zatwierdzonego diffu: root v=DMARC1; p=none; sp=none; oraz _dmarc.powiadomienia v=DMARC1; p=none;. Oba obecnie NXDOMAIN na OVH. Bez nagłówków Authentication-Results nie przypisywać przyczyny spamu. Tracking Resend pozostaje nieweryfikowany. [Nadrzędny runbook](PRODUCTION_CUTOVER_RUNBOOK.md).

---

## Historia wcześniejszych kontroli — poniższe statusy nie zastępują aktualizacji powyżej

# rexbid.pl — przygotowanie domeny, poczty i DNSSEC

**2026-10-07: FULL EXPORT PARITY VERIFIED / DS RECHECK AFTER WAIT PASS / DNS UNCHANGED.** Plan nie zatwierdza publikacji ani zmiany rekordów, nameserverów, routingu lub DNSSEC. Wykorzystuje wcześniejsze eksporty i świeży read-only DNS. Działająca poczta OVH pozostaje zachowana.

## Stan i kompletność dowodów

Cloudflare zone pending, ID `9a1353c248c35e248f0399e736862a2e`, docelowe NS `blair.ns.cloudflare.com` / `titan.ns.cloudflare.com`. Obecna delegacja OVH `dns111.ovh.net` / `ns111.ovh.net`.

Pełny eksport Cloudflare `C:\Users\nowic\Downloads\rexbid.pl (1).txt`, oznaczony `Exported: 2026-10-07 10:21:12`, zawiera **12 rekordów użytkownika** oraz odrębne SOA/NS Cloudflare. Świeży odczyt bez rekursji z OBU autorytatywnych serwerów OVH potwierdził **12/12 + 12/12 — PASS**, w tym pełną wartość DKIM, oba CNAME Resend, A/www/ftp, wszystkie MX i TXT. Zgodność dotyczy nazw, typów, pełnych wartości i priorytetów MX; różnice TTL/proxy oraz SOA/NS opisano osobno. Nie potrzeba kolejnego eksportu do zamknięcia tego porównania.

| Rekord | Pełny eksport Cloudflare i świeży odczyt OVH — wartości zgodne |
|---|---|
| @ A | 213.186.33.5; Cloudflare proxied |
| www A | 213.186.33.5; Cloudflare proxied |
| ftp CNAME | rexbid.pl; Cloudflare proxied; FTP nieużywane |
| @ MX | 1 mx1.mail.ovh.net; 5 mx2.mail.ovh.net; 100 mx3.mail.ovh.net; DNS only |
| @ TXT SPF | v=spf1 include:mx.ovh.com -all |
| @ TXT | 1\|www.rexbid.pl |
| www TXT | 3\|welcome |

Nowy 12-rekordowy eksport Cloudflare SHA-256: `62166a231b595a99b4028f38d565740c1ca32808c11f8dbf5ee3b573bc380db7`. Historyczne 9-rekordowe eksporty OVH/Cloudflare pozostają materiałem archiwalnym, nie dowodem aktualnej strefy.

**Świeży odczyt 2026-10-07T10:31:50.775Z / 12:31:50 CEST:** `dns111.ovh.net` (5.196.45.181) i `ns111.ovh.net` (5.135.79.5) odpowiedziały authoritative, RCODE=0, bez truncation dla porównywanych RRsetów. Wynik: **24/24 indywidualne porównania / 12/12 na każdym serwerze — PASS**, brak duplikatów w eksporcie i brak rozbieżności wartości. Pełne TXT porównano po złożeniu wszystkich fragmentów, bez obcięcia DKIM. `_dmarc.rexbid.pl` i `_dmarc.powiadomienia.rexbid.pl`: authoritative NXDOMAIN na obu OVH. AAAA apex/www: authoritative NOERROR/NODATA.

Dowód poza Git: `C:\Users\nowic\Documents\Codex\REXBID_DNS_FULL_2026-10-07.json`; operatorowy skrypt `rexbid-dns-full-check-20261007.cjs` rozszerza sprawdzanie z poprzedniego `rexbid-mail-dns-check-20261006.cjs`, który pozostał zachowany. Raport zawiera publiczne rekordy, odpowiedzi serwerów i SHA-256 eksportu, bez sekretów. Wykonano syntax check skryptu. Sandbox ograniczył DNS resolver; właściwy odczyt wykonano po autoryzowanym uruchomieniu poza ograniczeniem sieciowym. Nie zmieniono żadnego rekordu.

Wcześniejszy Cloudflare API403/code10000 nie blokuje już porównania, ponieważ właściciel dostarczył pełny eksport. To weryfikacja tego konkretnego eksportu względem aktualnego OVH, nie dowód braku późniejszych zmian w panelu Cloudflare ani enumeracja nieznanych nazw w strefie. Bez ponownego importowania dawnych 9 rekordów.

### Różnice techniczne, których nie mylić z brakującymi rekordami

- Dawne 9 rekordów ma w eksporcie Cloudflare TTL=`1` (Auto), a na obu OVH TTL=3600 s. Nowe 3 rekordy Resend mają TTL=3600 s po obu stronach. Cloudflare koduje Auto jako 1; rzeczywisty Auto TTL wynosi zwykle 300 s, a dla proxied jest narzucony. Nie przenosić eksportu bez interpretacji ustawień dostawcy i nie przedstawiać Auto jako 1-sekundowego cache. [API TTL](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/get/), [Cloudflare TTL](https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/).
- Export `cf-proxied:true`: apex A, www A i ftp CNAME. Oba CNAME Resend `cf-proxied:false` — **DNS only PASS**. MX/TXT nie są proxyowane. Proxy to ustawienie Cloudflare, nie pole publicznej odpowiedzi OVH.
- NS w eksporcie Cloudflare: blair/titan, TTL86400; odpowiedzi strefy OVH: dns111/ns111, TTL3600. Jest to oczekiwana różnica przygotowanej strefy i obecnego dostawcy, nie zmiana delegacji.
- SOA Cloudflare: blair.ns.cloudflare.com / dns.cloudflare.com, serial2054303507; SOA obu OVH: dns111.ovh.net / tech.ovh.net, serial2091301542. Seriale i parametry SOA należą do różnych dostawców i nie wymagają zgodności. SOA/NS nie wliczono do 12 rekordów użytkownika.
- FTP pozostaje nieużywane i nadal proxied w eksporcie. Przed późniejszym zatwierdzonym cutoverem preferowane jest usunięcie tego aliasu; samo przełączenie DNS only nie tworzy serwera FTP. Teraz wpis bez zmian.

## Pełne publiczne rekordy wysyłki Resend

Wszystkie nazwy względne dotyczą strefy rexbid.pl. CNAME muszą być **DNS only**, nie proxy. Poniższy klucz DKIM jest publicznym rekordem DNS, nie sekretem SMTP.

| Typ | Nazwa względna | Pełna wartość |
|---|---|---|
| TXT | resend._domainkey.powiadomienia | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC0Qljoa6oYKNo3/2Ufs2F8lAgrMjDkpXe+fPdugCRi4wogBfXzNnZgCrziyUD4oslguiPMnFd0uuBqOZaiN3i8UKo+hbmJqmj4tnWrrYJrxH/aKgfIAOepdgQIZ5HfPqxRlA6gP75e8n/rcYvuReJxA8uoHsluDa4zd34Bh4D5hwIDAQAB |
| CNAME | rsend.powiadomienia | rsend-euw1.forge.rmta.net. |
| CNAME | send.powiadomienia | send.forge.rmta.net. |

Odbiór `kontakt@rexbid.pl → rexbid.kontakt@gmail.com` przez OVH potwierdzony przez właściciela. Sender aplikacji `no-reply@powiadomienia.rexbid.pl`; Resend Domain verified według właściciela. Oddzielenie wysyłki subdomeny nie wymaga usunięcia MX/SPF apex. Zachować obecną konfigurację także po delegacji.

## DS: odczyt po wymaganym oczekiwaniu — 2026-10-07 15:11:52 CEST

**DS/CACHE GATE PASS; DELEGATION / PUBLICATION NOT APPROVED.** Odczyt o `2026-10-07T13:11:52.629Z`, czyli **15:11:52 CEST**, nastąpił po wymaganym 14:49 czasu polskiego. Bez rekursji, bezpośrednio do rodziców `.pl`:

| Parent | DS | RCODE / AA / TC | Authority | Delegacja |
| --- | --- | --- | --- | --- |
| a-dns.pl / 192.102.225.53 | 0 | NOERROR / true / false | SOA `.pl`, TTL3600/minimum3600 | dns111.ovh.net / ns111.ovh.net |
| b-dns.pl / 192.195.72.53 | 0 | NOERROR / true / false | SOA `.pl`, TTL3600/minimum3600 | dns111.ovh.net / ns111.ovh.net |

To poprawne authoritative NOERROR/NODATA, nie timeout ani NXDOMAIN. Konserwatywne okno starego DS86400 minęło i warunek jego usunięcia został zamknięty w tym odczycie. Wynik obejmuje oba wskazane serwery; nie jest pomiarem każdego cache resolvera świata ani podpisaną kryptograficzną walidacją odpowiedzi. Dotychczasowe NS OVH pozostają niezmienione.

Dowód poza Git: `C:/Users/nowic/Documents/Codex/REXBID_PARENT_DS_AFTER_WAIT_20261007.json`; operatorowy `rexbid-parent-ds-recheck-20261007.cjs` korzysta z wcześniej sprawdzonego parsera DNS. Wykonano syntax check oraz 4 publiczne zapytania DS/NS. **Nie zmieniono DNS, NS, routingu, DNSSEC, Workera ani danych.** Poprzednia pełna parity12/12 z12:31CEST zachowana, ale nie powtarzano wszystkich rekordów w tym odczycie. Jeśli cutover będzie później, ponowić DS oraz preflight stref/TLS bezpośrednio przed osobno zatwierdzonym oknem. Pozostałe bramki produkcji i osobna zgoda właściciela nadal wymagane.

## DS: historyczny stan i procedura przed delegacją

**DS REMOVAL VERIFIED 2026-10-06 12:49:30 UTC / 14:49 CEST**. Poprzedni DS 11441/8/2 miał TTL86400. Fresh audit **2026-10-07 10:31:50 UTC / 12:31:50 CEST**: a-dns.pl (192.102.225.53) i b-dns.pl (192.195.72.53) authoritative NOERROR/NODATA, TC=false, DS0; authority SOA `.pl` obecne (TTL3600, minimum3600). Nie był to timeout ani NXDOMAIN. **O tej godzinie okno do 14:49 CEST nie minęło.** Świeże DS0 nie skraca konserwatywnego oczekiwania po wcześniejszym TTL.

Konserwatywne oczekiwanie: **nie zmieniać delegacji przed 2026-10-07 po 14:49 czasu polskiego (Europe/Warsaw / CEST)**. Po odczekaniu ponowić odczyt na obu rodzicach bez rekursji:

~~~powershell
Resolve-DnsName rexbid.pl -Type DS -Server a-dns.pl -DnsOnly -NoRecursion
Resolve-DnsName rexbid.pl -Type DS -Server b-dns.pl -DnsOnly -NoRecursion
~~~

Sprawdzić RCODE/AA/authority SOA i liczbę DS, nie tylko brak tekstu w konsoli. DS obecny lub odpowiedź niejednoznaczna = STOP. DNSKEY starej strefy nie jest parent DS. Czas oczekiwania i DS 0 nie zastępują zgody właściciela na cutover.

## Docelowy diff — przygotowany, niewykonany

1. Zatwierdzić okno, kopię pełnych stref oraz parity wszystkich 12 rekordów; produkcyjny Worker przygotowany, migracje/backup/SMTP/limiter/owner według [runbooku](PRODUCTION_CUTOVER_RUNBOOK.md).
2. OVH → domena rexbid.pl → **Serwery DNS**: dns111.ovh.net/ns111.ovh.net → blair.ns.cloudflare.com/titan.ns.cloudflare.com dopiero po powyższej kontroli DS/cache. Nie wpisywać ręcznych NS do strefy apex jako zamiennika delegacji u rejestratora.
3. Apex parking A 213.186.33.5 zastąpić zarządzanym **Worker Custom Domain rexbid.pl** wskazującym zatwierdzony produkcyjny Worker. Nie wymyślać jego IP i nie pozostawiać konfliktującego A/AAAA/CNAME na tej samej nazwie. Poprawny profil `wrangler.rexbid-production.jsonc`, nie wyłączony release 503.
4. www A 213.186.33.5 → CNAME rexbid.pl proxied + jawna reguła301/308 `https://www.rexbid.pl/<path>?<query>` → `https://rexbid.pl/<path>?<query>`. Sam CNAME nie robi HTTP redirect. Użyć reguły, która zachowuje query/path; sprawdzić certyfikat **obu** hostów. www nie tworzy drugiego canonical/Auth cookie.
5. ftp CNAME nieużywany, w pełnym eksporcie nadal proxied: proponowane usunięcie dopiero po odrębnej zgodzie na porządkowanie. Jeżeli alias ma pozostać, DNS only i jawnie poprawny FTP target; CNAME do nowego Workera nie zapewnia FTP. HTTP proxy nie obsługuje zwykłego FTP. Brak hostingu OVH nie dowodzi braku poczty OVH.
6. MX 1/5/100, apex SPF i Resend 3 rekordy **zachować dokładnie**. Oba CNAME Resend DNS only. Nie usuwać TXT1|www/3|welcome bez zatwierdzenia wygaszenia starego parkingu; nie służą poczcie ani canonical aplikacji.
7. HTTPS: certyfikat active dla apex/www, HTTP→HTTPS i www→apex bez pętli. TLS nie może być wyłączone dla Auth; wszystkie __Host cookies wymagają Secure. Nie tworzyć publicznej domeny dla prywatnego R2.
8. Canonical/sitemap/robots: produkcja https://rexbid.pl, staging nadal noindex/Disallow. Supabase production Site URL exact apex, redirect callback exact path+state policy; nowy production key i SMTP osobne od stagingu.
9. Dopiero kontrolowany smoke web/poczta/confirmation/recovery, owner+AAL2, pliki i zgoda na publikację. Błędy → rollback wg niezależnych warstw, nie destrukcyjny D1 restore na ślepo.

Delegacja do niezmienionego parkingowego A sama nie publikuje serwisu. Planować wspólne okno DNS/Worker/TLS; obecne etapy są wyłącznie przygotowaniem.

## DMARC i dostarczalność — propozycja bez zmian DNS

Propozycja po osobnym zatwierdzeniu, po kontroli nadawców:

| Nazwa względna | Typ | Wartość początkowa | Zakres |
|---|---|---|---|
| _dmarc | TXT | v=DMARC1; p=none; sp=none; | rexbid.pl oraz subdomeny bez własnej polityki |
| _dmarc.powiadomienia | TXT | v=DMARC1; p=none; | odrębna jawna polityka nadawcy aplikacji |

Polityka subdomeny ma pierwszeństwo dla jej From domain. Domyślne relaxed alignment pozostaje bez zmiany; nie ustawiać strict ani quarantine/reject przed potwierdzeniem rzeczywistego DKIM/SPF alignment wszystkich używanych nadawców. Root SPF zachować OVH; nie dodawać Resend do apex tylko dlatego, że sender używa subdomeny. SPF weryfikuje MAIL FROM/Return-Path; DKIM sprawdza domenę d=, a DMARC ich zgodność z widocznym From. Sam publiczny rekord nie dowodzi wyniku nagłówków konkretnego maila.

Nie wpisywać fikcyjnego rua. Właściciel powinien najpierw zatwierdzić istniejący adres/alias do raportów i sposób odbioru XML; dopiero wtedy dopisać `rua=mailto:<potwierdzony-adres>`. Bez rua p=none publikuje nieegzekwującą politykę, **nie zapewnia odbioru raportów**. Po realnym sprawdzeniu OVH i aplikacji rozważyć stopniowe zaostrzenie tylko odrębnie zatwierdzoną zmianą. [Resend DMARC](https://resend.com/docs/dashboard/domains/dmarc).

Właściciel potwierdził działające recovery przez Resend; wcześniejszy mail trafił do spamu. Brak pełnych Authentication-Results/Return-Path, więc **przyczyna spamu pozostaje nieustalona**. DNS auth, reputacja domeny/IP, treść i tracking mogą mieć znaczenie, lecz nie są dowodem tej próby. Tracking Resend NOT VERIFIED; przygotowany plan wymaga Click tracking OFF / Open tracking OFF dla auth, bez kupowania dodatków. [Ryzyko link tracking Supabase](https://supabase.com/docs/guides/deployment/going-into-prod#email-link-validity). Dzisiejszy etap nie wysyła nowych testów i nie zmienia DNS.

## Ponowne DNSSEC — dopiero po aktywacji Cloudflare

Warunki: Cloudflare zone active, nowe NS autorytatywne, wcześniejszy TTL delegacji wygasł, record parity, poczta i TLS działają; zgoda właściciela na ten etap.

1. [Cloudflare DNS Settings](https://dash.cloudflare.com/7ff5a57444667c4eda2a6a7f0fc4120d/rexbid.pl/dns/settings) → **DNSSEC → Enable DNSSEC**, odczytać rzeczywiste Key Tag, Algorithm, Digest Type i Digest.
2. W OVH jako rejestratorze dodać **zewnętrzny DS Cloudflare**. Nie włączać starego podpisywania strefy OVH ani używać starego DS 11441. Jeżeli panel nie pozwala wpisać zewnętrznego DS, użyć dokumentowanej ścieżki OVH/support; nie zgadywać.
3. Odczytać DS z obu .pl, DNSKEY z obu NS Cloudflare i potwierdzić zgodność digest oraz poprawną walidację przez resolver DNSSEC. Dopiero wtedy DNSSEC VERIFIED.
4. Rollback po publikacji nowego DS: najpierw usunąć/zmienić DS zgodnie z kluczem targetu i odczekać TTL starego DS; w tym czasie zachować podpisywanie i działające NS Cloudflare. Następnie zmiana delegacji. Nie wyłączać podpisywania natychmiast przy nadal cache'owanym DS i nie łączyć CF DS ze starymi OVH NS.

[Cloudflare DNSSEC migration / rollback](https://developers.cloudflare.com/dns/dnssec/), [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [proxy ograniczenia](https://developers.cloudflare.com/dns/proxy-status/use-cases/).

## Działania właściciela — rozdzielenie czasu

**Możliwe dzisiaj:** pełny eksport 12 rekordów dostarczony i parity **PASS** — ten krok zamknięty. Przygotowanie produkcyjnego Supabase i osobnego sending key bez sekretów w czacie; review planu, nieużywanego FTP i propozycji DMARC. Niczego nie przełączać.

**Aktualizacja 2026-10-07 15:11 CEST:** kontrola DS po14:49 wykonana i PASS; parent referrals nadal OVH. Właściciel nadal musi zatwierdzić konkretne okno cutoveru, a agent ponawia pozostały NS/parity/TLS preflight bezpośrednio przed nim; dopiero wtedy uzgodniona delegacja/Worker/DNS/SMTP smoke, a nowe DNSSEC po aktywacji i wygaśnięciu poprzedniego NS TTL. Sama data nie daje zgody na publikację.
