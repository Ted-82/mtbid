# Panel klienta i właściciela — próba lokalna

24 listopada 2026. **Pięć scenariuszy, 21 z 21 sprawdzeń zaliczonych** w Chrome 157.0.8103.51 na Windows, w oknie 1100 × 840 px.

| Sytuacja | Sprawdzony wynik |
| --- | --- |
| Klient otwiera odnośnik do rozmowy drugiej realizacji | Panel wyświetlił sesję klienta, uaktywnił właściwą realizację i przeniósł fokus do jej rozmowy. Kliknięcie pierwszej realizacji pokazało odpowiednią historię i usunęło poprzednią z widoku. [Rozmowa klienta](browser/portal-ui/klient-rozmowa.png) |
| Właściciel z potwierdzonym drugim składnikiem | Panel wyświetlił rolę właściciela i formularze obsługi. Po wybraniu drugiej sprawy otworzył jej rozmowę z polem odpowiedzi. [Rozmowa właściciela](browser/portal-ui/wlasciciel-rozmowa.png) |
| Klient otwiera administrację | Widoczna odmowa i odnośnik do własnego panelu. Przeglądarka wysłała zero żądań o realizacje. [Odmowa](browser/portal-ui/denied.png) |
| Właściciel czeka na drugi składnik | Po odpowiedzi z wymaganiem MFA panel zażądał weryfikacji. Przeglądarka wysłała zero żądań o realizacje. [Weryfikacja](browser/portal-ui/owner-mfa.png) |
| Wygasła sesja | Przy odświeżeniu otwartej sprawy odpowiedź 401 ukryła obszar pracy oraz wyczyściła z dokumentu listę i szczegóły. Wejście z odnośnika bez sesji pokazało logowanie z adresem powrotu do wskazanej rozmowy. [Wygaśnięcie](browser/portal-ui/klient-sesja-wygasla.png) |

Przeglądarka załadowała lokalne pliki stron, stylów i skryptów REXBID. Odpowiedzi API, dwie realizacje, treść rozmów i stan MFA pochodziły z fikcyjnego zestawu danych opracowanego na podstawie testów repozytorium. Obie role sprawdzono w odizolowanych profilach. Zarejestrowano zero zapisów i zero prób połączeń z usługami zewnętrznymi. [Wyniki każdego sprawdzenia i wykaz odczytów](browser/portal-ui/wyniki.json).

Próba potwierdza zachowanie interfejsu po wskazanych odpowiedziach API. Logowanie rzeczywistego użytkownika, weryfikacja kodu TOTP na serwerze, izolacja danych między kontami w produkcji i doręczenie powiadomień e-mail wymagają odrębnych dowodów.
