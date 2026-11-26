# Portal — poprawki lokalne 2026-10-07

Baza: checkpoint `364b1d7`. Portal/MFA staging zachowany. Ten etap przygotował kod i SQL lokalnie; migracja, backup, pełna regresja, staging deploy i browser QA należą do głównego zadania.

## Zmiany

- Wybór klienta i podsumowanie właściciela pokazują zapisany profil: imię/nazwisko, e-mail i telefon. Brak profilu jest jawny. UUID jest w rozwijanym szczególe identyfikacji, a przy braku profilu krótki sufiks pomaga rozróżniać konta. Konto właściciela jest wyraźnie podpisane przez serwer i UI, także gdy profil jest pusty. Nie pobieramy adresów Supabase poza istniejącym modelem profilu i nie tworzymy fikcyjnych danych.
- Etykiety VIN/LOT odpowiadają zachowanemu CHECK i walidacji: VIN wymagany przy braku LOT; LOT z platformą przy braku VIN. LOT 1–32 znaków A–Z/0–9/myślnik, VIN dokładnie 17 dozwolonych znaków. Normalizacja wielkości liter jest zgodna z API.
- Lista realizacji zawiera klienta (tylko owner), lokalizację, czas ostatniej aktualizacji, orientacyjne ETA i liczbę nowych wiadomości. Karta szczegółów zawiera dane przypisanego klienta wyłącznie dla właściciela.
- `confirmed_stages` zbiera wyłącznie klientowskie zdarzenia `created`/`update`, także poza pierwszą stroną. Nie wywnioskuje płatności/załadunku ani wcześniejszych etapów z późniejszego statusu. Notatki internal nie potwierdzają etapów klienta. Nadawcy historycznych wiadomości pozostają bez zmian, nowe wiadomości nadal wybierają rolę wyłącznie po stronie serwera.
- Materiały owner mają widoczną etykietę „Widoczny dla klienta” albo „Tylko zespół REXBID”. Istniejąca autoryzacja pobrań i filtrowanie klienta są zachowane.
- Trwały unread: `import_order_message_reads(message_id, audience, read_at)`, audience `client` lub `team`, PK `(message_id,audience)`. To indywidualne potwierdzenia wiadomości zamiast watermarka czasu; wiadomość z tą samą datą lub poza pobraną stroną nie zostaje przypadkiem przeczytana. API listy i detalu liczy incoming messages bez potwierdzenia danego odbiorcy. Otwieranie i odświeżanie panelu nie zapisują receipts. Jawny przycisk oznacza wczytane incoming messages; starsze wiadomości wymagają wczytania. Każdy POST `/api/portal/orders/:id/read` sprawdza klienta własnej realizacji albo owner AAL2, same origin, dokładne ID tej rozmowy i właściwego nadawcę. Audience nie przyjmuje z body. Ponowienie jest idempotentne, maksymalnie 50 IDs w partii.

## Migracja — przygotowana, NIE zastosowana przez agenta portalu

Staging: `migrations-staging/0007_portal_message_reads.sql`. Produkcyjna propozycja: `docs/proposals/0007_portal_message_reads.sql`. Oba zawierają wyłącznie nową tabelę i indeks `(order_id,author_role,id)` wiadomości. Nie zmieniają istniejących rekordów, szyfrogramów ani ról. Flaga głównego schematu portalu pozostaje `0006`; SQL `0007` należy zastosować po backupie i przed wdrożeniem nowego kodu. Brak tabeli powoduje zamkniętą odpowiedź 503 prywatnych list/detalu/wiadomości.

Preflight tylko odczyt, po sprawdzeniu właściwej staging D1:

```sql
SELECT name, sql FROM sqlite_master
WHERE name IN ('users','import_orders','import_order_events','import_order_messages',
               'import_order_files','portal_customer_profiles','import_order_message_reads',
               'idx_import_order_messages_recipient');
SELECT 'users' AS table_name, COUNT(*) AS rows FROM users
UNION ALL SELECT 'favorites', COUNT(*) FROM favorites
UNION ALL SELECT 'orders', COUNT(*) FROM import_orders
UNION ALL SELECT 'events', COUNT(*) FROM import_order_events
UNION ALL SELECT 'messages', COUNT(*) FROM import_order_messages
UNION ALL SELECT 'files', COUNT(*) FROM import_order_files
UNION ALL SELECT 'profiles', COUNT(*) FROM portal_customer_profiles;
PRAGMA foreign_key_check;
```

Readback po zastosowaniu do stagingu, przed deployem:

```sql
PRAGMA table_info(import_order_message_reads);
PRAGMA foreign_key_list(import_order_message_reads);
PRAGMA index_list(import_order_message_reads);
PRAGMA index_info(idx_import_order_messages_recipient);
SELECT audience, COUNT(*) AS receipts FROM import_order_message_reads GROUP BY audience;
SELECT COUNT(*) AS receipts FROM import_order_message_reads;
PRAGMA foreign_key_check;
```

Początkowo receipts=0, więc istniejące incoming wiadomości są nieprzeczytane; nie wywnioskujemy historycznego przeczytania. Powtórzyć dokładne liczniki preflight; muszą pozostać identyczne. Backup powinien zachować wszystkie istniejące tabele i szyfrogramy oraz nowy receipt state po uruchomieniu. Rollback kodu nie wymaga usuwania nowej tabeli/indeksu.

## Weryfikacja lokalna

`node --test tests/import-operations.test.cjs tests/client-portal-dom.test.cjs tests/portal-worker-integration.test.cjs tests/portal-session.test.cjs tests/owner-mfa.test.cjs tests/portal-private-files.test.cjs tests/portal-export.test.cjs`: **135/135 PASS**. 14 nowych behavioral testów (7 backend, 7 DOM). Rehearsal idempotencji migracji w lokalnym SQLite zachowuje wszystkie istniejące rekordy i FK. Obejmuje client/team, foreign order/message IDs, AAL1, CSRF, spoofed audience, nieznane/duplikowane IDs, same timestamp race, starsze strony, stale UI response, zachowanie niezapisanej wiadomości, etapów i profili. Składnia obu zmienionych modułów PASS; `git diff --check` PASS. Hash JS/CSS w obu HTML odświeżony.

Zmiany ograniczone do `portal/operations.cjs`, `public/rexbid-client-portal.js/.css`, `public/panel.html`, `public/administracja.html`, nowej migracji/propozycji, powiązanych testów i tej notatki. `worker.js`, profile konfiguracji, auth/MFA, katalog, kalkulator i globalny CSS nietknięte. 0 deploy, 0 zdalnych migracji/zapisów, 0 e-maili, 0 requestów Apibara przez agenta portalu. Browser QA zdalnego stagingu nie jest tu claimowane.
