# Wyceny REXBID i konkurencji — pomiar uzupełniający z 24 listopada 2026

**W 20 rzeczywistych ofertach REXBID z USA uzyskaliśmy 16 pełnych szacunków i 4 sumy częściowe. Dla 10 ofert Copart rozłożyliśmy opłatę aukcyjną na pozycje i zestawiliśmy je z oficjalną taryfą. Dla IAAI nadal brakuje potwierdzenia profilu rzeczywistego nabywcy.** Do reklamowania wiążącej ceny „pod dom” potrzebne jest jeszcze porównanie z faktycznym rozliczeniem brokera i odprawy. [Próba 20 aut, pola publicUS i calc](vehicle-extended-results.json)

## Ten sam samochód u konkurencji

- **Ford C-Max Hybrid, IAAI 46552401, VIN 1FADP5AU8DL509002.** W publicznie odczytanej kopii karty BidCars dla placu Buckhannon w Wirginii Zachodniej transport do portu kosztuje 610 USD. W konfiguracji REXBID dla dokładnie tego placu również widnieje 610 USD. BidCars przedstawia prowizję 450 USD plus VAT. REXBID ma stałą prowizję 2 500 zł brutto. Kopia strony ma pustą końcową sumę i cenę wejściową 0 USD. Brak podstaw, by przypisać tę sumę cenie Kup teraz. Wcześniejszy pomiar obejmował osiem kwot wyliczonych dla tego auta. [Ford w BidCars](https://bid.cars/pl/lot/0-46552401/2013-Ford-C-Max-1FADP5AU8DL509002) · [stawki REXBID](../../release/public-site/public/rexbid-delivered-rates.js) · [wcześniejsza próba](POJAZDY-WYCENY.md)
- **Toyota Tacoma Hybrid, IAAI 46557821.** Zachowany pomiar z 19 listopada przy 1 100 USD i dostawie do Warszawy daje 24 188,85 zł w REXBID i 26 784 zł w BidCars. Po odznaczeniu dopłaty gabarytowej 800 USD w BidCars wychodzi 23 570 zł. Sam wybór wariantu zmienia kolejność cen. Należy potwierdzić taryfę przewoźnika dla faktycznych wymiarów Toyoty. [Toyota w BidCars](https://bid.cars/pl/lot/0-46557821/2026-Toyota-Tacoma-Hybrid-3TYLC5LN6TT064414) · [pomiar](POJAZDY-WYCENY.md)
- **DreamBid.** Odczytana publiczna wersja kalkulatora ma 67 786 zł dla domyślnych **10 000 CAD**, placu Abbotsford w Kanadzie i transportu przez Toronto oraz Rotterdam. W przykładzie prowizja wynosi 2 460 zł, a sama usługa jest opisana jako 1 999 zł netto. DreamBid osobno opisuje akcyzę po dostawie i wprost wyłącza ją z podanych przykładowych kosztów popularnych modeli. Przykład kanadyjski nie jest wyceną żadnego z 20 amerykańskich VIN. Ze starszej publicznej listy DreamBid sprawdziliśmy także Chevrolet Silverado 43870078 i Nissan Rogue 45898234. Dzisiejsza publiczna wyszukiwarka REXBID zwróciła dla obu VIN po zero wyników. Dwutygodniowa różnica dat odczytu i zakres katalogu uniemożliwiają wnioskowanie, że te aukcje powinny nadal być aktywne. [Kalkulator DreamBid](https://dreambid.pl/pl/calculator) · [katalog DreamBid](https://dreambid.pl/pl/lots) · [wyszukiwarka Chevrolet](https://rexbid.pl/api/cars?view=cards&per_page=20&s=1GCPABEKXPZ316058) · [wyszukiwarka Nissan](https://rexbid.pl/api/cars?view=cards&per_page=20&s=5N1AT2MV9EC855262)

Chrome o 21:09 czasu polskiego otrzymał HTTP 403 przy otwarciu rzeczywistej karty Forda w BidCars oraz kalkulatora DreamBid. Obie strony zwróciły ekran pośredni bez pól wyceny. Publicznie dostępne kopie odpowiadają stanowi sprzed kilku dni. Wynik dzisiejszych **nowych interaktywnych porównań obu kalkulatorów dla identycznych aut to 0/20**. [Czas prób, adresy i wyniki](konkurencja-dostep-kontynuacja.json)

## Sprawdzenie opłat aukcyjnych na rzeczywistych kwotach

REXBID przyjmuje określony wariant Copart w USA. Jest to Preferred, dokument non-clean, płatność zabezpieczona, licytacja Live oraz odbiór dokumentu osobiście. Każdy poniższy rachunek zawiera 95 USD za wydanie auta, 15 USD opłaty środowiskowej oraz 20 USD za odbiór dokumentu, razem 130 USD ponad opłatę nabywcy i Live Bid. Przy wysłaniu dokumentów Copart wycenia je inaczej. Kwalifikacja brokera, kod dokumentu danego samochodu i sposób wydania wymagają potwierdzenia przed transakcją. [Oficjalny cennik Copart z kategoriami i opcjami dokumentów](https://www.copart.com/content/us/en/member-fees-us-licensed-more)

| Copart LOT | Zakup USD | Nabywca USD | Live USD | Razem z 130 USD | REXBID USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| 65196656 | 1 | 1 | 0 | 131 | 131 |
| 67417266 | 500 | 145 | 65* | 340 | 340 |
| 71209046 | 1 100 | 250 | 85 | 465 | 465 |
| 73751796 | 2 000 | 390 | 110* | 630 | 630 |
| 56535586, 75080916 | 4 999 | 625 | 125 | 880 | 880 |
| 68853036, 51101386 | 5 000 | 650 | 125 | 905 | 905 |
| 54168076 | 15 000 | 900 | 160 | 1 190 | 1 190 |
| 56529686 | 100 000 | 6 000 | 160 | 6 290 | 6 290 |

\* Copart drukuje wspólne końce dwóch przedziałów Live. Dla dokładnie 500 i 2 000 USD model wybiera wyższy z sąsiadujących progów. Osiem pozostałych aut ma jednoznaczną stawkę Live w tabeli. Są to obliczenia dla wybranego profilu. Zakres całej wyceny dodatkowo zależy od transportu, dokumentów, odprawy i kursu. [Wyniki ofert REXBID](vehicle-extended-results.json)

**IAAI.** Obecna wersja REXBID stosuje uzgodniony model porównawczy oparty na progach Copart i korekcie 40 USD. IAA USA udostępnia właściwy kalkulator opłat zalogowanemu nabywcy na konkretnej karcie. Przeniesienie publicznej tabeli IAA Kanada do amerykańskich samochodów dałoby niewłaściwy punkt odniesienia. Do potwierdzenia wystarczy na początek zanonimizowane rozliczenie właściwego konta i LOT, z metodą zakupu, pozycjami opłat i walutą. [IAA USA — działanie kalkulatora](https://www.iaai.com/us/marketing/Buying-services) · [cennik rynku kanadyjskiego](https://ca.iaai.com/Content/Documents/IAA_AuctionFees_EN.pdf)

**Decyzja produktowa.** Wycenę dla klienta warto rozbić na płatne do dostawy, akcyzę w Polsce i pozostałe koszty poza zakresem. Przy nadwoziach z możliwą dopłatą gabarytową pokazać jej status, przy sumie częściowej nazwać brakujący składnik, przy taryfie IAAI pozostawić jawnie podpisany szacunek. Nie ma podstaw do zmiany prowizji ani zapowiedzi, że REXBID zawsze jest tańszy.
