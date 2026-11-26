# REXBID — plan podglądu na własnej domenie

Data: 2026-10-06. Ustalona przez właściciela domena: **rexbid.pl**.

## Zakres

Profesjonalna wersja powstaje na odtworzonej i zweryfikowanej paczce V4, bez cofania funkcji do starszego `main`. Docelowa witryna to `https://rexbid.pl`. Proponowany osobny adres review to `https://preview.rexbid.pl`; nie został jeszcze utworzony. Obecny działający staging pozostaje pod `https://rexbid-auth-test.tedn828.workers.dev`.

Podgląd ma korzystać z danych stagingowej D1 `rexbid-auth-test-db` (`acb3cb8e-69a2-459f-8a46-0f2f5b9004be`). Produkcyjna D1 `rexbid-db` (`971879fe-04ed-4e8c-9dc6-5306980bb872`) i Worker `mtbid` pozostają poza zakresem publikacji review. W ramach podglądu nie wykonuje się migracji, Cron, backfillu ani synchronizacji. Dostęp do kont i mutacje użytkowników na nowym preview pozostają wyłączone do oddzielnego testu konfiguracji Auth.

## Co ustalono w tej sesji

- `wrangler whoami` (Wrangler 4.146.0) zwrócił **You are not authenticated**. Nie rozpoczęto logowania ani żadnego deployu.
- Stagingowy `wrangler deploy --dry-run --config wrangler.staging.jsonc` przeszedł: jedyny binding D1 to `rexbid-auth-test-db`, assets `public/`. Suchy build nie potwierdza wdrożenia ani działania na domenie.
- Generator partnera V2 przeszedł po przywróceniu oryginalnych końców linii CRLF źródeł. Zmiana LF/CRLF wpływała na SHA i wersję, ale **nie na kwoty ani dopasowania**. V4 pozostaje `rex-partner-v4-f0a67460b203286f`.
- Repo ma starsze dokumenty mówiące, że domena nie została wybrana. W tej sesji jest wybrana: **rexbid.pl**. Starsze stwierdzenia nie są aktualną decyzją właściciela.

## Dlaczego samo dodanie domeny nie wystarczy

Obecny kod celowo dopuszcza część funkcji tylko na dokładnym hoście stagingu:

| Element | Bieżące zachowanie | Wymaganie dla osobnego podglądu |
| --- | --- | --- |
| Calculator V4 | `worker.js` dopuszcza staging lub jawnie włączony preview, zawsze z dokładnym HTTPS originem | Dopuścić dokładny preview origin w kontrolowanym, testowanym trybie preview |
| Publiczne odczyty D1 | `staging/d1-primary-reads.cjs` wymaga hosta i flag stagingu | Oddzielna ścieżka odczytu GET dla preview, zawsze stagingowa D1 i jawne partial/stale |
| Konta | Auth wymaga dokładnego canonical originu; `staging-bypass` tylko dla stagingu | Na preview Auth OFF; nie rozszerzać bypassu na nową domenę |
| Diagnostyka i sync | Wrapper importuje `__staging` routes | Osobny preview entrypoint, bez diagnostyki, sync POST i mutacji |
| SEO | Staging ma noindex i blokadę sitemap | Preview również noindex; produkcyjne canonical/sitemap dopiero przy zatwierdzonej publikacji na `rexbid.pl` |

Nie stosować przepisywania żądań preview na stagingowy hostname w celu obejścia tych bramek. Nowy origin musi być obsłużony jawnie w kodzie i testach. Nie kopiować stagingowego `AUTH_RATE_LIMITING_MODE=staging-bypass` do konfiguracji nowej domeny.

## Przygotowany wariant i testy

Dodano osobny Worker `rexbid-preview` z entrypointem `worker.preview.js` i konfiguracją `wrangler.preview.jsonc`; dokładny HTTPS origin `https://preview.rexbid.pl`; tylko odczyty publicznych danych D1 i assets, Auth OFF, sync OFF, zero połączeń do providera. Zwraca opis pokrycia częściowego oraz daty aktualności. Stare dane nie mogą być prezentowane jako świeża oferta ani aktywny countdown bez aktualnego stanu aukcji.

Konfiguracja DNS/Custom Domain będzie zawierać tylko subdomenę:

```json
{
  "routes": [
    { "pattern": "preview.rexbid.pl", "custom_domain": true }
  ]
}
```

Produkcji `wrangler.jsonc` nie zmieniano dla preview. Testy `tests/preview-domain.test.cjs`: **11/11 PASS** — zły host/HTTP i zmiana targetu są odrzucane; adapter testowy dopuszcza wyłącznie SQL SELECT; POST/sync/operator routes są blokowane, Auth jest wyłączony z czytelnym powodem; noindex, paginacja, filtry, exact LOT/platform/VIN, stale daty i rozdzielona historia działają. Jedyny publiczny wyjątek delegacji API to bezpieczne `/api/contact/config`, które zwraca konfigurację kanału/draftu i niczego nie wysyła. Kalkulator V4 pozostaje na dokładnej allowliście HTTPS preview, obsługiwanej przez współdzielony Worker. Rzeczywisty preview-domain browser QA wymaga wdrożenia i nie został wykonany.

## Kolejność udostępnienia review

1. Po zakończeniu wszystkich zmian uruchomić `node --test`, oba generatory `--check`, validator i `git diff --check`, a następnie ponowić suchy build `npx --yes wrangler@4.146.0 deploy --dry-run --config wrangler.preview.jsonc`. Sprawdzić jedyny binding: `rexbid-auth-test-db`. Ten build nie wymaga deployu ani migracji.
2. W istniejącym koncie właściciela potwierdzić aktywną strefę Cloudflare `rexbid.pl` i brak kolidującego CNAME `preview`. Wprowadzać poświadczenia wyłącznie w narzędziu logowania, nie do repo i nie do czatu.
3. Po review konkretnego builda i w autoryzowanym oknie domeny uruchomić `npx --yes wrangler@4.146.0 deploy --config wrangler.preview.jsonc` — publikuje wyłącznie `rexbid-preview` i `preview.rexbid.pl`. Tego polecenia nie wykonano w tej sesji; wymaga istniejącej sesji konta właściciela i zmienia routing wyłącznie subdomeny. Cloudflare Custom Domain tworzy rekord DNS i certyfikat; jest to zewnętrzna zmiana routingu, której jeszcze nie wykonano.
4. Zmierzyć publiczny smoke/real-browser QA na desktopie i mobile: wyszukiwanie, dokładny LOT/VIN, kategorie, paginacja, galeria, kalkulator, inquiry draft i ulubione lokalne. Sprawdzić noindex i brak aktywnych mutacji/API providera.
5. Dopiero po zaakceptowaniu rzeczywistego review osobno przygotować cutover produkcji `rexbid.pl`: jej własna D1, backup/migracje, budżety, canonical/sitemap oraz ewentualny produkcyjny Auth z limiterem i callbackami. Nie wskazywać stagingowej D1 jako produkcyjnego katalogu.

## Źródło konfiguracji Custom Domain

Dokumentacja Cloudflare, sprawdzona 2026-10-06: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ . Custom Domain wymaga aktywnej strefy należącej do konta; nie może kolidować z istniejącym CNAME. Powyższa procedura nie stanowi potwierdzenia aktualnego DNS ani dostępności domeny — bieżąca sesja nie ma dostępu do konta Cloudflare.
