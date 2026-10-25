# Evidencija radnog vremena – stanje projekta (23.10.2026.)

Sažetak za nastavak rada u novom razgovoru. Uz ovu datoteku priložiti **evidencija-razvoj.zip** (aplikacija + skripta za demo).

## Namjena
Web aplikacija (prilagođena mobitelu) za evidenciju radnog vremena radnika građevinske tvrtke na gradilištima. Oko 6 administratora i 25+ radnika. Sučelje i sve poruke na hrvatskom.

## Arhitektura
- **Node.js ≥ 18, bez ovisnosti** (osim neobaveznog `nodemailer` za e-mail). `server.js` (HTTP, rute `R(metoda, putanja, razina, fn)`; razina 0 = javno, 1 = prijavljen, 2 = administrator), `core.js` (poslovna pravila, dijeli ga server i preglednik kao `window.Core`; izvještaji, xlsx, PDF), `public/index.html` (cijelo sučelje, vanilla JS), `public/logo.png`.
- Podaci: **jedna datoteka `data/db.json`**. Lozinke scrypt, potpisani HttpOnly kolačić (30 dana), zaštita od pogađanja lozinke (5 pokušaja / 15 min, po IP-u; iza Cloudflare Tunnela koristi `CF-Connecting-IP`).
- **Podaci se uvijek nasljeđuju**: `DATA_VERSION` (trenutno **8**) + `MIGRATIONS` u `server.js`; kopija u `data/backup` pri svakom pokretanju i prije migracije; starija verzija odbija novije podatke. Nikad ne brisati ni preimenovati postojeća polja – samo dodati migraciju.
- `nadogradnja.ps1` (Windows: zaustavi zadatak, kopija u `C:\evidencija-backup\DATUM`, kopira nove datoteke bez mape `data`, pokrene), `reset-admin.js` (nova lozinka bez brisanja podataka).
- Demo za isprobavanje (bez servera, podaci u pregledniku): `razvoj/build-demo.py <mapa evidencija> <izlaz.html>` – objavljen kao artifact.

## Postavljeno kod korisnika
- Dell OptiPlex 7080 Micro, **Windows Server 2025**, aplikacija u `C:\evidencija`, pokreće je Planer zadataka (zadatak `EvidencijaSati`, korisnik SYSTEM, pri pokretanju računala).
- Javno preko **Cloudflare Tunnela** (cloudflared kao usluga → `http://localhost:3000`), bez otvorenih portova. Mreža: T-Com Fritzbox (optika) → UniFi Dream Machine SE.
- E-mail: tvrtkina domena `tid-intel.hr`, pošiljatelj `sihterica@tid-intel.hr`; SMTP se upisuje u aplikaciji (Postavke). Slanje na vanjske adrese (npr. Gmail) radi (potvrđeno 23.10.2026.).
- Nadogradnja: `powershell -ExecutionPolicy Bypass -File C:\evidencija\nadogradnja.ps1 -Zip "...\evidencija.zip"`.
- **Nadogradnje radi Claude** (od 23.10.2026.): kod je u GitHub repozitoriju `sinedr2108/evidencija` (javni, mapa `data` nikad ne ide gore). Na serveru radi `claude remote-control` u `C:\evidencija` (prozor PowerShell Admin mora ostati otvoren). Postupak: izmjena → push na `main` → na serveru `git clone` u TEMP, `git archive` zip bez `razvoj` → `nadogradnja.ps1 -Zip`. Denis potvrđuje upisom „da, nadogradi” u razgovoru. Upute: `upute/priprema-servera.md`. Server je 23.10.2026. nadograđen s verzije podataka 2 na 5.

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
- Radnik – **početna** (od 25.10.2026.): obavijesti/odluke/poruke, gumb s pismom, gumb "?" (upute) i tri grupe: OTPREMNICE (fotografiraj i pošalji), EVIDENCIJA RADNOG VREMENA (stranica `ev`), ALAT (u izradi).
- Radnik – EVIDENCIJA RADNOG VREMENA (bivša početna): fond, sati za slobodan dan, 4 gumba: ŠIHTERICA (plava), GODIŠNJI (ljubičasta), SLOBODNI DAN (žuta), IZVJEŠTAJI (zelena); gumb "?" dolje desno = **upute za radnike** (odjeljak `p-up` u index.html).
- Kalendar u ŠIHTERICI: crveno = radni dan bez unosa, zelena točka = ima unos, žuto S = slobodan dan, ljubičasto G = godišnji, podcrtano = praznik.
- IZVJEŠTAJI radnika: mjesec/godina, kartice, **Spremi kao PDF**.
- Administrator – **početna** (od 25.10.2026.): zahtjevi na čekanju, gumb Postavke gore (uz Lozinka, Odjava) i tri grupe: OTPREMNICE (`aot`), EVIDENCIJA RADNOG VREMENA (`aev`), ALAT (`aal`, u izradi). U EVIDENCIJI gumbi IZVJEŠTAJI, SLOBODNI DANI, GODIŠNJI ODMOR (crvena), GRADILIŠTA, OBAVIJESTI RADNICIMA, ODOBRENI ZAHTJEVI, STATISTIKA, TOPLI OBROK. Svaka podstranica ima kućicu za povratak; logo na vrhu.
- **Automatsko osvježavanje** (od 23.10.2026.): preglednik svakih 10 s pita `/api/rev` (broj izmjene, samo u memoriji servera, raste pri svakom `save()`) i ponovno učitava podatke kad se promijeni; ne osvježava dok se upisuje tekst ili je otvoren dijalog.
- Admin IZVJEŠTAJI: *Ukupno sati po danu* i *Svi unosi u mjesecu* skriveni, otvaraju se gumbima pod **Detaljni pregledi** s vlastitim filterima (od/do datuma, radnik, gradilište, vrsta, topli obrok).
- **Pošta radnika** (verzija podataka 6): gumb s pismom gore na početnoj radnika (crveni broj = nepročitano) → poruke, obavijesti i poslani zahtjevi sa statusom, najnovije na vrhu; ručno brisanje ✕ i automatsko čišćenje početkom mjeseca (ostaje 5). Samo se skriva radniku (`inboxDel`, `inboxCleaned`), zapisi ostaju.
- **OTPREMNICE** (verzija podataka 7): radnik fotografira (do 10 fotografija), gradilište + datum + napomena; fotografije su datoteke u `data/otpremnice` (smanjene u pregledniku, svaka < 1 MB jer server odbija veće zahtjeve), zapis u `db.otpremnice`. Admin stranica OTPREMNICE (filteri mjesec/radnik/gradilište, preuzimanje, brisanje). `nadogradnja.ps1` izuzima `data\otpremnice` iz kopije – **te fotografije trebaju zasebnu sigurnosnu kopiju**.
- **Aktivnosti radnika / obavijesti u Windowsima** (bez promjene podataka): server bilježi uspješne radnje radnika u memoriju (`AKT` tablica u server.js po ruti, `pre`/`f`, zadnjih 300, `BOOT` id), admin dohvaća `/api/aktivnost?b=&s=` svakih 10 s (i u pozadini) i prikazuje `Notification` (Notification API, treba sigurnu vezu: Cloudflare https ili localhost). Stranica `akt` (gumb zvona `#akb` s brojačem), uključivanje i prijave po pregledniku (localStorage `akOn`, `akPr`).
- **Otpremnice – administrator** (v8): prikaz po fotografiji u A4 okviru; filteri datum od–do + višestruko gradilište i poslao; izmjena gradilišta po fotografiji (`adminSite[f]`), ručno upisana gradilišta samo u `otpSites`; pitanja radniku (`pitanja`, obavijest) i odgovori; radnik može odabrati „Odluka administratora” (site prazan). Radnik u Poslanim otpremnicama otvara fotografiju u A4 portret pregledniku (`#otv`, strelice, Puna veličina; auto osvježavanje čeka dok je otvoren).
- Filter radnika: aktivni / svi (i izbrisani). Nove opcije toplog obroka velikim slovima.

## Dogovoreni način rada
- Kod svake nadogradnje ažurirati **upute za radnike** (i datum u njima) i README.
- Nakon izmjene: testirati, izraditi demo (`build-demo.py`) i objaviti ga, poslati novi `evidencija.zip`.
- Odgovori na hrvatskom.
