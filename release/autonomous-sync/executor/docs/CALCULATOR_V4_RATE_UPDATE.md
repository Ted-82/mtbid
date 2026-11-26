# Procedura aktualizacji cennika Calculator V4

Źródłem danych runtime jest przeglądany pakiet `data/partner/RexBid_Calculator_V4_2026-10-04/generated/partner-rates.review.json`, zbudowany z CSV w `data/partner/RexBid_Calculator_V4_2026-10-04/data/`. Nie edytuj ręcznie wygenerowanego `public/rexbid-calculator-v4-rates.js` ani algorytmu w celu zmiany stawki.

## Zmiana

1. Zachowaj aktualny pakiet i źródłowe pliki/fotografie jako poprzednią wersję.
2. Uzyskaj od partnera/właściciela konkretny eksport albo pisemne potwierdzenie nowej stawki, preferowanego terminalu, klasy lub dopłaty. Dodaj źródło, otrzymano dnia, status i — tylko gdy podano — `effective_from`.
3. Zaktualizuj źródłowe CSV i odpowiadający im przegląd JSON. Nie przepisuj cen do funkcji; nie zgaduj pustych komórek, portu, progów gabarytu ani zakresu HEV/PHEV/FCEV.
4. Zapisz konflikty w `audit/rate_conflicts.csv`; konflikt nie blokuje pozostałych rekordów, ale jego stawka pozostaje niepotwierdzona.
5. Uruchom audyt i kontrolę pakietu:

   ```powershell
   node data/partner/RexBid_Calculator_V4_2026-10-04/tools/build-partner-rates.cjs --check
   node --test data/partner/RexBid_Calculator_V4_2026-10-04/tools/validate-package.test.cjs
   node scripts/build-calculator-v4-rates.cjs
   node scripts/build-calculator-v4-rates.cjs --check
   node --test tests/calculator-v4.test.cjs tests/transport-calculator-v2.test.cjs
   ```

6. Obejრივи diff starej i nowej wersji: liczba zmian lądowych, morskich, terminali, preferencji, mnożników, dopłat i statusów; zweryfikuj 610 lokalizacji, 24 stawki morskie oraz konflikty Albany.
7. Wersja runtime jest content-addressed i zmienia się po zmianie kwot, routingu/preferencji, klas/mnożników lub dopłat. Zachowaj poprzedni generated asset/rate set w historii Git, aby móc odtworzyć rollback bez edycji algorytmu.
8. Przeprowadź testy całości i staging QA, a następnie uzyskaj akceptację wersji danych. Generator nie wdraża cennika ani nie publikuje go samodzielnie.

Właściciel podał dopłatę 150 USD za potwierdzony BEV, raz na pojazd. Nie stosuj jej automatycznie do HEV/PHEV/FCEV. Stawki morskie są per vehicle. Mnożnik gabarytowy dotyczy wyłącznie lądu. Dla standardowego i ostrożnego wariantu używany jest ten sam preferowany terminal partnera; nie wybieraj najtańszej trasy samodzielnie.
