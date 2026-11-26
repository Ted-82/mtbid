# Import historii — odczyt kontrolny w batchu, 20.10.2026

Zakres: wyłącznie lokalna optymalizacja `scripts/targeted-history-import.cjs`.

- Odczyt wydarzeń po zapisie oraz potwierdzenia pobrania jest częścią tego samego batcha D1 co zapis, jeśli całość mieści się w 250 instrukcjach.
- Wszystkie wcześniejsze sprawdzenia przed zapisem pozostają. Odczyt końcowy nadal sprawdza fingerprint, status, cursor i dokładny czas receipt; dodatkowo jawnie porównuje tożsamość każdego zwróconego wydarzenia oraz liczbę wyników.
- Zapytania `IN` mają najwyżej 100 parametrów, zgodnie z [limitem D1 na zapytanie](https://developers.cloudflare.com/d1/platform/limits/). Limit dotyczy również pojedynczych instrukcji wewnątrz batcha.
- **Zachowano fallback dla większej historii:** 245 wydarzeń wraz z receipt i odczytem mieści się dokładnie w 250 instrukcjach. Dla 246–249 wydarzeń zapis nadal jest jednym batchiem, a końcowy odczyt jest oddzielny, jak wcześniej. Nie podniesiono limitu operatora ani nie rozszerzono wcześniejszej obsługi ponad 249 wydarzeń w jednym zapisie.
- Pusta historia nadal wymaga prawidłowego receipt. Brak końca paginacji i wymuszona niekompletność pozostają stanem częściowym.
- Błąd instrukcji SQL wewnątrz połączonego batcha wycofuje transakcję. Błąd porównania już otrzymanych wyników zatrzymuje importer; sam w sobie nie cofa zatwierdzonej transakcji.

## Lokalna weryfikacja

89/89 testów PASS w pięciu plikach:

- `targeted-history-batch-readback.test.cjs` — 10 nowych testów;
- `bounded-history-enrichment.test.cjs`;
- `owner-price-regression.test.cjs`;
- `catalog-refresh-campaign.test.cjs`;
- `catalog-improvement-campaign-20261020.test.cjs`.

Nowe regresje sprawdzają 201 wydarzeń w chunkach 100/100/1, granice 245 i 249, fallback, błędne/missing/duplikowane wyniki, wszystkie pola tożsamości i receipt, konflikt przed zapisem, odrzucenie starszego zapisu oraz rollback przy błędzie końcowego SELECT.

Pierwsze uruchomienie w sandboxie Windows miało błędy `EPERM` przy atomowym rename/utworzeniu plików testowych. Ponowienie tych samych testów poza ograniczeniem sandboxa przeszło; nie zmieniano ACL, cache, uwierzytelniania ani asercji bezpieczeństwa.

Nie wykonano zdalnych odczytów D1, wywołań Apibara, wdrożenia ani commita w ramach tej zmiany. Redukcja liczby zdalnych round tripów jest potwierdzona przez test wywołań: dla 1–100 wydarzeń oszczędza dwa końcowe żądania; nie jest to pomiar czasu działania produkcji.
