# Ponowna kontrola DNS przed akceptacją odświeżenia i publikacji

**Odczyt tylko do weryfikacji; DNS, delegacja, routing i DNSSEC bez zmian.**

## Wyniki własnych odczytów — 7 października 2026

| Kontrola | Wynik | Zakres dowodu |
| --- | --- | --- |
| Pełne rekordy OVH, zakończenie 21:15:00 CEST | **12/12 na dns111.ovh.net oraz 12/12 na ns111.ovh.net — PASS** | Bezpośrednie odpowiedzi autorytatywne, bez rekursji; całe wartości TXT po połączeniu fragmentów, priorytety MX i oba CNAME Resend |
| Strefa Cloudflare, 21:22:22 CEST | HTTP 200, rexbid.pl, pending, Free Website | Zone ID 9a1353c248c35e248f0399e736862a2e, konto 7ff5a57444667c4eda2a6a7f0fc4120d |
| Nameservery przydzielone strefie Cloudflare | **blair.ns.cloudflare.com / titan.ns.cloudflare.com** | Świeży odczyt metadanych API list/detail; nie domysł z innej strefy |
| Bieżąca lista rekordów Cloudflare | HTTP 403 / code 10000 | Nie potwierdzono, czy po dostarczonym eksporcie nie było nowych edycji w panelu |
| DS na b-dns.pl / 192.195.72.53 | **DS=0, authoritative NOERROR/NODATA, SOA .pl** | Bezpośredni UDP; referral NS nadal dns111.ovh.net / ns111.ovh.net |
| DS na a-dns.pl / 192.102.225.53 | **NOT VERIFIED w tym powtórzeniu** | UDP i bounded TCP zakończyły się timeoutem; aktualny adres serwera potwierdzono osobno |
| Alternatywne IPv6 obu rodziców | NOT VERIFIED | UDP6 do a:2001:7f9::53 oraz b:2001:7f9:c::53 zakończył się timeoutem |
| Pomocniczy odczyt przez dns.google, 21:23:42 CEST | DS NOERROR/NODATA; NS OVH | Resolver rekursywny przez HTTPS, AD=false; **nie zastępuje bezpośredniego odczytu obu serwerów nadrzędnych** |

Pełne porównanie dotyczy eksportu Cloudflare `rexbid.pl (1).txt`, Exported: 2026-10-07 10:21:12, SHA-256 `62166a231b595a99b4028f38d565740c1ca32808c11f8dbf5ee3b573bc380db7`. Zawiera 12 rekordów użytkownika oraz odrębne NS/SOA. To nie jest eksport bieżącej zawartości API Cloudflare. Nie potrzebujemy ponownie historycznego eksportu do zakończonego porównania; przed zmianą delegacji potrzebny jest bieżący podgląd/eksport strefy albo odpowiedni dostęp read-only.

## Poczta i różnice techniczne

- MX apex: 1 mx1.mail.ovh.net, 5 mx2.mail.ovh.net, 100 mx3.mail.ovh.net — zgodne na obu OVH i w pełnym eksporcie.
- SPF apex: `v=spf1 include:mx.ovh.com -all` — zachowany i zgodny. Działające przekierowanie kontaktowe pozostaje potwierdzeniem ręcznym właściciela; w tym odczycie nie wysłano wiadomości.
- Publiczny TXT DKIM `resend._domainkey.powiadomienia.rexbid.pl` porównano w pełnej długości z eksportem — zgodny na obu OVH.
- `rsend.powiadomienia` → rsend-euw1.forge.rmta.net oraz `send.powiadomienia` → send.forge.rmta.net — zgodne; oba CNAME są DNS only w przekazanym eksporcie Cloudflare. Ustawienia proxy nie są polem odpowiedzi DNS OVH.
- `_dmarc.rexbid.pl` oraz `_dmarc.powiadomienia.rexbid.pl`: authoritative NXDOMAIN na obu OVH. Plan przyszłego DMARC pozostaje propozycją z istniejącego [runbooku DNS](DNS_CUTOVER_REXBID_PL.md), bez zmian w tym etapie.
- TTL Auto w eksporcie Cloudflare a TTL 3600 OVH jest znaną różnicą dostawców, nie rozbieżnością wartości rekordów. SOA/NS obu dostawców nie muszą być identyczne.
- Nie używany `ftp` w eksporcie nadal CNAME do apex z proxy. Usunięcie jest wyłącznie przyszłą zatwierdzaną zmianą; nie zmieniono go teraz.

## Bramka przed rzeczywistą delegacją

Wcześniejszy udany odczyt obu parent DS z 15:52:30 CEST jest dowodem historycznym. Dzisiejszy późniejszy brak odpowiedzi a-dns.pl nie oznacza pojawienia się DS, ale **nie pozwala nadać temu powtórzeniu statusu obu parent PASS**. Ponowić oba bezpośrednio przed osobno zaakceptowaną zmianą delegacji. Jeśli odpowiedzi pozostają niejednoznaczne, zatrzymać sam etap delegacji i skontrolować je z innej sieci.

Docelowy zakres apex/www, zachowanie rekordów poczty, TLS, ponowne DNSSEC oraz rollback pozostają w [PRODUCTION_CUTOVER_RUNBOOK.md](PRODUCTION_CUTOVER_RUNBOOK.md). Ten raport niczego nie aktywuje i nie zastępuje zgody właściciela.

## Dowody operatorowe poza Git

`C:/Users/nowic/Documents/Codex/`:

- `REXBID_DNS_REFRESH_PREAPPROVAL_20261007.json` — pełne porównanie 12 rekordów, odpowiedzi OVH i próby obu parent.
- `REXBID_CF_DNS_REFRESH_PREAPPROVAL_20261007.json` — sanitized metadane strefy i wynik odmowy odczytu rekordów.
- `REXBID_PARENT_DS_ALTERNATIVE_PREAPPROVAL_20261007.json` — IPv6 oraz pomocniczy resolver HTTPS, jawnie oddzielone.

Skrypty operatorowe zapisują wyłącznie publiczne rekordy/metadane i bezpieczne kody błędów. Token Cloudflare pozostaje w pamięci procesu. Nie wykonano zapisów DNS, wywołań Apibara ani wysyłki e-mail.
