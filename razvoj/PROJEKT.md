# Evidencija radnog vremena – stanje projekta (23.10.2026.)

Sažetak za nastavak rada u novom razgovoru. Uz ovu datoteku priložiti **evidencija-razvoj.zip** (aplikacija + skripta za demo).

## Namjena
Web aplikacija (prilagođena mobitelu) za evidenciju radnog vremena radnika građevinske tvrtke na gradilištima. Oko 6 administratora i 25+ radnika. Sučelje i sve poruke na hrvatskom.

## Arhitektura
- **Node.js ≥ 18, bez ovisnosti** (osim neobaveznog `nodemailer` za e-mail). `server.js` (HTTP, rute `R(metoda, putanja, razina, fn)`; razina 0 = javno, 1 = prijavljen, 2 = administrator), `core.js` (poslovna pravila, dijeli ga server i preglednik kao `window.Core`; izvještaji, xlsx, PDF), `public/index.html` (cijelo sučelje, vanilla JS), `public/logo.png`.
- Podaci: **jedna datoteka `data/db.json`**. Lozinke scrypt, potpisani HttpOnly kolačić (30 dana), zaštita od pogađanja lozinke (5 pokušaja / 15 min, po IP-u; iza Cloudflare Tunnela koristi `CF-Connecting-IP`).
- **Podaci se uvijek nasljeđuju**: `DATA_VERSION` (trenutno **5**) + `MIGRATIONS` u `server.js`; kopija u `data/backup` pri svakom pokretanju i prije migracije; starija verzija odbija novije podatke. Nikad ne brisati ni preimenovati postojeća polja – samo dodati migraciju.
- `nadogradnja.ps1` (Windows: zaustavi zadatak, kopija u `C:\evidencija-backup\DATUM`, kopira nove datoteke bez mape `data`, pokrene), `reset-admin.js` (nova lozinka bez brisanja podataka).
- Demo za isprobavanje (bez servera, podaci u pregledniku): `razvoj/build-demo.py <mapa evidencija> <izlaz.html>` – objavljen kao artifact.

## Postavljeno kod korisnika
- Dell OptiPlex 7080 Micro, **Windows Server 2025**, aplikacija u `C:\evidencija`, pokreće je Planer zadataka (zadatak `EvidencijaSati`, korisnik SYSTEM, pri pokretanju računala).
- Javno preko **Cloudflare Tunnela** (cloudflared kao usluga → `http://localhost:3000`), bez otvorenih portova. Mreža: T-Com Fritzbox (optika) → UniFi Dream Machine SE.
- E-mail: tvrtkina domena `tid-intel.hr`, pošiljatelj `sihterica@tid-intel.hr`; SMTP se upisuje u aplikaciji (Postavke). Slanje na vanjske adrese (npr. Gmail) radi (potvrđeno 23.10.2026.).
- Nadogradnja: `powershell -ExecutionPolicy Bypass -File C:\evidencija\nadogradnja.ps1 -Zip "...\evidencija.zip"`.

## Pravila poslovanja (najvažnija)
- Vrste upisa: Redovan rad, Bolovanje, Godišnji odmor, Slobodan dan, Praznik, Rad na praznik. Bolovanje/godišnji/praznik = 8 h, slobodan dan = 0 h. Praznik i Rad na praznik samo na državni praznik RH (uklj. Uskrs/Tijelovo). Rad se ne upisuje za budućnost.
- Topli obrok obavezan za Redovan rad i Rad na praznik, jednom dnevno. Gradilište samo s administratorova popisa (radnik šalje **zahtjev za novo gradilište**; administrator dodaje ili odbija; radnici dobivaju obavijest pri prvom sljedećem otvaranju aplikacije).
- Fond sati = radni dani (pon–pet, praznici uključeni) × 8.
- Sati za slobodan dan: od nule svaki mjesec + prijenos (upisuje admin); +1 h za svaki dan s ≥ 9 h; slobodan dan sam od ≥ 8 h (−8 h), inače zahtjev administratoru.
- Godišnji odmor: ukupno i početno stanje upisuje admin; radnik šalje zahtjev (raspon, samo radni dani); admin može odobriti i grupi bez zahtjeva.
- **Prekovremeni**: iznad 9 h pon–čet, iznad 8 h petkom, svi sati sub/ned, svi sati Rada na praznik. Za prošli/završen mjesec manjak do fonda prenosi se iz prekovremenih u redovan rad (stupac "Preneseno u redovan rad").
- Završi unos: svi radni dani moraju imati unos; nakon toga izmjene samo uz zahtjev za ponovno otvaranje.
- Zahtjevi (slobodan dan, godišnji, otvaranje mjeseca, novo gradilište): radnik može odustati dok čekaju; admin može izmijeniti odluku (ne nakon datuma događaja); bilježi se tko je odlučio i kada te je li radnik vidio (viđeno = otvaranje početne stranice). Odluke na početnim stranicama do kraja dana događaja; sve na stranici ODOBRENI ZAHTJEVI.
- Korisnici: izmjena podataka, onemogućavanje prijave, brisanje (logičko), trajno brisanje (ime i podaci ostaju u evidenciji), slanje login podataka e-mailom (generira novu lozinku).
- Poruke administratora radnicima (pojedinačno/odabranima/svima), ostaju dok radnik ne potvrdi čitanje; admin vidi tko je i kada pročitao.

## Sučelje
- Radnik – početna: fond, sati za slobodan dan, obavijesti/odluke/poruke, 4 gumba: ŠIHTERICA (plava), GODIŠNJI (ljubičasta), SLOBODNI DAN (žuta), IZVJEŠTAJI (zelena); gumb "?" dolje desno = **upute za radnike** (odjeljak `p-up` u index.html).
- Kalendar u ŠIHTERICI: crveno = radni dan bez unosa, zelena točka = ima unos, žuto S = slobodan dan, ljubičasto G = godišnji, podcrtano = praznik.
- IZVJEŠTAJI radnika: mjesec/godina, kartice, **Spremi kao PDF**.
- Administrator – početna: zahtjevi na čekanju + gumbi IZVJEŠTAJI, SLOBODNI DANI, GODIŠNJI ODMOR (crvena), GRADILIŠTA, OBAVIJESTI RADNICIMA, ODOBRENI ZAHTJEVI, STATISTIKA, TOPLI OBROK, POSTAVKE. Svaka podstranica ima kućicu za povratak; logo na vrhu.
- Filter radnika: aktivni / svi (i izbrisani). Nove opcije toplog obroka velikim slovima.

## Dogovoreni način rada
- Kod svake nadogradnje ažurirati **upute za radnike** (i datum u njima) i README.
- Nakon izmjene: testirati, izraditi demo (`build-demo.py`) i objaviti ga, poslati novi `evidencija.zip`.
- Odgovori na hrvatskom.
