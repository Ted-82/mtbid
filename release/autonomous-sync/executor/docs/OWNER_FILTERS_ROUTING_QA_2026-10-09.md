# Uwagi właściciela — filtry, napęd, terminal i kontakt, 09.10.2026

> Późniejsze sprawdzenie źródła z9.10 potwierdziło **4839 IAAI Timed** i rzeczywiste oferty Polestar. Poniższa ocena braku tych ofert dotyczyła wyłącznie ówczesnej częściowej D1. Nowe dane i poprawki: [QA pokrycia katalogu](CATALOG_COVERAGE_QA_2026-10-09.md), staging6c7d016d. Nie interpretować pustej lokalnej kategorii jako braku takich aukcji u providera.

## Wynik
Staging: https://rexbid-auth-test.tedn828.workers.dev
Version ID: `3e8a742c-a013-46b7-b5df-a32f26740a0d`.
Poprzednia wersja przed etapem: `5055ed90-8461-4914-85d8-7dbebbf9a428`.
Produkcja, DNS, konta, MFA i portal bez zmian. Brak migracji i nowych requestów Apibara; licznik naszych prób nadal 1754, historyczny STOP 56 zachowany.

## Przyczyny i poprawki
- Metadane D1 wybierały tylko markę/model/rok/stan/status. Dodano rzeczywiste opcje paliwa, skrzyni, napędu, stanu pracy, nadwozia, uszkodzeń i sprzedawcy oraz filtrowanie przed paginacją.
- Adapter pomijał `vehicle_description` IAAI. Dodano źródłowe pola bez zgadywania po nazwie auta.
- Z zachowanych odpowiedzi, po kontroli VIN/platforma/LOT, uzupełniono tylko puste pola 163 ofert: napęd 131, skrzynia 29, nadwozie 11. Ceny, statusy, daty obserwacji i wszystkie pozostałe kolumny niezmienione.
- Napęd jest znany dla 1274/1638 aut (Copart 516/840, IAAI 758/798). Pozostałe 364 nadal mają brak danych; dostępne odpowiedzi nie pozwoliły ich wiarygodnie uzupełnić.
- Rok od/do ma listy wyboru. Marka nadal przyjmuje dowolny tekst; Polestar i kilka innych marek spoza zbioru mają podpowiedź o braku zapisanych ofert. Polestar: 0 rekordów, nie błąd wyszukiwania.
- Dodano konserwatywne grupy Samochody, Motocykle, ATV/quady według potwierdzonego nadwozia. Nieznane oznaczenia nie są zgadywane. Faktyczny parametr API to `type`, zgodny z frontendem; `vehicle_type` nie jest obsługiwanym parametrem.
- Preferowany terminal pochodzi z danych partnera V4. Jednoznaczna platforma + oddział + stan pozwala dopasować lokalizację przy braku ZIP; niejednoznaczność nadal blokuje zgadywanie. Usunięto pusty Oddział z bloku wysyłki.
- RCC nie jest uznawany za ubezpieczyciela ani zweryfikowaną firmę. Typ nieustalony pokazano czytelnie, kod zachowano w szczegółach. Zielony Insurance oznacza źródłowy typ, nie gwarancję stanu pojazdu.
- Kontakt wymaga imienia, adresu e-mail i wiadomości. Nadal tylko lokalnie przygotowuje treść: wysłanie następuje w programie pocztowym użytkownika. Nie tworzy rozmowy w panelu; odpowiedź identyfikuje adres nadawcy i treść zapytania.

## Rzeczywiste QA
- Desktop/mobile: metadane filtrów, Diesel, Benzyna, Hybryda, zakres roku i aktywne filtry; brak poziomego przepełnienia w sprawdzonym widoku 390 px. Motocykle: 5 wyników; ATV: 1 wynik, potwierdzony również normalnymi kliknięciami na telefonie.
- Health/ready/filters HTTP 200; VIN i LOT po 1 prawidłowym wyniku. Detail trzech poniższych kart HTTP 200, źródło D1.
- Tesla IAAI 46117338: Long Island NY → Elizabeth NJ, AWD, galeria/lightbox działają; Kup teraz 9050 USD, brak aktualnej kwoty pozostaje brakiem.
- Honda IAAI 44593083: Progressive Casualty Insurance, zielona etykieta; Philadelphia → Elizabeth, aktualna oferta 25 USD / Kup teraz 2000 USD zachowane.
- Tesla Copart 57660876: Baltimore East → Elizabeth, Geico i kalkulator działają. Znany transport BEV 1055 USD dla 4 aut; stawki partnera niezmienione.
- Kontrolny rachunek Tesla 46117338 po wybraniu klasy SUV standard i Kup teraz: ląd 295 + morze 575 + BEV 150 = 1020 USD. Znane składniki z ceną auta: 10070 USD. Brak opłat aukcyjnych/podatków/portu/brokera/PL: wynik nie jest pełną ceną pod dom.
- Timed: 24 zapisane pozycje, w tym 20 z upłyniętym terminem i 4 zakończone. Brak potwierdzonych aktualnych ofert; pusty stan jest prawidłowy. Nie zmieniono dat na potrzeby pokazu.
- Kontakt: wymagalność danych i lokalne przygotowanie testowej treści PASS; żadnej wiadomości nie wysłano.
- Licznik rezerwacji providera przed/po QA 291/291, nowe wywołania providera 0.

## Bezpieczeństwo i testy
Sprawdzony zaszyfrowany backup stagingowej D1 przed zapisami: SHA256 eksportu `7555d7599fdcccfaf7be9c441b46e6c5454a5090e05362af8f5caf448a00f1b3`. Kopia poza Git; lokalne odszyfrowanie i porównanie hash PASS, drugi komputer nieweryfikowany. 18 chronionych tabel bez zmian, FK 0; nie zmieniano cen, obserwacji ani historii.

882/882 repo i 14/14 partner PASS. Generatory V4/legacy/pakietu partnera --check PASS; trzy walidatory konfiguracji PASS; składnia 158 JS i 5 inline PASS; staging dry-run i git diff --check PASS.

## Dowody i ograniczenia
Screeny desktop/mobile oraz audyt pól znajdują się lokalnie w `C:\Users\nowic\Documents\Codex\REXBID_OWNER_FILTERS_20261009`. Panel/MFA nie były ponownie testowane ręcznie — zachowanie danych potwierdzono porównaniem tabel, bez zmiany uwierzytelnienia. Dane katalogu są częściowe; nie pobierano nowych ofert ani nie deklarowano świeżości starszych obserwacji. Publikacja i etap prawny pozostają odłożone.

Do przeglądu: https://rexbid-auth-test.tedn828.workers.dev/?catalog=1 oraz https://rexbid-auth-test.tedn828.workers.dev/car.html?lot=46117338&platform=iaai . Nie jest potrzebna nowa konfiguracja właściciela do tego etapu.
