# Prawa do danych Apibara — potwierdzenie właściciela

**Stan zaktualizowany:** 2026-09-29 (data, w której właściciel przekazał pisemną odpowiedź do projektu). Dokładna data i identyfikator oryginalnej wiadomości nie zostały podane; należy zachować oryginalną korespondencję poza repo jako dowód warunków. Ten dokument zapisuje zakres przekazany przez właściciela, nie jest opinią prawną ani niezależną weryfikacją umowy.

## Zakres potwierdzony przez Apibara.tech

Według pisemnej odpowiedzi przekazanej przez właściciela, Apibara zezwala po swojej stronie na:

- przechowywanie danych pojazdów i aukcji w bazie Rex.Bid, również po zakończeniu aukcji i po wygaśnięciu subskrypcji, jeśli dane zostały legalnie pobrane podczas aktywnej subskrypcji;
- tworzenie historycznej bazy VIN/LOT/statusu/cen/sprzedawcy/specyfikacji/uszkodzeń/title oraz przechowywanie zmian i snapshots;
- publiczne prezentowanie historycznych danych po aukcji, użytek komercyjny (w tym płatne funkcje, analytics i alerts), normalizację i derived data;
- przechowywanie URL-i mediów, wyświetlanie wspieranych obrazów, tymczasowe cache techniczne i generowanie miniaturek.

Niedozwolone pozostaje: odsprzedaż lub udostępnianie dostępu do API Apibara, publikowanie API key, nieograniczony raw API access dla osób trzecich ani przedstawianie danych jako gwarantowanych/oficjalnych danych Copart/IAA.

## Ograniczenie oryginalnych zdjęć

Oryginalne fotografie Copart/IAA są mediami osób trzecich. Odpowiedź Apibara **nie daje osobnej sublicencji copyright** na ich trwałe archiwizowanie ani redystrybucję. Polityka projektu:

| Użycie | Status wg odpowiedzi Apibara |
|---|---|
| Przechowywanie URL-i mediów | Dozwolone |
| Wyświetlanie wspieranych zdalnych obrazów | Dozwolone |
| Tymczasowe cache techniczne | Dozwolone |
| Generowanie miniaturek | Dozwolone |
| Trwałe archiwum oryginalnych zdjęć Copart/IAA | **Nie zatwierdzono tą odpowiedzią** |

Nie kopiować ani nie zachowywać oryginalnego obrazu na stałe bez osobnej podstawy/uprawnienia od właściciela praw. Watermark Rex.Bid nie tworzy licencji i nie rozwiązuje tego ograniczenia.

## Znaczenie dla projektu

- Blocker „czekamy na zgodę Apibara” zostaje zamknięty dla factual vehicle/auction data, historii, snapshots, normalizacji/derived data oraz komercyjnego wyświetlania w granicach opisanych powyżej.
- To potwierdzenie jest stanowiskiem Apibara po jej stronie. Nie rozstrzyga ewentualnych niezależnych praw, regulaminów lub obowiązków Copart/IAA ani prywatności/retencji innych źródeł.
- D1 Sync Phase D nie jest rozpoczęta w tym sprincie. Po jego checkpointcie można planować/rozpocząć osobną implementację factual data sync; oryginalne zdjęcia nie mogą być objęte trwałym archiwum bez dodatkowej zgody.
- Pozostają wymagane security/API limits, metryki, retention/config policy, kosztowy budżet oraz osobny rollout i owner approval.

## Dowody i kontrola zmian

W repo przechowywać wyłącznie to podsumowanie i ewentualny zredagowany dokument bez sekretów/PII. Oryginalny e-mail/załącznik powinien pozostać w kontrolowanym mailboxu/records vault; zanotować nadawcę, datę, wersję warunków i scope, aby można było wykazać provenance. Jeżeli warunki zmienią się, aktualizować ten dokument i D1 Sync design, nie risetować/retencjonować danych automatycznie na podstawie domysłów.
