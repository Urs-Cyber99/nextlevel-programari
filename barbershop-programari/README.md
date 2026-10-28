# Next Level Barbershop · Programări online

Aplicație de programări pentru frizerie: pagina clienților, panou de administrare și SMS automat (confirmare + reminder cu o zi înainte).
Rulează pe **Netlify** (gratuit pentru volumul unui salon), cu codul pe **GitHub**. Datele stau în Netlify Blobs, nu e nevoie de bază de date separată.

## Ce face

**Pentru clienți** (`/`)
- Alege serviciul (cu prețuri și durate), frizerul sau „Oricine e liber”, ziua și ora (luni–sâmbătă, 09–18).
- Vede doar orele libere ale frizerului ales; două persoane nu pot lua aceeași oră.
- Primește SMS de confirmare imediat și **reminder cu o zi înainte la ora 10:00**, ambele cu link de anulare.
- Poate anula singur din link până cu 2 ore înainte; ora se eliberează automat.
- „Adaugă în calendar” (iPhone / Android), secțiune cu echipa, galerie, prețuri, adresă și hartă.
- Protecții: telefon valid obligatoriu, acord GDPR, max. 3 programări active pe număr, o programare pe zi pe număr, capcană anti-roboți.

**Pentru salon** (`/admin`, cu parolă)
- Calendar pe zi cu câte o coloană pe frizer (sau listă, pe telefon). Se actualizează singur la 1 minut și anunță programările noi.
- Click pe un spațiu liber = programare nouă (telefonică sau walk-in). Click pe o programare = sună / WhatsApp / „A venit” / „Nu a venit” / Mută / Anulează.
- Blocare intervale: pauză de masă, zi liberă, concediu pe mai multe zile, pentru un frizer sau tot salonul.
- Clienți: istoric vizite, neprezentări, anulări, notițe, blocare pentru cei care nu vin. Export CSV.
- Rapoarte pe perioadă: programări, încasări estimate, rata de neprezentare, pe fiecare frizer, cele mai cerute servicii. Export CSV (se deschide în Excel).
- Setări: date salon, program, zilele de lucru ale fiecărui frizer, servicii și prețuri, texte SMS, SMS de test, notificare SMS către frizer la fiecare programare nouă (opțional).

## Punere online (o singură dată, ~20 minute)

1. **GitHub**: creează un repo nou (ex. `nextlevel-programari`) și urcă tot conținutul acestui folder.
2. **Netlify**: *Add new project → Import an existing project → GitHub* → alege repo-ul. Setările de build se iau automat din `netlify.toml`.
3. **Variabile** (Netlify → Project configuration → Environment variables):
   | Nume | Valoare |
   |---|---|
   | `ADMIN_PASSWORD` | parola pentru panoul de admin (alege una lungă) |
   | `SMSLINK_CONNECTION_ID` | din contul SMSLink |
   | `SMSLINK_PASSWORD` | din contul SMSLink |
   După ce le adaugi, fă un *Trigger deploy* ca să fie preluate.
4. **SMSLink**: cont pe smslink.ro → *SMS Gateway → Configuration & Settings* → creează o conexiune; primești Connection ID și Password. Încarcă credit (plată în lei).
5. Deschide `https://<site>.netlify.app/admin`, intră cu parola, verifică Setările și trimite un **SMS de test** din pagina Setări.
6. Opțional: domeniu propriu (ex. `programari.nextlevel.ro`) din Netlify → Domain management.

Unde pui linkul: bio Instagram, profilul Google Maps (câmpul „Programări”), Facebook, QR pe ușă și la casă.

## Reminderul SMS

`netlify/functions/reminders.mjs` rulează automat în fiecare oră; la ora 10:00 (ora României) trimite reminder tuturor programărilor de **mâine** care nu l-au primit. Cine se programează după ora 10 pentru a doua zi primește doar confirmarea (ar fi două SMS-uri la rând). Dacă un SMS eșuează, se reîncearcă la orele următoare (max. 3 încercări).

SMS-urile se trimit fără diacritice: așa încap 160 de caractere într-un singur SMS (cu diacritice ar fi doar 70 și ar costa dublu). Pagina de Setări arată câte SMS-uri face fiecare text.

## Test local (fără internet / fără Netlify)

```bash
npm test                                                     # 16 teste cap-coadă (rezervări, suprapuneri, anulare, admin, reminder)
MOCK_STORE=1 ADMIN_PASSWORD=test node test/dev-server.mjs    # http://localhost:8888 și /admin (parola: test), cu programări demo
```

## Structură

```
public/            index.html (clienți) · admin.html · anulare.html · img/
netlify/functions/ api.mjs (toate rutele /api/*) · reminders.mjs (programat)
netlify/lib/       core.mjs (reguli, disponibilitate, setări implicite) · sms.mjs · store.mjs · reminders.mjs
test/              test.mjs · dev-server.mjs
```

Pozele din `public/img/salon-*` și `post-*` au watermark Notino; înlocuiește-le cu originalele (aceleași nume de fișiere) când le ai.
