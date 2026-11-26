# Źródła zewnętrzne i benchmark — odczyt 04.10.2026

Źródła partnera/właściciela są odrębne od benchmarku konkurencji i oficjalnych przepisów. Poniższe linki nie potwierdzają kosztów handlowych Rex.Bid.

## BidCars
- https://bid.cars/pl/help/auction-process — FAQ wyjaśnia użycie kalkulatora na kartach, wpływ kursów walut i wyłączenia np. przelewów, kar oraz dodatkowych dokumentów. Nie przyjmować hasła „cena pod dom” jako dowodu pokrycia wszystkich kosztów.
- https://bid.cars/pl/lot/1-65823886/2027-Others-3-38911475 — przykład struktury modułów kalkulatora, oddzielne tryby prognozy/aktualnej oferty/szybkiego zakupu, pozycje kosztów i kraj odprawy. Treść oferty jest zmienna; nie używać jako aktualnej taryfy partnera.
- https://bid.cars/pl/lot/1-70505976/2021-Heart-Land-North-5SFNB2220ME452062 — analogiczne rozdzielenie kosztów, wartości celnej oraz kursów z datą. Nie jest przykładem samochodu osobowego ani potwierdzoną kwotą importu.
- Benchmark Honda CR-V LOT 45369972 pochodzi z dostarczonych screenshotów (references/ux/), nie z nowego pobrania tej oferty.

## Copart — harmonogram
- https://www.copart.com/lot/55645665/Photos/clean-title-2023-honda-civic-lx-tx-north-austin — sekcje „Regarding lots not assigned to an auction” oraz „About upcoming lots” wyjaśniają, że Upcoming lot i Future nie oznaczają przypisanego terminu. To ogólna dokumentacja w szablonie strony, nie dowód statusu dowolnego innego lotu.
- Status błędnego LOT 58307896 udokumentował właściciel w screenshotach. Bieżące dane mogą od tego czasu się zmienić; test regresyjny ma odwzorować ten stan, a nie wymuszać go na zawsze dla LOT.

## Podstawy importu
- https://taxation-customs.ec.europa.eu/taxable-amount_fr — Komisja Europejska: import VAT, art. 85–87, m.in. koszty pakowania i transportu, gdy nie są już w podstawie. Nie dodawać tych samych kosztów dwukrotnie.
- https://sede.agenciatributaria.gob.es/Sede/en_gb/aduanas/deuda-aduanera-garantias-elementos/valor-mercancia/valor-transaccion-ajustes-sobre-valor-transaccion.html — administracja podatkowa Hiszpanii: korekty wartości transakcyjnej, m.in. pakowanie materiały/praca; źródło urzędowe stosowania zasad unijnych, nie polska indywidualna interpretacja.
- https://www.podatki.gov.pl/akcyza/stawki-podatkowe — polskie MF: źródło weryfikacji właściwych stawek/klasyfikacji, z datą; sama strona nie zastępuje ustalenia prawnej klasy konkretnego auta i procedury importu.

Nie traktować screenów z podatkiem/akcyzą 0 jako reguły. Nie kopiować VAT Rotterdamu do importu PL ani automatycznie potwierdzać portu docelowego taryfy CargoLoop.
