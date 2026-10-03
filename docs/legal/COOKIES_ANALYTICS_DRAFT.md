# Cookies i analityka Rex.Bid

**DRAFT — REQUIRES OWNER/LEGAL REVIEW**

Obecny kod używa niezbędnych cookies host-only do sesji BFF i krótkotrwałego stanu PKCE. Gościnne ulubione oraz ograniczony cache działają w localStorage. Tokeny nie powinny trafiać do browser storage. Zewnętrzny dostawca analytics nie jest podłączony; istnieją wyłącznie neutralne nazwy eventów jako przyszły kontrakt.

Przed publikacją należy zweryfikować kompletny spis cookies/storage w przeglądarce, cel, czas życia, podstawę/zgodę, treść banera jeśli wymagany, dostawców oraz retencję. Nie deklarować używania analytics, których nie ma.
