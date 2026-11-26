## Nadrzędny wynik — wszystkie bieżące NS IANA, 13:41–13:44 CEST

Po wcześniejszych próbach a/b opisanych poniżej uzyskano dodatkowe, niezależne odpowiedzi autorytatywne z aktualnej delegacji [IANA .pl](https://www.iana.org/domains/root/db/pl.html). Listę pobrano **8.10.2026**; record updated: **2026-04-24**. Obejmuje a, b, d, f, h i j, każdy z adresem IPv4 i IPv6. Ocenę oparto na tej macierzy, a nie wyłącznie na a-dns, który nie odpowiada. Wszystkie zapytania były read-only, RD = 0, DO = 1.

Poniższe odpowiedzi DS uzyskano przez IPv4; próby IPv6 opisano osobno.

| Serwer | IPv4 / IPv6 według IANA | DS UDP / TCP, 8.10 UTC | AA / TC | Status i DS |
| --- | --- | --- | --- | --- |
| a-dns.pl | 192.102.225.53 / 2001:7f9::53 | timeout 11:41:46.881 / 11:41:46.882 | brak odpowiedzi | NOT VERIFIED; nie DS = 0 |
| b-dns.pl | 192.195.72.53 / 2001:7f9:c::53 | 11:41:40.539 / 11:41:40.798 | 1 / 0 | NOERROR/NODATA; DS = 0 |
| d-dns.pl | 185.159.197.48 / 2620:10a:80aa::48 | 11:41:40.554 / 11:41:40.815 | 1 / 0 | NOERROR/NODATA; DS = 0 |
| f-dns.pl | 194.0.25.29 / 2001:678:20::29 | 11:41:40.538 / 11:41:40.792 | 1 / 0 | NOERROR/NODATA; DS = 0 |
| h-dns.pl | 185.159.198.48 / 2620:10a:80ab::48 | 11:41:40.811 / 11:41:40.871 | 1 / 0 | NOERROR/NODATA; DS = 0 |
| j-dns.pl | 204.61.217.4 / 2001:500:14:7004:ad::1 | 11:41:40.793 / 11:41:40.894 | 1 / 0 | NOERROR/NODATA; DS = 0 |

Pięć serwerów odpowiedziało poprawnie przez UDP i TCP. SOA .pl miał serial **1791441068**, answer nie zawierał DS, a authority zawierało SOA potwierdzające NODATA. Czas lokalny to UTC + 2.

Osobny odczyt SOA j-dns.pl przez TCP w macierzy zakończył się timeoutem. Ograniczone ponowienie o **11:45:45.793 UTC** uzyskało AA = 1, NOERROR i serial **1791441069**. Wcześniejsze odpowiedzi miały serial 1791441068; samo zwiększenie serialu nie świadczy o zmianie DS.

Parent NS to referral z AA = 0, wskazujący **dns111.ovh.net / ns111.ovh.net**, nie odpowiedź z AA = 1. Wszystkie 10 otrzymanych delegacji wskazywało OVH. a-dns pozostał bez odpowiedzi także po 12 ograniczonych powtórkach z różnymi ustawieniami EDNS/RD. Nie wykonywano kolejnych nieograniczonych prób.

IPv6, UDP/TCP wszystkich 6 NS: **ENETUNREACH**. Host nie ma domyślnej trasy IPv6. Próby wykonano, ale nie uzyskano odpowiedzi; ten wynik nie oznacza DS = 0. Pomocnicze ścieżki HTTPS Google i Cloudflare DoH pokazują DS NODATA i NS OVH, a [NASK RDAP](https://rdap.dns.pl/domain/rexbid.pl) wskazuje delegationSigned = false. Cache i opóźnienie rejestru ograniczają te dowody; nie zastępują pięciu autorytatywnych odczytów.

**Świeża pełna zgodność: 12/12 rekordów** z najnowszym eksportem rexbid.pl (2).txt. SHA-256: 1c45e4ec71a3b1e0141271e0eac683ac8ec2d946819fae9bcfb776a046a9da62. Porównanie wykonano **11:44:19–26 UTC / 13:44 CEST** na obu OVH i obu przydzielonych Cloudflare NS: **blair.ns.cloudflare.com / titan.ns.cloudflare.com**.

| Zakres | Wynik |
| --- | --- |
| OVH | 18/18 zapytań na każdym NS |
| Cloudflare | 54/54 na każdym NS: 3 IPv4 × UDP/TCP × 9 RRsetów |
| Odpowiedzi | AA = 1, NOERROR |
| TXT/DKIM i priorytety MX | Pełna zgodność |
| SOA OVH / Cloudflare | 2091375808 / 2416788901 |

NS i SOA różnych dostawców nie muszą być identyczne. Ustawienie DNS only dla Resend potwierdzają eksport i wcześniejsze panele, nie sam odczyt DNS. Ta kontrola nie sprawdzała bieżącego statusu Active w dashboardzie Cloudflare. Delegacja nadal wskazuje OVH.

Ocena: zachowano wcześniejszy dowód braku DS i zakończony okres oczekiwania do **7.10, godz. 14:49 CEST**. Pięć aktualnych, zgodnych odpowiedzi z AA = 1 wspiera **gotowość po osobnej zgodzie**. Pokrycie a-dns i IPv6 pozostaje nierozstrzygnięte.

W faktycznym oknie ponowić macierz autorytatywnych odczytów dla aktualnych NS IANA. Otrzymany DS ≠ 0, sprzeczność lub brak dostatecznych autorytatywnych odpowiedzi oznacza **STOP**. Nie traktować timeoutu jako DS = 0 i nie wymagać ponownego eksportu od właściciela bez wykrytej zmiany strefy.

Publiczny receipt poza Git: C:/Users/nowic/Documents/Codex/REXBID_DNS_READINESS_AGGREGATE_20261008T115139Z.json. Zawiera czasy i odnośniki do szczegółowych macierzy UDP/TCP/DoH/RDAP. **Zmiany DNS/NS/DNSSEC = 0; nowe requesty Apibara = 0.**

---

## Historia wcześniejszych odczytów8.10 — zastąpiona nadrzędną oceną powyżej

# REXBID — DNS i przygotowany zakres publikacji, 8 października 2026

## Nowy pełny eksport Cloudflare — kontrola 13:12:49 CEST

Dostarczono rexbid.pl (2).txt, etykieta eksportu **2026-10-08 11:10:35** (plik nie podaje strefy czasowej). SHA-256 **1c45e4ec71a3b1e0141271e0eac683ac8ec2d946819fae9bcfb776a046a9da62**. Nowy bezpośredni odczyt OVH zakończono **2026-10-08T11:12:49.255Z / 13:12:49 CEST**: pełne RRsety **12/12 PASS na dns111.ovh.net i 12/12 PASS na ns111.ovh.net**. Porównano całe TXT/DKIM, MX z priorytetami, SPF, CNAME i pozostałe rekordy; bez duplikatów. To nowy snapshot strefy dostarczony przez właściciela, nie live API Cloudflare.

- MX OVH 1/5/100 i SPF domeny głównej zgodne; konfiguracji przekierowania kontaktu nie zmieniano ani nie testowano nowym mailem.
- Pełny DKIM Resend zgodny; oba CNAME rsend.powiadomienia i send.powiadomienia mają w nowym eksporcie **cf-proxied:false (DNS only)**.
- Dokładne NS Cloudflare **blair.ns.cloudflare.com / titan.ns.cloudflare.com** potwierdzone eksportem i wcześniejszymi metadanymi tej strefy.
- FTP nadal ma **cf-proxied:true**; nieużywany według właściciela. Jego usunięcie pozostaje elementem przyszłego zatwierdzonego diffu, niczego teraz nie zmieniono. Parkingowe A apex/www nadal213.186.33.5 i proxied.
- DMARC apex i powiadomienia nadal brak, authoritative NXDOMAIN na obu OVH; bez zmian DNS.
- Nowy direct DS/NS: b-dns.pl **DS=0 PASS**, authoritative NOERROR/NODATA, SOA .pl, TC=false, delegacja OVH. a-dns.pl **UDP/TCP timeout — NOT VERIFIED**. Bieżące adresy A obu parentów rozwiązały się do dotychczas użytych192.102.225.53/192.195.72.53; timeout nie wynika z wykrytego błędnego adresu i nie jest dowodem braku DS.

Niezależne lokalne porównanie eksportu7.10 z nowym8.10: wszystkie 12 rekordów, TTL i flagi proxy identyczne; różnią się tylko etykieta daty oraz SOA serial2054303507→2054312443. Receipt C:/Users/nowic/Documents/Codex/REXBID_CFEXPORT2_COMPARE_20261008.json. Zgodność bieżącego dostarczonego eksportu z live OVH potwierdzono odrębnie powyżej.

**Bramka pełnego eksportu CF jest zamknięta dla tego snapshotu.** Nie potrzeba ponownie tego samego eksportu ani nowego tokenu DNS. Przed właściwą delegacją ponowić autorytatywną macierz DS według nadrzędnej oceny powyżej; jeśli strefa zostanie później zmieniona, potrzebny nowy snapshot/diff. Nie wykonano żadnego deployu, Apibara, DNS writes, zmiany NS/DNSSEC ani wysyłki poczty.

Receipt poza Git: C:/Users/nowic/Documents/Codex/REXBID_DNS_EXPORT2_CHECK_20261008.json. Poprzednie dowody niżej zachowują własne daty.


Wykonano odczyt publicznego DNS i metadanych Cloudflare. Ten raport aktualizuje dowody DNS dla bieżącego etapu. Odświeżenie katalogu, staging i końcowy Version ID są dokumentowane osobno. Checkpoint wejściowy: `6457d52742ec80e96caa095767c0ea69be2d3aa0`, z zachowaniem późniejszych zmian.

## Końcowe powtórzenie DS/NS obu parentów — 12:34:14 CEST

**2026-10-08T10:34:14.855Z: oba-parent PASS nadal NOT VERIFIED.** Ponowiono wyłącznie bezpośrednie zapytania DS/NS rexbid.pl, bez rekursji, do tych samych obu serwerów nadrzędnych .pl. Wynik:

| Parent | Końcowy DS | Końcowy NS / zakres |
| --- | --- | --- |
| b-dns.pl / 192.195.72.53 | **PASS: DS=0**, UDP, authoritative NOERROR/NODATA, TC=false, authority SOA .pl | Referral nadal dns111.ovh.net / ns111.ovh.net |
| a-dns.pl / 192.102.225.53 | **NOT VERIFIED**, UDP i bounded TCP: timeout | Zapytanie NS również UDP/TCP timeout; brak odpowiedzi nie oznacza zmiany delegacji |

Receipt: `C:/Users/nowic/Documents/Codex/REXBID_PARENT_DS_FINAL_20261008.json`, z osobnymi próbami UDP i wynikiem bounded TCP. Timeout a-dns.pl nie daje dowodu braku DS; późniejsze odpowiedzi pięciu NS i inne ścieżki zamykają ocenę według nadrzędnego rozdziału; ponowić ją w faktycznym oknie. Poniższe parity OVH/Cloudflare i IPv6/HTTPS mają zachowane własne wcześniejsze czasy; nie pobierano ponownie strefy CF ani wszystkich rekordów poczty w tym końcowym odczycie.

Końcowe zapytania nie używały tokenu ani Cloudflare API. **0 Apibara i 0 zmian DNS/NS/tras/DNSSEC**. Wcześniejszy własny log tokenu został zredagowany; nowy helper direct DNS nie zapisuje tokenu.

## Wyniki wcześniejszego odczytu tego dnia — 11:33–11:34 CEST

| Kontrola | Wynik | Zakres dowodu |
| --- | --- | --- |
| OVH dns111.ovh.net / 5.196.45.181 | **12/12 PASS** | Całe RRsety, pełne TXT po połączeniu fragmentów i priorytety MX; autorytatywnie bez rekursji |
| OVH ns111.ovh.net / 5.135.79.5 | **12/12 PASS** | Ta sama kontrola; zakończenie 2026-10-08T09:33:47.911Z / 11:33:47 CEST |
| Cloudflare zone list/detail | **HTTP 200 / pending / Free Website** | 2026-10-08T09:33:29.990Z / 11:33:29 CEST; rexbid.pl, zone 9a1353c248c35e248f0399e736862a2e, konto 7ff5a57444667c4eda2a6a7f0fc4120d |
| Przydzielone NS Cloudflare | **blair.ns.cloudflare.com / titan.ns.cloudflare.com** | Świeże metadane dokładnie tej strefy; original NS: ns111.ovh.net / dns111.ovh.net |
| Cloudflare live dns_records | **403 / code 10000 — NOT VERIFIED** | Token nie pozwala czytać rekordów; pusta lista w receipt oznacza brak dostępu, nie pustą strefę |
| b-dns.pl / 192.195.72.53 DS | **PASS: DS=0** | Direct UDP, authoritative NOERROR/NODATA, TC=false, SOA .pl; NS referral OVH dns111/ns111 |
| a-dns.pl / 192.102.225.53 DS/NS | **NOT VERIFIED** | Direct UDP oraz bounded TCP: timeout |
| IPv6 obu parentów DS/NS | **NOT VERIFIED** | a:2001:7f9::53 oraz b:2001:7f9:c::53, UDP6: timeout |
| Pomocniczy dns.google HTTPS | **DS NODATA, NS OVH** | 2026-10-08T09:34:52.644Z / 11:34:52 CEST, HTTP200, AD=false; rekursywny odczyt nie zastępuje obu parentów |
| DMARC apex i powiadomienia | **Brak rekordów** | Authoritative NXDOMAIN na obu OVH |

Porównano pełny eksport `C:/Users/nowic/Downloads/rexbid.pl (1).txt`, oznaczony `Exported: 2026-10-07 10:21:12`, SHA-256 `62166a231b595a99b4028f38d565740c1ca32808c11f8dbf5ee3b573bc380db7`. Zawiera **12 rekordów użytkownika** oraz oddzielne NS/SOA. Brak duplikatów eksportu; **24/24** porównania nazw, typów, pełnych wartości i priorytetów MX zgodne. To dowód zgodności tego eksportu z dzisiejszym OVH, nie bieżącej pełnej zawartości Cloudflare ani braku późniejszych zmian panelu.

W tej wcześniejszej próbie oba parenty sprawdzono, lecz tylko b-dns.pl odpowiedział poprawnie bezpośrednio. Timeout a-dns.pl nie dowodzi obecności ani braku DS. Historyczne udane odczyty 7 października zachowano; dzisiejszy etap nie ma statusu obu parentów PASS. Aktualny stan rozszerzonej macierzy podano w nadrzędnym rozdziale.

## Zachowanie poczty

| Element | Dokładnie zachowywany stan |
| --- | --- |
| Apex MX | 1 mx1.mail.ovh.net, 5 mx2.mail.ovh.net, 100 mx3.mail.ovh.net — zgodne |
| Apex SPF | v=spf1 include:mx.ovh.com -all — zgodny |
| Resend DKIM TXT | resend._domainkey.powiadomienia.rexbid.pl — cała wartość zgodna |
| Resend CNAME | rsend.powiadomienia → rsend-euw1.forge.rmta.net; send.powiadomienia → send.forge.rmta.net — zgodne, DNS only w eksporcie |
| Forwarding OVH | kontakt@rexbid.pl → rexbid.kontakt@gmail.com; zachować wcześniejsze potwierdzenie właściciela |
| Pozostałe TXT | Apex 1\|www.rexbid.pl i www 3\|welcome — zachować do osobnego porządkowania |

TTL Auto=1 w eksporcie Cloudflare i TTL3600 OVH to różnica dostawców. NS/SOA nie wymagają identycznych wartości. Proxy jest ustawieniem CF, nie polem odpowiedzi OVH; bieżące proxy nie zostało potwierdzone przez live API. Nie wysyłano poczty. Zgodność DNS nie dowodzi Authentication-Results konkretnej wiadomości. DMARC pozostaje osobną propozycją bez zmian DNS.

## Dokładny przygotowany zakres podłączenia

| Element | Przygotowany target / zachowanie |
| --- | --- |
| Worker | rexbid-production-preflight / worker.publication.js / faza catalog |
| Odseparowana D1 | rexbid-production-preflight-db / c8a30088-70af-43a6-9a7f-c4018279d37d |
| Custom Domains | rexbid.pl i www.rexbid.pl, oba na tym samym nowym Workerze |
| Canonical i alias | https://rexbid.pl; HTTPS www GET/HEAD → apex 308, pełne path/query, no-store, bez cookies; inne metody 421 |
| Pierwsza publikacja | Częściowy zapisany katalog, karty, historia obserwacji, Calculator V4, lokalne ulubione i kontakt |
| Produkcja OFF | Auth, portal, załączniki, Cron, publiczny Sync, automatyczny fallback do Apibara |
| Poza zakresem | mtbid oraz rexbid-db / 971879fe-04ed-4e8c-9dc6-5306980bb872 |

Odczytano profil `wrangler.production-publication.jsonc` i wrapper: dwa exact Custom Domains, stored reads, Auth=false, portal/files disabled, brak Cron triggers/R2. Wrapper sprawdza originy i target D1. To kontrola źródła; publiczny TLS i runtime pozostają przyszłą bramką.

Do wykonania dopiero po zatwierdzeniu konkretnego okna DNS/publikacji:

1. Zapisać bieżące pełne snapshoty CF/OVH, sprawdzić wartości i proxy, świeży backup odseparowanej D1, końcowy build/Version ID i autorytatywną macierz parent DS. Sprzeczny DS, brak wystarczających odpowiedzi lub brak aktualnej strefy zatrzymuje delegację.
2. W OVH zmienić wyłącznie delegację dns111/ns111 → **blair.ns.cloudflare.com i titan.ns.cloudflare.com**; zachować strefę OVH i forwarding kontaktu.
3. Czekać na Cloudflare active i docelowe parent NS. W zatwierdzonym diffie usunąć parkingowe A apex/www → 213.186.33.5 oraz nieużywany ftp CNAME → apex. Zachować MX/SPF/DKIM/Resend i pozostałe TXT.
4. Powiązać oba Custom Domains z nowym Workerem. CF zarządza ich DNS i certyfikatami; nie ustalać ręcznego IP. Przy tym wrapperze nie dokładać CNAME www → apex ani drugiej reguły www → apex. Aktywna strefa jest warunkiem Custom Domains. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
5. Jawnie ustawić HTTP → HTTPS dla apex/www. Wrapper dopuszcza originy HTTPS, więc nie zastępuje tego przekierowania. Sprawdzić active certyfikatów obu nazw, hostname/chain oraz path/query i brak pętli. Certyfikaty Custom Domains nie wymagają osobnego abonamentu Advanced Certificate Manager; nie aktywować płatnych dodatków. [Cloudflare Certificates](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#certificates).
6. Wykonać publiczny desktop/mobile smoke katalogu, VIN/LOT, kart obu platform, mediów/zastępczego stanu zdjęć, historii, V4, ulubionych i kontaktu oraz OFF wyłączonych funkcji. Zapisać działającą wersję katalogu.
7. Po stabilizacji i osobno zatwierdzonym kroku DNSSEC: CF signing ON, rzeczywisty nowy DS do OVH, kontrola parent DS i walidujących resolverów; nie używać dawnego DS OVH. [Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/).

## Rollback

| Trigger | Przygotowana akcja |
| --- | --- |
| FAIL przed publikacją | Zatrzymać podłączenie; zachować OVH i przygotowany katalog |
| Regresja katalogu/V4 | Cofnąć build tego samego nowego Workera albo jego Custom Domains; nie używać mtbid jako rollbacku |
| Błąd DNS/TLS | Odtworzyć zatwierdzony snapshot CF/routingu; powrót delegacji OVH po kontroli TTL/DS, z zachowaniem MX/SPF/forwardingu |
| Utrata danych | Freeze i backup incydentu, restore do osobnej D1, kontrola schema/count/FK, uzgodniony rebind; nie nadpisywać bieżącej bazy starszym dumpem |
| Powrót NS po nowym DS | Najpierw usunąć/bezpiecznie zmienić DS i odczekać TTL, zachowując CF NS/signing; dopiero potem cofnąć delegację. Rollback Workera nie cofa DNS/DS. [Cloudflare DNSSEC rollback](https://developers.cloudflare.com/dns/dnssec/#roll-back-dnssec) |

Najnowszy pełny eksport został już porównany również z live CF/OVH; ponownego pliku nie wymaga się bez późniejszej zmiany. Ten sam historyczny eksport nie wymaga ponownego dostarczenia. Właściciel zatwierdza końcowy build, publikowane dane podmiotu i konkretne okno DNS/publikacji. Kontrolę parentów wykonuje operator według aktualnej listy IANA i oceny z nadrzędnego rozdziału; timeout a nie zastępuje DS, lecz pięć zgodnych AA odpowiedzi jest osobnym dodatnim dowodem. Produkcyjne logowania/MFA nie są warunkiem fazy catalog.

## Nowe dowody poza Git

W `C:/Users/nowic/Documents/Codex/`, bez nadpisania starszych receipts:

- `REXBID_DNS_READINESS_REFRESH_20261008.json` — pełne parity12, odpowiedzi OVH i obu parentów.
- `REXBID_CF_DNS_READINESS_REFRESH_20261008.json` — sanitized strefa i odmowa live rekordów.
- `REXBID_PARENT_DS_READINESS_ALTERNATIVE_20261008.json` — oddzielny IPv6 i pomocniczy HTTPS.
- `REXBID_PARENT_DS_FINAL_20261008.json` — końcowy direct DS/NS obu parentów, 12:34:14 CEST.

Helpery 20261008 pochodzą z odczytanych helperów poprzedniego etapu, z nowymi ścieżkami dowodów. Wykonują publiczne DNS i Cloudflare GET; token pozostaje w pamięci procesu. **0 wywołań Apibara w części DNS, 0 DNS writes, 0 zmian delegacji/tras/DNSSEC, 0 zakupów i 0 commit/push przez tę część etapu.**
