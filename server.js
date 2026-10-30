'use strict';
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path'),Push=require('./push.js');
/* Iza Cloudflare Tunnela svi zahtjevi dolaze s localhosta; pravu adresu klijenta vjerujemo samo u tom slučaju. */
const clientIp=req=>{const a=req.socket.remoteAddress||'';return /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(a)&&req.headers['cf-connecting-ip']?String(req.headers['cf-connecting-ip']).slice(0,64):a};
const PORT=+process.env.PORT||3000,DIR=path.join(__dirname,'data'),DB=path.join(DIR,'db.json');
fs.mkdirSync(DIR,{recursive:true});
const db=fs.existsSync(DB)?JSON.parse(fs.readFileSync(DB,'utf8')):{users:[],entries:[],closed:[],sites:[],meals:['Vlastiti trošak','Restoran 1','Restoran 2','Restoran 3','Ostali restorani'],secret:crypto.randomBytes(32).toString('hex')};
/* rev: broj izmjene podataka (samo u memoriji); preglednici ga povremeno provjeravaju i osvježe prikaz kad se promijeni */
let rev=Date.now();
const save=()=>{fs.writeFileSync(DB+'.tmp',JSON.stringify(db));fs.renameSync(DB+'.tmp',DB);rev++};
/* ===== Podaci se nasljeđuju iz svake prethodne verzije =====
   db.version je verzija oblika podataka. Nova verzija aplikacije nikad ne briše ni ne preimenuje postojeće podatke,
   nego ih po potrebi nadogradi kroz MIGRATIONS (svaka se izvodi točno jednom, redom). Prije svake nadogradnje
   i pri svakom pokretanju sprema se kopija u data/backup. Starija verzija aplikacije odbija raditi s novijim podacima. */
const DATA_VERSION=15;
const MIGRATIONS={
  1:d=>{ /* početna verzija: osiguraj sve zbirke koje su dodavane tijekom razvoja */
    for(const k of ['users','entries','closed','sites','requests','slreq','gorq','obav'])if(!Array.isArray(d[k]))d[k]=[];
    for(const k of ['prijenos','godisnji'])if(!d[k]||typeof d[k]!=='object')d[k]={};
    if(!Array.isArray(d.meals)||!d.meals.length)d.meals=['Vlastiti trošak','Restoran 1','Restoran 2','Restoran 3','Ostali restorani'];
    if(!d.secret)d.secret=crypto.randomBytes(32).toString('hex');
  },
  2:d=>{ /* postavke e-maila (SMTP) i javna adresa aplikacije, uređuju se u aplikaciji */
    if(!d.smtp||typeof d.smtp!=='object')d.smtp={};if(typeof d.appUrl!=='string')d.appUrl='';
  },
  3:d=>{ /* obavijesti radnicima vrijede do zadnjeg datuma koji spominju (dan poslije se ne prikazuju) */
    for(const o of d.obav||[])if(o.until===undefined){const m=[...String(o.text||'').matchAll(/(\d{2})\.(\d{2})\.(\d{4})\./g)].pop();o.until=m?m[3]+'-'+m[2]+'-'+m[1]:''}
  },
  4:d=>{ /* poruke administratora radnicima */ if(!Array.isArray(d.poruke))d.poruke=[]; },
  5:d=>{ /* zahtjevi za novo gradilište i obavijesti o novim gradilištima */ if(!Array.isArray(d.sitereq))d.sitereq=[];if(!Array.isArray(d.siteNews))d.siteNews=[];const n=Date.now();(d.users||[]).forEach(u=>{if(!u.siteSeen)u.siteSeen=n}) },
  6:d=>{ /* pošta radnika: što je radnik ručno obrisao iz svoje pošte (zapisi ostaju) */ if(!d.inboxDel||typeof d.inboxDel!=='object')d.inboxDel={};if(!d.inboxCleaned){const n=new Date();d.inboxCleaned=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')} },
  7:d=>{ /* otpremnice (fotografije su datoteke u data/otpremnice) */ if(!Array.isArray(d.otpremnice))d.otpremnice=[]; },
  8:d=>{ /* otpremnice: gradilišta koja je administrator ručno upisao (vrijede samo u Otpremnicama) */ if(!Array.isArray(d.otpSites))d.otpSites=[]; },
  9:d=>{ /* djelomična administratorska prava radnika po grupama: 'ot' Otpremnice, 'ev' Evidencija radnog vremena, 'al' Alat */ (d.users||[]).forEach(u=>{if(!Array.isArray(u.prava))u.prava=[]}) },
  10:d=>{ /* NARUČI MATERIJAL: narudžbe materijala radnika */ if(!Array.isArray(d.narudzbe))d.narudzbe=[]; },
  11:d=>{ /* VODITELJ RADOVA: nova uloga role:'vod' (samo administratorski dio, odabrane funkcije u u.prava); postojeći korisnici se ne mijenjaju */ (d.users||[]).forEach(u=>{if(!Array.isArray(u.prava))u.prava=[]}) },
  12:d=>{ /* OBRAĐENO: narudžbe imaju status obrade (obr: null = neobrađeno) i povijest prosljeđivanja (fwd); otpSeen = kad je korisnik zadnji put otvorio Otpremnice u administraciji (značka) */
    (d.narudzbe||[]).forEach(o=>{if(o.obr===undefined)o.obr=null;if(!Array.isArray(o.fwd))o.fwd=[]});const n=Date.now();(d.users||[]).forEach(u=>{if(!u.otpSeen)u.otpSeen=n}) },
  13:d=>{ /* PUSH OBAVIJESTI: ključevi poslužitelja (VAPID) i pretplate preglednika {uid,endpoint,keys,prijava,ts} */ if(!Array.isArray(d.push))d.push=[];if(!d.vapid||!d.vapid.pub)d.vapid=Push.vapidKeys() },
  14:d=>{ /* NAUČNIK: Bolest i Odobren izostanak vrijede 0 sati */ (d.entries||[]).forEach(e=>{if(e.vrsta==='Bolest'||e.vrsta==='Odobren izostanak')e.hours=0}) },
  15:d=>{ /* PRIJENOS U SLJEDEĆI MJESEC: ručna vrijednost administratora {uid|mjesec: sati}; bez nje vrijedi višak sati za slobodan dan na kraju mjeseca */ if(!d.prijenosOut||typeof d.prijenosOut!=='object')d.prijenosOut={} }
};
const BK=path.join(DIR,'backup');
const stamp=()=>new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,13);
function backup(tag){if(!fs.existsSync(DB))return;fs.mkdirSync(BK,{recursive:true});fs.copyFileSync(DB,path.join(BK,'db-'+tag+'-'+stamp()+'.json'));
  const old=fs.readdirSync(BK).filter(f=>f.startsWith('db-start-')).sort();old.slice(0,Math.max(0,old.length-30)).forEach(f=>fs.unlinkSync(path.join(BK,f)))}
{const v=db.version||0;
  if(v>DATA_VERSION){console.error('Podaci su iz novije verzije aplikacije (verzija podataka '+v+', ova aplikacija podržava '+DATA_VERSION+'). Instalirajte noviju verziju; podaci nisu dirani.');process.exit(1)}
  backup('start');
  if(v<DATA_VERSION){if(fs.existsSync(DB))backup('prije-v'+DATA_VERSION);for(let i=v+1;i<=DATA_VERSION;i++)MIGRATIONS[i](db);db.version=DATA_VERSION;save();if(v)console.log('Podaci nadograđeni s verzije '+v+' na '+DATA_VERSION+'.')}}
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const sign=id=>id+'.'+crypto.createHmac('sha256',db.secret).update(id).digest('hex');
const ym=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
const nameOf=id=>(db.users.find(u=>u.id===id)||{}).name||'?';
function addUser(name,username,pw,role,email){const salt=crypto.randomBytes(16).toString('hex');const u={id:crypto.randomBytes(8).toString('hex'),name,username:username.toLowerCase(),salt,hash:hash(pw,salt),role,email:email||'',siteSeen:Date.now()};db.users.push(u);return u}
if(!db.users.length){const pw=process.env.ADMIN_PASS||crypto.randomBytes(5).toString('hex'),un=process.env.ADMIN_USER||'admin';addUser('Administrator',un,pw,'admin','');save();console.log('Prvi administrator: '+un+' / '+pw)}

const Core=require('./core.js'),core=Core(db);
const {VRSTE,NERAD,check,rec}=core;
const strs=a=>[...new Set((Array.isArray(a)?a:[]).map(s=>String(s).trim()).filter(Boolean))];
const pad=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const flt=q=>({uid:String(q.uid||''),site:String(q.site||''),vrsta:String(q.vrsta||'')});
/* SMTP: postavke iz aplikacije (Postavke → E-mail), a ako nisu upisane, iz varijabli okruženja (pokreni.bat). */
function smtpCfg(){const m=db.smtp||{};if(m.host)return{host:m.host,port:+m.port||587,secure:!!m.secure,user:m.user||'',pass:m.pass||'',from:m.from||m.user||''};
  if(process.env.SMTP_HOST)return{host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT||587,secure:process.env.SMTP_SECURE==='1',user:process.env.SMTP_USER||'',pass:process.env.SMTP_PASS||'',from:process.env.MAIL_FROM||process.env.SMTP_USER||''};return null}
function mailer(){let nm;try{nm=require('nodemailer')}catch(e){return{err:'Nije instaliran nodemailer. Na serveru u mapi aplikacije pokrenite: npm install nodemailer'}}
  const c=smtpCfg();if(!c)return{err:'E-mail (SMTP) nije podešen. Administrator ga upisuje u Postavkama.'};
  /* Pošiljatelj je obavezan: bez zaglavlja From poruka stiže "bez pošiljatelja", a Gmail i drugi vanjski poslužitelji je odbijaju. */
  const f=String(c.from||c.user||'').trim();if(!/@/.test(f))return{err:'Upišite Pošiljatelja (npr. sihterica@tid-intel.hr) u Postavkama → E-mail.'};
  const from=/</.test(f)?f:{name:'TiDy Connect',address:f};
  const t=nm.createTransport({host:c.host,port:c.port,secure:c.secure,auth:c.user?{user:c.user,pass:c.pass}:undefined});
  /* Ako poslužitelj odbije primatelja, javi grešku umjesto "poslano". */
  const send=async m=>{const i=await t.sendMail(m);if(i&&i.rejected&&i.rejected.length)throw new Error('Poslužitelj je odbio primatelja '+i.rejected.join(', ')+(i.response?' ('+i.response+')':''));return i};
  return{t:{sendMail:send},from}}
async function mail(month){
  const M=mailer();if(M.err)return M.err;
  const to=db.users.filter(u=>u.role==='admin'&&u.email&&!u.disabled&&!u.deleted).map(u=>u.email);
  if(!to.length)return 'Nijedan administrator nema upisanu e-mail adresu.';
  const t=M.t;
  const ms=core.missing(month,{},todayStr()),pend=db.requests.filter(r=>r.status==='open').length+db.slreq.filter(r=>r.status==='open').length;
  let text='U privitku je mjesečni izvještaj (Excel) za '+month+'.';
  if(ms.length)text+='\n\nRadnici bez unosa za prošle radne dane:\n'+ms.map(r=>'- '+r.name+': '+r.dates.length+' dana').join('\n');
  if(pend)text+='\n\nZahtjeva na čekanju (otvaranje mjeseca i slobodan dan): '+pend;
  await t.sendMail({from:M.from,to,subject:'Izvještaj o radnom vremenu '+month,text,attachments:[{filename:'izvjestaj-'+month+'.xlsx',content:Buffer.from(core.xlsx(month,{},todayStr()))}]});
  return 'Poslano na: '+to.join(', ');
}
setInterval(()=>{const n=new Date(),t=new Date(+n+864e5),m=ym(n);
  if(t.getDate()===1&&n.getHours()>=23&&db.lastMail!==m){db.lastMail=m;save();mail(m).then(console.log,console.error)}},6e5);
/* Automatsko čišćenje pošte radnika početkom svakog mjeseca (ostaje 5 najnovijih stavki; zapisi se ne brišu, samo skrivaju) */
const inboxTick=()=>{const m=ym(new Date());if(db.inboxCleaned===m)return;db.users.filter(u=>u.role==='user').forEach(u=>core.inboxClean(u.id));db.inboxCleaned=m;save()};inboxTick();setInterval(inboxTick,6e5);

/* ---- rute ---- */
const routes=[],R=(m,p,a,f)=>routes.push([m,new RegExp('^'+p.replace(/:\w+/g,'([^/]+)')+'$'),a,f,m+' '+p]);
/* GRUPE: radnik može dobiti administratorska prava samo za pojedine grupe; razina rute 'ot'/'iz'/... to provjerava na serveru.
   VODITELJ RADOVA (role 'vod') nije radnik: koristi samo administratorski dio i to pojedine funkcije: ot, nm, al, funkcije Evidencije (EVF) i 'ak' Aktivnosti radnika.
   Grupa 'ev' uključuje sve funkcije Evidencije; can(u,'ev') znači "barem jedna funkcija Evidencije".
   Razina rute može biti i popis (dovoljna je jedna od navedenih funkcija). */
const GRUPE=['ot','ev','al','nm'],EVF=['iz','sl','go','gr','st','ob','po','zh'],FUNK=['ot','nm','al',...EVF,'ak'];
const can=(u,g)=>{if(!u)return false;if(Array.isArray(g))return g.some(x=>can(u,x));if(u.role==='admin')return true;
  if((u.role!=='user'&&u.role!=='vod')||u.disabled||u.deleted||!Array.isArray(u.prava))return false;const p=u.prava;
  return p.includes(g)||(EVF.includes(g)&&p.includes('ev'))||(g==='ev'&&p.some(x=>EVF.includes(x)))};
const pravaOf=u=>u.role==='vod'?FUNK.filter(g=>can(u,g)):u.role==='user'?GRUPE.filter(g=>Array.isArray(u.prava)&&u.prava.includes(g)):[];
const uloga=r=>r==='admin'||r==='vod'?r:'user';
/* naučnik je radnik (role 'user') s oznakom nau; u API-ju korisnika uloga 'nau' */
const noNau=c=>c.u.nau&&(c.send(403,{e:'Naučnik koristi samo šihtericu.'}),true);
const noAdm=c=>c.u.role!=='user'&&(c.send(403,{e:c.u.role==='vod'?'Voditelj radova ne unosi radno vrijeme.':'Administratori ne unose radno vrijeme.'}),true);
const valid=m=>/^\d{4}-\d{2}$/.test(m||'');
const fails={};
/* ===== Aktivnosti radnika za obavijesti administratoru =====
   Svaka uspješna radnja radnika zapisuje se u memoriju (zadnjih 300, ne u db.json). Administratorov preglednik ih
   svakih 10 s dohvaća (/api/aktivnost) i prikazuje kao skočnu obavijest u Windowsima. pre() se izvodi prije radnje
   (npr. podaci unosa koji se briše), f() nakon uspjeha i vraća [naslov, detalji]. */
const BOOT=Date.now().toString(36),akt=[];let aktSeq=0;
const aktD=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?d.slice(8,10)+'.'+d.slice(5,7)+'.'+d.slice(0,4)+'.':String(d||''),aktM=m=>/^\d{4}-\d{2}$/.test(m||'')?m.slice(5,7)+'/'+m.slice(0,4):String(m||'');
const aktE=e=>e?aktD(e.date)+' · '+(e.vrsta||'Redovan rad')+(e.site?' · '+e.site:'')+' · '+String(e.hours).replace('.',',')+' h'+(e.meal?' · '+e.meal:'')+(e.teren?' · teren':''):'';
const aktR=(k,c)=>db[k].find(x=>x.id===c.p[0]&&x.uid===c.u.id),aktN=t=>t?'\nNapomena: '+t:'',aktS=t=>{t=String(t||'');return t.length>160?t.slice(0,157)+'…':t};
const AKT={
  'POST /api/login':{f:()=>['Prijava u aplikaciju','']},
  'POST /api/entries':{f:(c,_,o)=>['Novi unos radnog vremena',aktE(o)]},
  'PUT /api/entries/:id':{pre:c=>aktE(db.entries.find(x=>x.id===c.p[0])),f:(c,was,o)=>['Izmjena unosa radnog vremena',aktE(o)+(was&&was!==aktE(o)?'\nPrije: '+was:'')]},
  'DELETE /api/entries/:id':{pre:c=>aktE(db.entries.find(x=>x.id===c.p[0]&&x.uid===c.u.id)),f:(c,was)=>['Obrisan unos radnog vremena',was]},
  'POST /api/close':{f:c=>['Završen mjesec','Mjesec '+aktM(c.b.month)]},
  'POST /api/slreq':{f:c=>['Zahtjev za slobodan dan',aktD(c.b.date)+aktN(aktS(c.b.reason))]},
  'POST /api/gorq':{f:(c,_,o)=>['Zahtjev za godišnji odmor',aktD(c.b.from)+(c.b.to&&c.b.to!==c.b.from?' – '+aktD(c.b.to):'')+(o&&o.dana?' ('+o.dana+' dana)':'')+aktN(aktS(c.b.reason))]},
  'POST /api/requests':{f:c=>['Zahtjev za ponovno otvaranje mjeseca','Mjesec '+aktM(c.b.month)+aktN(aktS(c.b.reason))]},
  'POST /api/sitereq':{f:c=>['Zahtjev za novo gradilište',aktS(c.b.text)]},
  'DELETE /api/slreq/:id':{pre:c=>aktR('slreq',c),f:(c,q)=>['Povučen zahtjev za slobodan dan',q?aktD(q.date):'']},
  'DELETE /api/gorq/:id':{pre:c=>aktR('gorq',c),f:(c,q)=>['Povučen zahtjev za godišnji odmor',q?aktD(q.dates[0])+(q.dates.length>1?' – '+aktD(q.dates[q.dates.length-1]):''):'']},
  'DELETE /api/requests/:id':{pre:c=>aktR('requests',c),f:(c,q)=>['Povučen zahtjev za otvaranje mjeseca',q?'Mjesec '+aktM(q.month):'']},
  'DELETE /api/sitereq/:id':{pre:c=>aktR('sitereq',c),f:(c,q)=>['Povučen zahtjev za novo gradilište',q?aktS(q.text):'']},
  'POST /api/otpremnice':{f:c=>{const n=(Array.isArray(c.b.files)?c.b.files.length:0);return['Nova otpremnica',(c.b.site===core.OTP_ADMIN?'Odluka administratora':String(c.b.site||''))+' · '+aktD(c.b.date)+' · '+n+(n===1?' fotografija':n<5?' fotografije':' fotografija')+aktN(aktS(c.b.note))]}},
  'DELETE /api/otpremnice/:id':{pre:c=>db.otpremnice.find(x=>x.id===c.p[0]),f:(c,o)=>['Obrisana otpremnica',o?(o.site||'Odluka administratora')+' · '+aktD(o.date):'']},
  'POST /api/otpremnice/:id/odgovor':{pre:c=>db.otpremnice.find(x=>x.id===c.p[0]),f:(c,o)=>['Odgovor na pitanje o otpremnici',(o?(core.otpSite(o,o.files[0])||'Odluka administratora')+' · '+aktD(o.date)+'\n':'')+aktS(c.b.text)]},
  'POST /api/poruke/:id/read':{pre:c=>db.poruke.find(x=>x.id===c.p[0]),f:(c,p)=>['Pročitana poruka',p?aktS(p.text):'']},
  'POST /api/narudzbe':{f:(c,_,o)=>[c.b.send?'Narudžba materijala poslana':'Narudžba materijala spremljena (nije poslana)',String(c.b.site||'')+' · primatelj: '+core.nameOf(String(c.b.adminId||''))+' · stavki: '+(Array.isArray(c.b.items)?c.b.items.length:0)]},
  'DELETE /api/narudzbe/:id':{pre:c=>db.narudzbe.find(x=>x.id===c.p[0]&&x.uid===c.u.id),f:(c,o)=>['Obrisana neposlana narudžba materijala',o?o.site+' · stavki: '+o.items.length:'']},
  'POST /api/password':{f:()=>['Promjena lozinke','']}
};
/* push osim onima s Aktivnostima ide i administratorima te grupe (g) i primatelju narudžbe (to) */
/* bez push obavijesti (ostaju samo u popisu Aktivnosti radnika): prijava i unosi radnog vremena */
const AKNP=new Set(['POST /api/login','POST /api/entries','PUT /api/entries/:id','DELETE /api/entries/:id']);
const AKG={'POST /api/slreq':'sl','POST /api/gorq':'go','POST /api/requests':'iz','POST /api/sitereq':'gr','POST /api/otpremnice':'ot','POST /api/otpremnice/:id/odgovor':'ot'};
function aktAdd(u,t,d,x){const a={id:++aktSeq,ts:Date.now(),uid:u.id,name:u.name,t,d:d||'',login:t==='Prijava u aplikaciju'};akt.push(a);if(akt.length>300)akt.shift();if(!(x&&x.np))pushAkt(a,x||{})}
/* PUSH obavijesti na sve uređaje na kojima je korisnik uključio obavijesti (računalo, Android, iPhone).
   pushAkt: radnja radnika → svima koji vide Aktivnosti radnika, administratorima te grupe i primatelju narudžbe.
   pushU: obavijest određenim korisnicima (radniku odluka, poruka, obrađena narudžba…; administratoru proslijeđena narudžba). */
const pushSubj=()=>'mailto:'+(String((db.smtp||{}).from||'').match(/[^<\s]+@[^>\s]+/)||['obavijesti@tid-intel.hr'])[0];
async function pushTo(list,data){for(const s of list){const st=await Push.send(db.vapid,s,data,pushSubj());if(st===404||st===410){db.push=db.push.filter(x=>x!==s);save()}}}
const pushUser=s=>{const u=db.users.find(x=>x.id===s.uid);return u&&!u.deleted&&!u.disabled?u:null};
function pushAkt(a,x){const hm=new Date(a.ts).toLocaleTimeString('hr-HR',{hour:'2-digit',minute:'2-digit'}),d={title:a.name+': '+a.t,body:(a.d?a.d+'\n':'')+'Vrijeme: '+hm,tag:'akt'+a.id};
  const ak=[],gr=[];(db.push||[]).forEach(s=>{const u=s.uid!==a.uid&&pushUser(s);if(!u)return;
    if(can(u,'ak')){if(!a.login||s.prijava)ak.push(s)}else if(!a.login&&((x.g&&can(u,x.g))||x.to===u.id))gr.push(s)});
  if(ak.length)pushTo(ak,{...d,url:'/#akt'}).catch(e=>console.error(e));
  if(gr.length)pushTo(gr,{...d,url:'/'}).catch(e=>console.error(e))}
function pushU(ids,title,body,url){ids=[].concat(ids);const l=(db.push||[]).filter(s=>ids.includes(s.uid)&&pushUser(s));
  if(l.length)pushTo(l,{title,body:String(body||'').slice(0,400),tag:'n'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),url:url||'/'}).catch(e=>console.error(e))}
/* svaka obavijest koju radnik dobije u aplikaciji (core.notify) stiže i kao push */
Core.onNotify=(uid,text)=>pushU(uid,'TiDy Connect: obavijest',text,'/#pt');
R('GET','/api/push/key',1,c=>c.send(200,{key:db.vapid.pub}));
R('POST','/api/push/sub',1,c=>{const s=c.b.sub||{},ep=String(s.endpoint||''),k=s.keys||{};
  if(!/^https:\/\//.test(ep)||ep.length>1000||!k.p256dh||!k.auth)return c.send(400,{e:'Neispravna pretplata preglednika.'});
  db.push=db.push.filter(x=>x.endpoint!==ep);db.push.push({uid:c.u.id,endpoint:ep,keys:{p256dh:String(k.p256dh).slice(0,200),auth:String(k.auth).slice(0,100)},prijava:c.b.prijava!==false,ts:Date.now()});save();c.send(200,{ok:1})});
R('POST','/api/push/unsub',1,c=>{const ep=String(c.b.endpoint||'');db.push=db.push.filter(x=>!(x.endpoint===ep&&x.uid===c.u.id));save();c.send(200,{ok:1})});
R('POST','/api/push/test',1,async c=>{const l=db.push.filter(x=>x.uid===c.u.id&&x.endpoint===String(c.b.endpoint||''));if(!l.length)return c.send(400,{e:'Na ovom uređaju push obavijesti nisu uključene.'});
  await pushTo(l,{title:'TiDy Connect: probna obavijest',body:'Push obavijesti rade i kad je aplikacija zatvorena.',tag:'akt-test',url:can(c.u,'ak')?'/#akt':'/'});c.send(200,{ok:1})});
R('GET','/api/aktivnost','ak',c=>{const s=c.q.b===BOOT?+c.q.s||0:0;c.send(200,{boot:BOOT,seq:aktSeq,list:akt.filter(a=>a.id>s)})});
R('POST','/api/login',0,c=>{
  const un=String(c.b.username||'').trim().toLowerCase(),key=c.ip+'|'+un,f=fails[key];
  if(f&&f.n>=5&&Date.now()<f.until)return c.send(429,{e:'Previše pogrešnih pokušaja. Pokušajte ponovno za 15 minuta.'});
  const u=db.users.find(x=>x.username===un);
  if(!u||!u.salt||hash(String(c.b.password||''),u.salt)!==u.hash){const x=fails[key]=(f&&Date.now()<f.until)?f:{n:0};x.n++;x.until=Date.now()+9e5;return c.send(401,{e:'Pogrešno korisničko ime ili lozinka.'})}
  delete fails[key];
  if(u.disabled||u.deleted)return c.send(403,{e:'Račun je onemogućen. Obratite se administratoru.'});
  c.send(200,{ok:1},{'Set-Cookie':'t='+sign(u.id)+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'});
});
R('POST','/api/logout',0,c=>c.send(200,{ok:1},{'Set-Cookie':'t=; HttpOnly; Path=/; Max-Age=0'}));
R('GET','/api/me',1,c=>c.send(200,{id:c.u.id,name:c.u.name,role:c.u.role,prava:pravaOf(c.u),nau:!!c.u.nau,sites:db.sites,meals:db.meals,vrste:core.vrsteOf(c.u)}));
R('GET','/api/data',1,c=>{const a=c.u.role==='admin'||(!!c.q.adm&&can(c.u,'ev'));
  c.send(200,{entries:db.entries.filter(e=>a||e.uid===c.u.id).map(e=>({...e,vrsta:e.vrsta||'Redovan rad',name:core.nameOf(e.uid)})),closed:db.closed.filter(k=>a||k.startsWith(c.u.id+'|')),
    requests:db.requests.filter(r=>a||r.uid===c.u.id).map(r=>({...r,name:core.nameOf(r.uid)})),slreq:db.slreq.filter(q=>a||q.uid===c.u.id).map(q=>({...q,name:core.nameOf(q.uid)})),prijenos:core.prMap(a?db.users.filter(u=>u.role==='user').map(u=>u.id):[c.u.id],todayStr()),
    gorq:db.gorq.filter(q=>a||q.uid===c.u.id).map(q=>({...q,name:core.nameOf(q.uid)})),obav:a?[]:db.obav.filter(o=>o.uid===c.u.id&&!o.read&&(!o.until||o.until>=todayStr())),
    sitereq:db.sitereq.filter(r=>a||r.uid===c.u.id).map(r=>({...r,name:core.nameOf(r.uid)})),siteNews:a?[]:db.siteNews.filter(n=>n.ts>(c.u.siteSeen||0)).map(n=>n.site),
    poruke:a?db.poruke.slice().sort((x,y)=>y.ts-x.ts).map(p=>({...p,fromName:core.nameOf(p.from),toNames:Object.fromEntries(p.to.map(id=>[id,core.nameOf(id)]))})):db.poruke.filter(p=>p.to.includes(c.u.id)&&!p.reads[c.u.id]).map(p=>({id:p.id,text:p.text,ts:p.ts,fromName:core.nameOf(p.from)})),
    go:a?null:core.goStats(c.u.id,new Date().getFullYear()),godatumi:a?[]:[...core.goDates(c.u.id)],rev})});
R('GET','/api/rev',1,c=>c.send(200,{rev}));
function linkSl(e){db.slreq.forEach(q=>{if(q.entryId===e.id)q.entryId=null});if(e.vrsta!=='Slobodan dan')return;
  const m=e.date.slice(0,7),mine=db.entries.filter(x=>x.uid===e.uid&&x!==e);
  if(core.bank(mine,m,core.pr(e.uid,m))<8){const ap=core.approval(e.uid,e.date,null);if(ap)ap.entryId=e.id}}
R('POST','/api/entries',1,c=>{if(noAdm(c))return;const er=check(c.u,c.b);if(er)return c.send(400,{e:er});
  const e={id:crypto.randomUUID(),uid:c.u.id,...rec(c.b),ts:Date.now()};db.entries.push(e);linkSl(e);save();c.send(200,e)});
R('PUT','/api/entries/:id',1,c=>{if(noAdm(c))return;const e=db.entries.find(x=>x.id===c.p[0]&&x.uid===c.u.id);if(!e)return c.send(404,{e:'Unos nije pronađen.'});
  if(db.closed.includes(c.u.id+'|'+e.date.slice(0,7)))return c.send(400,{e:'Taj je mjesec završen.'});
  const er=check(c.u,c.b,e.id);if(er)return c.send(400,{e:er});Object.assign(e,rec(c.b));linkSl(e);save();c.send(200,e)});
R('DELETE','/api/entries/:id',1,c=>{if(noAdm(c))return;const i=db.entries.findIndex(x=>x.id===c.p[0]&&x.uid===c.u.id);if(i<0)return c.send(404,{e:'Unos nije pronađen.'});
  if(db.closed.includes(c.u.id+'|'+db.entries[i].date.slice(0,7)))return c.send(400,{e:'Taj je mjesec završen.'});
  {const e0=db.entries[i],m=e0.date.slice(0,7),mine=db.entries.filter(x=>x.uid===c.u.id),aft=core.bank(mine.filter(x=>x!==e0),m,core.pr(c.u.id,m));if(aft<0&&aft<core.bank(mine,m,core.pr(c.u.id,m)))return c.send(400,{e:'Brisanje nije moguće jer je slobodan dan već iskorišten, pa bi Sati za slobodan dan postali negativni.'})}
  db.slreq.forEach(q=>{if(q.entryId===db.entries[i].id)q.entryId=null});db.entries.splice(i,1);save();c.send(200,{ok:1})});
R('POST','/api/slreq',1,c=>{if(noAdm(c)||noNau(c))return;const d=String(c.b.date||''),m=d.slice(0,7);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return c.send(400,{e:'Odaberite datum slobodnog dana.'});
  if(db.closed.includes(c.u.id+'|'+m))return c.send(400,{e:'Taj je mjesec završen.'});
  if(core.bank(db.entries.filter(x=>x.uid===c.u.id),m,core.pr(c.u.id,m))>=8)return c.send(400,{e:'Imate barem 8 sati za slobodan dan, zahtjev nije potreban.'});
  if(db.slreq.some(q=>q.uid===c.u.id&&q.date===d&&(q.status==='open'||(q.status==='approved'&&!q.entryId))))return c.send(400,{e:'Za taj datum već postoji zahtjev.'});
  db.slreq.push({id:crypto.randomUUID(),uid:c.u.id,date:d,reason:String(c.b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open',entryId:null});save();c.send(200,{ok:1})});
R('POST','/api/slreq/:id/decide','sl',c=>{const q=db.slreq.find(x=>x.id===c.p[0]);if(!q||q.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  q.status=c.b.approve?'approved':'rejected';q.note=String(c.b.note||'').trim().slice(0,200);q.decided=Date.now();q.decidedBy=c.u.id;save();c.send(200,{ok:1});
  pushU(q.uid,'Zahtjev za slobodan dan '+(c.b.approve?'prihvaćen':'odbijen'),aktD(q.date)+(q.note?' ('+q.note+')':''),'/#pt')});
R('PUT','/api/prijenos','iz',c=>{const u=db.users.find(x=>x.id===c.b.uid&&x.role==='user'&&!x.deleted),v=parseFloat(String(c.b.value).replace(',','.'));
  if(!u)return c.send(404,{e:'Radnik nije pronađen.'});if(!valid(c.b.month))return c.send(400,{e:'Neispravan mjesec.'});
  const k=u.id+'|'+c.b.month;
  /* kind 'out': prijenos u sljedeći mjesec; prazno = opet automatski (višak sati za slobodan dan) */
  if(c.b.kind==='out'){if(c.b.value===''||c.b.value===null||c.b.value===undefined){delete db.prijenosOut[k];save();return c.send(200,{ok:1})}
    if(!isFinite(v)||Math.abs(v)>1000)return c.send(400,{e:'Unesite broj sati (može biti negativan).'});db.prijenosOut[k]=Math.round(v*100)/100;save();return c.send(200,{ok:1})}
  /* prazno = automatski (prijenos u sljedeći mjesec prošlog mjeseca); broj, i 0, = ručno */
  if(c.b.value===''||c.b.value===null||c.b.value===undefined){delete db.prijenos[k];save();return c.send(200,{ok:1})}
  if(!isFinite(v)||Math.abs(v)>1000)return c.send(400,{e:'Unesite broj sati (može biti negativan).'});
  db.prijenos[k]=Math.round(v*100)/100;save();c.send(200,{ok:1})});
const dd=core.dfmt,span=q=>q.dates.length===1?dd(q.dates[0]):dd(q.dates[0])+' – '+dd(q.dates[q.dates.length-1]);
R('POST','/api/gorq',1,c=>{if(noAdm(c)||noNau(c))return;const dates=core.rangeDates(String(c.b.from||''),c.b.to?String(c.b.to):'');
  if(!dates)return c.send(400,{e:'Neispravan raspon datuma (najviše 92 dana).'});if(!dates.length)return c.send(400,{e:'Odabrani datumi nisu radni dani.'});
  if(dates.some(d=>db.closed.includes(c.u.id+'|'+d.slice(0,7))))return c.send(400,{e:'Neki od dana nalaze se u završenom mjesecu.'});
  const taken=new Set(db.gorq.filter(q=>q.uid===c.u.id&&(q.status==='open'||q.status==='approved')).flatMap(q=>q.dates));
  if(dates.some(d=>taken.has(d)))return c.send(400,{e:'Za neke od tih dana već postoji zahtjev ili odobrenje.'});
  db.gorq.push({id:crypto.randomUUID(),uid:c.u.id,dates,reason:String(c.b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open',source:'zahtjev'});save();c.send(200,{ok:1,dana:dates.length})});
R('POST','/api/gorq/:id/decide','go',c=>{const q=db.gorq.find(x=>x.id===c.p[0]);if(!q||q.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  q.status=c.b.approve?'approved':'rejected';q.note=String(c.b.note||'').trim().slice(0,200);q.decided=Date.now();q.decidedBy=c.u.id;
  core.notify(q.uid,c.b.approve?'Zahtjev za godišnji odmor prihvaćen: '+span(q)+' ('+q.dates.length+' dana). Opcija Godišnji odmor otključana je za te dane.':'Zahtjev za godišnji odmor odbijen: '+span(q)+(q.note?' ('+q.note+')':'')+'.',q.dates[q.dates.length-1]);save();c.send(200,{ok:1})});
R('POST','/api/gorq/grupa','go',c=>{const dates=core.rangeDates(String(c.b.from||''),c.b.to?String(c.b.to):'');
  if(!dates)return c.send(400,{e:'Neispravan raspon datuma (najviše 92 dana).'});if(!dates.length)return c.send(400,{e:'Odabrani datumi nisu radni dani.'});
  const ids=[...new Set(Array.isArray(c.b.uids)?c.b.uids:[])].filter(id=>db.users.some(u=>u.id===id&&u.role==='user'&&!u.disabled&&!u.deleted));
  if(!ids.length)return c.send(400,{e:'Odaberite barem jednog radnika.'});
  ids.forEach(id=>{const q={id:crypto.randomUUID(),uid:id,dates,reason:String(c.b.note||'').trim().slice(0,200),ts:Date.now(),status:'approved',source:'admin',decided:Date.now(),decidedBy:c.u.id,note:''};db.gorq.push(q);
    core.notify(id,'Administrator vam je odobrio godišnji odmor: '+span(q)+' ('+dates.length+' dana). Opcija Godišnji odmor otključana je za te dane.',dates[dates.length-1])});
  save();c.send(200,{ok:1,radnika:ids.length,dana:dates.length})});
R('GET','/api/godisnji','go',c=>{const y=parseInt(c.q.year)||new Date().getFullYear();c.send(200,db.users.filter(u=>u.role==='user'&&!u.deleted).map(u=>({uid:u.id,name:u.name,...core.goStats(u.id,y)})).sort((a,b)=>a.name.localeCompare(b.name,'hr')))});
R('PUT','/api/godisnji','go',c=>{const u=db.users.find(x=>x.id===c.b.uid&&x.role==='user'&&!x.deleted),y=parseInt(c.b.year),uk=parseFloat(String(c.b.ukupno).replace(',','.')),po=parseFloat(String(c.b.pocetno).replace(',','.'));
  if(!u)return c.send(404,{e:'Radnik nije pronađen.'});if(!(y>=2000&&y<=2100))return c.send(400,{e:'Neispravna godina.'});
  if(!(uk>=0&&uk<=366)||!(po>=0&&po<=366))return c.send(400,{e:'Unesite broj dana između 0 i 366.'});
  db.godisnji[u.id+'|'+y]={ukupno:uk,pocetno:po};save();c.send(200,{ok:1})});
R('POST','/api/seen',1,c=>{if(c.u.role!=='user')return c.send(403,{e:'Samo za radnike.'});for(const q of db.slreq.concat(db.gorq,db.requests))if(q.uid===c.u.id&&q.status!=='open'&&!q.seen)q.seen=Date.now();save();c.send(200,{ok:1})});
function chg(kind){return c=>{
  const q=(kind==='sl'?db.slreq:kind==='go'?db.gorq:db.requests).find(x=>x.id===c.p[0]);
  if(!q||q.status==='open')return c.send(404,{e:'Zahtjev nije pronađen ili još nije riješen.'});
  const ap=!!c.b.approve,now=ap?'approved':'rejected';
  if(q.status===now)return c.send(400,{e:'Zahtjev već ima tu odluku.'});
  /* odluka se ne može mijenjati nakon datuma događaja (za godišnji odmor nakon prvog dana) */
  {const ev=kind==='sl'?q.date:kind==='go'?q.dates[0]:'';if(ev&&todayStr()>ev)return c.send(400,{e:'Datum na koji se zahtjev odnosi ('+core.dfmt(ev)+') je prošao, pa se odluka više ne može mijenjati.'})}
  const note=String(c.b.note||'').trim().slice(0,200);let txt;
  if(kind==='sl'){
    if(!ap&&q.entryId)return c.send(400,{e:'Radnik je već iskoristio taj slobodan dan, odluka se ne može promijeniti.'});
    txt='Zahtjev za slobodan dan ('+core.dfmt(q.date)+')';
  }else if(kind==='go'){
    if(!ap&&db.entries.some(e=>e.uid===q.uid&&e.vrsta==='Godišnji odmor'&&q.dates.includes(e.date)))return c.send(400,{e:'Radnik je već upisao godišnji odmor za neke od tih dana, odluka se ne može promijeniti.'});
    if(ap){const taken=new Set(db.gorq.filter(x=>x!==q&&x.uid===q.uid&&x.status==='approved').flatMap(x=>x.dates));if(q.dates.some(d=>taken.has(d)))return c.send(400,{e:'Za neke od tih dana već postoji odobrenje.'})}
    txt='Zahtjev za godišnji odmor ('+span(q)+')';
  }else{
    const k=q.uid+'|'+q.month;
    if(ap)db.closed=db.closed.filter(x=>x!==k);else if(!db.closed.includes(k))db.closed.push(k);
    txt='Zahtjev za ponovno otvaranje mjeseca '+q.month;
  }
  q.status=now;q.note=note;q.decided=Date.now();q.decidedBy=c.u.id;q.changed=Date.now();delete q.seen;
  core.notify(q.uid,'Administrator je izmijenio odluku. '+txt+': '+(ap?'PRIHVAĆEN':'ODBIJEN')+(note?' ('+note+')':'')+'.',kind==='sl'?q.date:kind==='go'?q.dates[q.dates.length-1]:todayStr());
  save();c.send(200,{ok:1})}}
R('POST','/api/slreq/:id/change',['sl','zh'],chg('sl'));R('POST','/api/gorq/:id/change',['go','zh'],chg('go'));R('POST','/api/requests/:id/change',['iz','zh'],chg('mj'));
R('DELETE','/api/slreq/:id',1,c=>wd(c,'slreq'));R('DELETE','/api/gorq/:id',1,c=>wd(c,'gorq'));R('DELETE','/api/requests/:id',1,c=>wd(c,'requests'));
function wd(c,k){if(c.u.role!=='user')return c.send(403,{e:'Samo za radnike.'});const i=db[k].findIndex(x=>x.id===c.p[0]&&x.uid===c.u.id);
  if(i<0)return c.send(404,{e:'Zahtjev nije pronađen.'});if(db[k][i].status!=='open')return c.send(400,{e:'Zahtjev je već riješen i ne može se povući.'});
  db[k].splice(i,1);save();c.send(200,{ok:1})}
/* Poruke administratora: pojedinačno, odabranima ili svima; radnik ih vidi na početnoj dok ne potvrdi čitanje */
R('POST','/api/poruke','po',c=>{const t=String(c.b.text||'').trim().slice(0,2000);if(!t)return c.send(400,{e:'Upišite tekst poruke.'});
  const act=db.users.filter(u=>u.role==='user'&&!u.deleted&&!u.disabled).map(u=>u.id);
  const to=c.b.all?act:[...new Set(Array.isArray(c.b.uids)?c.b.uids:[])].filter(id=>act.includes(id));
  if(!to.length)return c.send(400,{e:'Odaberite barem jednog radnika.'});
  db.poruke.push({id:crypto.randomUUID(),from:c.u.id,text:t,ts:Date.now(),to,all:!!c.b.all,reads:{}});save();c.send(200,{ok:1,n:to.length});
  pushU(to,'Nova poruka: '+c.u.name,t,'/')});
R('POST','/api/poruke/:id/read',1,c=>{const p=db.poruke.find(x=>x.id===c.p[0]&&x.to.includes(c.u.id));if(!p)return c.send(404,{e:'Poruka nije pronađena.'});
  if(!p.reads[c.u.id])p.reads[c.u.id]=Date.now();save();c.send(200,{ok:1})});
R('DELETE','/api/poruke/:id','po',c=>{const i=db.poruke.findIndex(x=>x.id===c.p[0]);if(i<0)return c.send(404,{e:'Poruka nije pronađena.'});db.poruke.splice(i,1);save();c.send(200,{ok:1})});
/* Pošta radnika (gumb s pismom) */
R('GET','/api/inbox',1,c=>c.send(200,core.inbox(c.u.id)));
R('DELETE','/api/inbox/:k/:id',1,c=>{if(!core.inboxHide(c.u.id,c.p[0],c.p[1]))return c.send(404,{e:'Stavka nije pronađena.'});save();c.send(200,{ok:1})});
/* OTPREMNICE: radnik fotografira i šalje. Fotografija ide zasebnim zahtjevom (smanjena u pregledniku, < 1 MB) i sprema se kao
   datoteka u data/otpremnice, a zapis otpremnice s popisom datoteka u bazu. */
const OTP=path.join(DIR,'otpremnice');fs.mkdirSync(OTP,{recursive:true});
const otpPath=f=>path.join(OTP,f);
R('POST','/api/otpremnice/foto',1,c=>{if(noAdm(c)||noNau(c))return;const m=/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(c.b.data||''));
  const buf=m&&Buffer.from(m[1],'base64');if(!buf||buf.length<500||buf[0]!==0xFF||buf[1]!==0xD8)return c.send(400,{e:'Neispravna fotografija.'});
  const f='u-'+core.otpKey(c.u.id)+'-'+crypto.randomBytes(8).toString('hex')+'.jpg';fs.writeFileSync(otpPath(f),buf);c.send(200,{f})});
R('POST','/api/otpremnice',1,c=>{if(noAdm(c)||noNau(c))return;const o=core.otpCheck(c.u,c.b,f=>fs.existsSync(otpPath(f)));if(typeof o==='string')return c.send(400,{e:o});
  db.otpremnice.push(o);save();c.send(200,{ok:1})});
const ymdOk=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
R('GET','/api/otpremnice',1,c=>{const adm=can(c.u,'ot')&&(c.u.role==='admin'||!!c.q.adm);c.send(200,{list:core.otpList(c.u,ymdOk(c.q.od)?c.q.od:'',ymdOk(c.q.do)?c.q.do:'',adm),sites:adm?core.otpSitesAll():[]})});
R('PUT','/api/otpremnice/:id/site','ot',c=>{const r=core.otpSetSite(c.u,c.p[0],String(c.b.f||''),c.b.site);if(typeof r==='string')return c.send(400,{e:r});save();c.send(200,{ok:1})});
R('POST','/api/otpremnice/:id/pitanje','ot',c=>{const r=core.otpAsk(c.u,c.p[0],String(c.b.f||''),c.b.text);if(typeof r==='string')return c.send(400,{e:r});save();c.send(200,{ok:1})});
R('POST','/api/otpremnice/:id/odgovor',1,c=>{const r=core.otpAnswer(c.u,c.p[0],String(c.b.pid||''),c.b.text);if(typeof r==='string')return c.send(400,{e:r});save();c.send(200,{ok:1})});
R('GET','/api/otpremnice/foto/:f',1,c=>{const f=c.p[0];if(!core.otpName(f)||!fs.existsSync(otpPath(f)))return c.send(404,{e:'Fotografija nije pronađena.'});
  if(!can(c.u,'ot')&&!core.otpOwn(c.u.id,f))return c.send(403,{e:'Nemate pristup.'});
  const o=db.otpremnice.find(x=>x.files.includes(f)),nm='otpremnica-'+(o?o.date+'-'+o.site.replace(/[^\w\u00C0-\u024F-]+/g,'_')+'-'+(o.files.indexOf(f)+1):f.slice(0,-4))+'.jpg';
  c.raw(200,fs.readFileSync(otpPath(f)),{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=31536000',...(c.q.dl?{'Content-Disposition':"attachment; filename=\"otpremnica.jpg\"; filename*=UTF-8''"+encodeURIComponent(nm)}:{})})});
R('DELETE','/api/otpremnice/:id',1,c=>{const r=core.otpDelete(c.u,c.p[0],can(c.u,'ot'));if(typeof r==='string')return c.send(400,{e:r});
  r.forEach(f=>{try{fs.unlinkSync(otpPath(f))}catch(e){}});save();c.send(200,{ok:1})});
/* poslane fotografije koje nisu postale dio otpremnice (prekinuto slanje) brišu se nakon 2 dana */
const otpSweep=()=>{try{const old=core.otpExpire(Date.now());if(old.length){old.forEach(f=>{try{fs.unlinkSync(otpPath(f))}catch(e){}});save();console.log('Obrisane otpremnice starije od '+core.OTP_DANA+' dana, fotografija: '+old.length)}}catch(e){console.error(e)}
  try{const used=new Set(db.otpremnice.flatMap(o=>o.files));fs.readdirSync(OTP).forEach(f=>{const p=otpPath(f);if(core.otpName(f)&&!used.has(f)&&Date.now()-fs.statSync(p).mtimeMs>2*864e5)fs.unlinkSync(p)})}catch(e){console.error(e)}};
otpSweep();setInterval(otpSweep,6*36e5);
R('POST','/api/obav/read',1,c=>{db.obav.forEach(o=>{if(o.uid===c.u.id)o.read=true});db.gorq.forEach(q=>{if(q.uid===c.u.id&&q.source==='admin'&&!q.seen)q.seen=Date.now()});save();c.send(200,{ok:1})});
R('POST','/api/close',1,c=>{if(noAdm(c))return;if(!valid(c.b.month))return c.send(400,{e:'Neispravan mjesec.'});
  const md=core.missingDays(c.u.id,c.b.month);if(md.length)return c.send(400,{e:'Unos se ne može završiti. Nedostaje unos za: '+md.map(d=>d.slice(8,10)+'.'+d.slice(5,7)+'.').join(', ')+'.'});
  const k=c.u.id+'|'+c.b.month;if(!db.closed.includes(k)){db.closed.push(k);save()}c.send(200,{ok:1})});
R('POST','/api/reopen','iz',c=>{db.closed=db.closed.filter(k=>k!==c.b.uid+'|'+c.b.month);save();c.send(200,{ok:1})});
R('POST','/api/requests',1,c=>{if(noAdm(c))return;const m=String(c.b.month||'');if(!valid(m))return c.send(400,{e:'Neispravan mjesec.'});
  if(!db.closed.includes(c.u.id+'|'+m))return c.send(400,{e:'Taj mjesec nije završen, pa ga možete mijenjati.'});
  if(db.requests.some(r=>r.uid===c.u.id&&r.month===m&&r.status==='open'))return c.send(400,{e:'Zahtjev za taj mjesec već je poslan.'});
  db.requests.push({id:crypto.randomUUID(),uid:c.u.id,month:m,reason:String(c.b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open'});save();c.send(200,{ok:1})});
R('POST','/api/requests/:id/decide','iz',c=>{const r=db.requests.find(x=>x.id===c.p[0]);if(!r||r.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  r.status=c.b.approve?'approved':'rejected';r.note=String(c.b.note||'').trim().slice(0,200);r.decided=Date.now();r.decidedBy=c.u.id;
  if(c.b.approve)db.closed=db.closed.filter(k=>k!==r.uid+'|'+r.month);save();c.send(200,{ok:1});
  pushU(r.uid,'Zahtjev za ponovno otvaranje mjeseca '+(c.b.approve?'prihvaćen':'odbijen'),'Mjesec '+aktM(r.month)+(r.note?' ('+r.note+')':''),'/#pt')});
R('PUT','/api/config',2,c=>{const s=strs(c.b.sites),m=[...new Set(strs(c.b.meals).map(x=>db.meals.includes(x)?x:x.toLocaleUpperCase('hr-HR')))]; /* nove opcije toplog obroka velikim slovima */if(!m.length)return c.send(400,{e:'Mora ostati barem jedna opcija obroka.'});
  addNews(s.filter(x=>!db.sites.includes(x)));db.sites=s;db.meals=m;save();c.send(200,{ok:1})});
/* Novo gradilište: radnici ga vide kao obavijest pri prvom otvaranju aplikacije nakon dodavanja */
function addNews(list,bez){const t=Date.now();list.forEach(x=>db.siteNews.push({site:x,ts:t}));if(db.siteNews.length>200)db.siteNews=db.siteNews.slice(-200);
  if(list.length)pushU(db.users.filter(u=>u.role==='user'&&u.id!==bez).map(u=>u.id),list.length===1?'Novo gradilište: '+list[0]:'Nova gradilišta',list.join(', '),'/')}
R('POST','/api/sitenews/seen',1,c=>{c.u.siteSeen=Date.now();save();c.send(200,{ok:1})});
/* ===== NARUČI MATERIJAL =====
   Radnik sastavlja popis materijala za gradilište i šalje ga odabranom primatelju (administrator ili radnik s pravom 'nm').
   Poslana narudžba vidi se u primateljevoj grupi NARUDŽBE MATERIJALA i šalje mu se e-mailom s PDF-om. Neposlana ostaje radniku označena kao nije poslana. */
R('GET','/api/narudzbe/nazivi',1,c=>c.send(200,core.nmNazivi(c.q.q)));
R('GET','/api/narudzbe',1,c=>{const adm=!!c.q.adm&&can(c.u,'nm');c.send(200,{list:core.nmList(c.u,adm,!!c.q.svi),primatelji:core.nmPrimatelji(),jm:Core.NM_JM})});
/* e-mail primatelju narudžbe s PDF-om (pri slanju i pri prosljeđivanju); vraća poruku o grešci ili '' */
async function nmMail(o,subject,text){const a=db.users.find(x=>x.id===o.adminId),v=core.nmView(o);
  if(!a||!a.email)return{mail:'Primatelj nema upisan e-mail, narudžba je vidljiva samo u aplikaciji.'};
  const M=mailer();if(M.err)return{mail:'E-mail nije poslan: '+M.err};
  try{await M.t.sendMail({from:M.from,to:a.email,subject,text,
      attachments:[{filename:'narudzba-materijala-'+o.site.replace(/[^\wÀ-ɏ-]+/g,'_').slice(0,60)+'.pdf',content:Buffer.from(Core.pdf(Core.nmDoc(v)))}]});o.mailTs=Date.now();delete o.mailErr;save();return{mail:'',mailTo:a.email}}
  catch(e){o.mailErr=String(e.message).slice(0,200);save();return{mail:'E-mail nije poslan: '+e.message}}}
R('POST','/api/narudzbe',1,async c=>{if(noAdm(c)||noNau(c))return;const o=core.nmSave(c.u,c.b);if(typeof o==='string')return c.send(400,{e:o});if(o.status==='sent'){o.obr=null;o.fwd=[]}save();
  if(o.status!=='sent')return c.send(200,{ok:1,id:o.id});
  const r=await nmMail(o,'Narudžba materijala za '+o.site,c.u.name+' Vam šalje narudžbu materijala za '+o.site+'.');
  c.send(200,{ok:1,id:o.id,mail:r.mail,mailTo:r.mailTo||''})});
R('POST','/api/narudzbe/:id/obradi','nm',c=>{const o=core.nmObradi(c.u,c.p[0],!!c.b.obr);if(typeof o==='string')return c.send(400,{e:o});save();c.send(200,{ok:1});
  if(c.b.obr)pushU(o.uid,'Narudžba materijala obrađena',o.site+' · obradio: '+c.u.name,'/#nm')});
R('POST','/api/narudzbe/:id/proslijedi','nm',async c=>{const o=core.nmProslijedi(c.u,c.p[0],String(c.b.to||''));if(typeof o==='string')return c.send(400,{e:o});save();
  const n=core.nameOf(o.uid);if(o.adminId!==c.u.id)pushU(o.adminId,c.u.name+': proslijeđena narudžba materijala',o.site+' · naručio: '+n,'/#anm');const r=await nmMail(o,'Proslijeđena narudžba materijala za '+o.site,c.u.name+' Vam prosljeđuje narudžbu materijala za '+o.site+' (naručio: '+n+').');
  c.send(200,{ok:1,mail:r.mail,mailTo:r.mailTo||'',toName:core.nameOf(o.adminId)})});
/* ZNAČKE na tipkama početne stranice administracije: broj primljenih, a neobrađenih stavki po grupi (samo ono što korisnik smije vidjeti) */
R('GET','/api/znacke',1,c=>{const u=c.u,z={};
  if(can(u,'ot'))z.aot=db.otpremnice.filter(o=>o.ts>(u.otpSeen||0)&&o.uid!==u.id).length;
  if(can(u,'nm'))z.anm=core.nmNeobr(u);
  const op=k=>db[k].filter(q=>q.status==='open').length;
  if(can(u,'sl'))z.asl=op('slreq');if(can(u,'go'))z.ago=op('gorq');if(can(u,'iz'))z.aiz=op('requests');if(can(u,'gr'))z.agr=op('sitereq');
  z.aev=(z.asl||0)+(z.ago||0)+(z.aiz||0)+(z.agr||0);c.send(200,z)});
R('POST','/api/otpremnice/seen','ot',c=>{c.u.otpSeen=Date.now();save();c.send(200,{ok:1})});
R('DELETE','/api/narudzbe/:id',1,c=>{if(noAdm(c))return;const r=core.nmDelete(c.u,c.p[0]);if(typeof r==='string')return c.send(400,{e:r});save();c.send(200,{ok:1})});
/* Zahtjev radnika za novo gradilište */
R('POST','/api/sitereq',1,c=>{if(noAdm(c))return;const t=String(c.b.text||'').trim().slice(0,200);if(!t)return c.send(400,{e:'Upišite opisni naziv gradilišta.'});
  db.sitereq.push({id:crypto.randomUUID(),uid:c.u.id,text:t,ts:Date.now(),status:'open'});save();c.send(200,{ok:1})});
R('DELETE','/api/sitereq/:id',1,c=>wd(c,'sitereq'));
R('POST','/api/sitereq/:id/decide','gr',c=>{const r=db.sitereq.find(x=>x.id===c.p[0]);if(!r||r.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  r.decided=Date.now();r.decidedBy=c.u.id;
  if(c.b.approve){const nm=String(c.b.name||'').trim().slice(0,100);if(!nm)return c.send(400,{e:'Upišite naziv gradilišta.'});
    if(!db.sites.includes(nm)){db.sites.push(nm);addNews([nm],r.uid)}r.status='approved';r.site=nm;pushU(r.uid,'Zahtjev za novo gradilište prihvaćen',nm,'/')}
  else{r.status='rejected';r.note=String(c.b.note||'').trim().slice(0,200);core.notify(r.uid,'Zahtjev za novo gradilište „'+r.text+'“ je odbijen'+(r.note?' ('+r.note+')':'')+'.','')}
  save();c.send(200,{ok:1})});
const appUrl=c=>{if(db.appUrl)return db.appUrl.replace(/\/+$/,'');const h=String(c.h.host||'localhost');const pr=String(c.h['x-forwarded-proto']||'').split(',')[0]||(/"scheme":"https"/.test(String(c.h['cf-visitor']||''))?'https':'http');return pr+'://'+h};
const genPw=()=>{const a='abcdefghjkmnpqrstuvwxyz23456789';let p='';for(let i=0;i<10;i++)p+=a[crypto.randomInt(a.length)];return p};
R('GET','/api/smtp',2,c=>{const m=db.smtp||{};c.send(200,{host:m.host||'',port:m.port||587,secure:!!m.secure,user:m.user||'',passSet:!!m.pass,from:m.from||'',appUrl:db.appUrl||'',detected:appUrl({h:c.h}),env:!m.host&&!!process.env.SMTP_HOST})});
R('PUT','/api/smtp',2,c=>{const b=c.b,m=db.smtp=db.smtp||{},str=v=>String(v==null?'':v).trim().slice(0,200);
  m.host=str(b.host);m.port=parseInt(b.port)||587;m.secure=!!b.secure;m.user=str(b.user);m.from=str(b.from);if(b.pass)m.pass=String(b.pass).slice(0,200);if(b.clearPass)m.pass='';
  const u=str(b.appUrl);if(u&&!/^https?:\/\/[^\s]+$/i.test(u))return c.send(400,{e:'Adresa aplikacije mora počinjati s https:// (npr. https://sati.vasadomena.hr).'});db.appUrl=u;save();c.send(200,{ok:1})});
R('POST','/api/smtp/test',2,async c=>{const M=mailer();if(M.err)return c.send(400,{e:M.err});if(!c.u.email)return c.send(400,{e:'Upišite svoj e-mail u popisu korisnika (gumb E-mail).'});
  try{await M.t.sendMail({from:M.from,to:c.u.email,subject:'Probna poruka – TiDy Connect',text:'E-mail iz aplikacije radi.\n\nAdresa aplikacije: '+appUrl(c)});c.send(200,{ok:1,to:c.u.email})}catch(e){c.send(400,{e:'Slanje nije uspjelo: '+e.message})}});
R('POST','/api/users/:id/sendlogin',2,async c=>{const u=db.users.find(x=>x.id===c.p[0]&&!x.deleted);if(!u)return c.send(404,{e:'Korisnik nije pronađen.'});
  if(u.disabled)return c.send(400,{e:'Prijava ovog korisnika je onemogućena. Prvo je omogućite.'});
  if(!u.email)return c.send(400,{e:'Korisnik nema upisan e-mail.'});
  const M=mailer();if(M.err)return c.send(400,{e:M.err});
  const pw=genPw(),url=appUrl(c);
  const text='Poštovani/a '+u.name+',\n\nevo vaših podataka za prijavu u aplikaciju TiDy Connect:\n\nAdresa: '+url+'\nKorisničko ime: '+u.username+'\nLozinka: '+pw+'\n\nNakon prve prijave promijenite lozinku (gumb „Lozinka“ na početnoj stranici).\nNa mobitelu adresu možete dodati na početni zaslon (Chrome: izbornik → Dodaj na početni zaslon; iPhone: Dijeli → Dodaj na početni zaslon).\n\nOva poruka je poslana automatski. Ako je niste očekivali, javite se administratoru.';
  try{await M.t.sendMail({from:M.from,to:u.email,subject:'Pristup aplikaciji TiDy Connect',text})}catch(e){return c.send(400,{e:'Slanje nije uspjelo, lozinka nije promijenjena: '+e.message})}
  u.salt=crypto.randomBytes(16).toString('hex');u.hash=hash(pw,u.salt);u.loginSent=Date.now();save();c.send(200,{ok:1,to:u.email})});
R('POST','/api/users/:id/purge',2,c=>{const u=db.users.find(x=>x.id===c.p[0]);
  if(!u||u.purged)return c.send(404,{e:'Nije pronađeno.'});if(!u.deleted)return c.send(400,{e:'Trajno se može obrisati samo prethodno izbrisan korisnik.'});
  /* ime ostaje zbog evidencije (unosi, izvještaji), sve ostalo se briše; korisnik se više nigdje ne nudi */
  u.purged=Date.now();u.email='';delete u.salt;delete u.hash;delete u.loginSent;save();c.send(200,{ok:1})});
R('GET','/api/users',1,c=>{const full=c.u.role==='admin';if(!full&&c.u.role!=='vod'&&!pravaOf(c.u).length)return c.send(403,{e:'Samo za administratore.'});
  /* djelomični administrator dobiva samo imena i stanje korisnika (bez korisničkih imena i e-mailova) */
  c.send(200,db.users.filter(u=>!u.purged).map(({id,name,username,role,email,disabled,deleted,loginSent,prava,nau})=>full?({id,name,username:deleted?'':username,role,nau:!!nau,email,disabled:!!disabled,deleted:deleted||0,loginSent:loginSent||0,prava:role!=='admin'&&Array.isArray(prava)?prava:[]}):({id,name,role,nau:!!nau,disabled:!!disabled,deleted:deleted||0})))});
R('POST','/api/users',2,c=>{const b=c.b,un=String(b.username||'').trim().toLowerCase(),pw=String(b.password||'');
  if(!String(b.name||'').trim()||!un||pw.length<6)return c.send(400,{e:'Unesite ime i prezime, korisničko ime i lozinku (min. 6 znakova).'});
  if(db.users.some(u=>u.username===un))return c.send(400,{e:'Korisničko ime već postoji.'});
  const nu=addUser(String(b.name).trim(),un,pw,uloga(b.role),String(b.email||'').trim());nu.prava=[];if(b.role==='nau')nu.nau=true;save();c.send(200,{ok:1})});
R('PUT','/api/users/:id',2,c=>{const u=db.users.find(x=>x.id===c.p[0]);if(!u)return c.send(404,{e:'Nije pronađeno.'});
  if(u.deleted)return c.send(400,{e:'Korisnik je izbrisan.'});const b=c.b,bad=e=>c.send(400,{e});
  /* prvo sve provjeri, pa tek onda spremi */
  if(b.password!==undefined&&b.password!==''&&String(b.password).length<6)return bad('Lozinka mora imati barem 6 znakova.');
  if(b.name!==undefined&&!String(b.name).trim())return bad('Upišite ime i prezime.');
  let un;if(b.username!==undefined){un=String(b.username).trim().toLowerCase();
    if(!un||/^~/.test(un)||/\s/.test(un))return bad('Korisničko ime ne smije biti prazno ni sadržavati razmake.');
    if(db.users.some(x=>x!==u&&x.username===un))return bad('Korisničko ime "'+un+'" već koristi drugi korisnik.')}
  let em;if(b.email!==undefined){em=String(b.email).trim();if(em&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))return bad('Neispravna e-mail adresa.')}
  if(b.disabled!==undefined&&u.id===c.u.id)return bad('Ne možete onemogućiti sami sebe.');
  /* uloga: 'admin', 'user' (radnik) ili 'vod' (voditelj radova: samo odabrane funkcije administratorskog dijela) */
  if(b.role!==undefined&&u.id===c.u.id&&uloga(b.role)!==u.role)return bad('Ne možete promijeniti vlastitu ulogu.');
  if(b.password){u.salt=crypto.randomBytes(16).toString('hex');u.hash=hash(String(b.password),u.salt)}
  if(b.name!==undefined)u.name=String(b.name).trim().slice(0,100);if(un!==undefined)u.username=un;if(em!==undefined)u.email=em;
  if(b.disabled!==undefined)u.disabled=!!b.disabled;if(b.role!==undefined&&u.id!==c.u.id){const r=uloga(b.role),n=b.role==='nau';if(r!==u.role||n!==!!u.nau)u.prava=[];u.role=r;if(n)u.nau=true;else delete u.nau}
  if(Array.isArray(b.prava))u.prava=(u.role==='vod'?FUNK:GRUPE).filter(g=>b.prava.includes(g));if(u.role==='admin'||u.nau)u.prava=[];
  save();c.send(200,{ok:1})});
R('DELETE','/api/users/:id',2,c=>{if(c.p[0]===c.u.id)return c.send(400,{e:'Ne možete obrisati sami sebe.'});
  /* Brisanje je logičko: unosi i ime ostaju u evidenciji, a prijava i novi podaci više nisu mogući. */
  const u=db.users.find(x=>x.id===c.p[0]);if(!u||u.deleted)return c.send(404,{e:'Nije pronađeno.'});
  u.deleted=Date.now();u.disabled=true;u.username='~'+u.id;u.email='';
  for(const k of ['slreq','gorq','requests'])db[k]=db[k].filter(x=>!(x.uid===u.id&&x.status==='open'));
  db.obav=db.obav.filter(o=>o.uid!==u.id);save();c.send(200,{ok:1})});
R('POST','/api/password',1,c=>{const n=String(c.b.new||'');
  if(hash(String(c.b.old||''),c.u.salt)!==c.u.hash)return c.send(400,{e:'Stara lozinka nije točna.'});
  if(n.length<6)return c.send(400,{e:'Nova lozinka mora imati barem 6 znakova.'});
  c.u.salt=crypto.randomBytes(16).toString('hex');c.u.hash=hash(n,c.u.salt);save();c.send(200,{ok:1})});
const vp=p=>/^(\d{4}|all)$/.test(p||'');
R('GET','/api/sitehours','gr',c=>vp(c.q.period)?c.send(200,core.siteHours(c.q.period,String(c.q.site||''))):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/sitehours.csv','gr',c=>vp(c.q.period)?c.raw(200,core.siteCsv(c.q.period,String(c.q.site||'')),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sati-po-gradilistima-'+c.q.period+'.csv"'}):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/sitehours.xlsx','gr',c=>vp(c.q.period)?c.raw(200,Buffer.from(core.siteXlsx(c.q.period,String(c.q.site||''))),{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="sati-po-gradilistima-'+c.q.period+'.xlsx"'}):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/stats','st',c=>/^\d{4}(-\d{2})?$/.test(c.q.period||'')?c.send(200,core.stats(c.q.period,todayStr())):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/report','ev',c=>valid(c.q.month)?c.send(200,core.report(c.q.month,flt(c.q),todayStr())):c.send(400,{e:'Neispravan mjesec.'}));
R('GET','/api/report.csv','iz',c=>{if(!valid(c.q.month))return c.send(400,{e:'Neispravan mjesec.'});const k=['sum','day','site','det','sl','mis'].includes(c.q.kind)?c.q.kind:'sum';
  c.raw(200,core.csv(c.q.month,k,flt(c.q),todayStr()),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+({det:'unosi-',day:'sati-po-danima-',site:'po-gradilistima-',sl:'slobodni-dani-',mis:'bez-unosa-'}[k]||'sazetak-')+c.q.month+'.csv"'})});
/* ŠIHTERICE: list po radniku u obliku tvrtkinog predloška (predlosci/sihterica), za sve radnike ili odabranog */
const Sih=require('./sihterica.js'),SIHD=path.join(__dirname,'predlosci','sihterica'),SIHT=Object.fromEntries(fs.readdirSync(SIHD).map(f=>[f,f.endsWith('.png')?fs.readFileSync(path.join(SIHD,f)):fs.readFileSync(path.join(SIHD,f),'utf8')]));
R('GET','/api/sihterice.xlsx','iz',c=>{if(!valid(c.q.month))return c.send(400,{e:'Neispravan mjesec.'});const l=core.sihterice(c.q.month,String(c.q.uid||''));if(!l.length)return c.send(400,{e:'Nema radnika za taj mjesec.'});
  c.raw(200,Buffer.from(Sih.build(SIHT,l,Core.zip)),{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="sihterice-'+c.q.month+(l.length===1?'-'+l[0].name.normalize('NFD').replace(/[^\w]+/g,'-').replace(/^-|-$/g,''):'')+'.xlsx"'})});
R('GET','/api/report.xlsx','iz',c=>valid(c.q.month)?c.raw(200,Buffer.from(core.xlsx(c.q.month,flt(c.q),todayStr())),{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="izvjestaj-'+c.q.month+'.xlsx"'}):c.send(400,{e:'Neispravan mjesec.'}));
R('POST','/api/report/send','iz',async c=>{if(!valid(c.b.month))return c.send(400,{e:'Neispravan mjesec.'});
  try{c.send(200,{msg:await mail(c.b.month)})}catch(e){c.send(500,{e:'Slanje nije uspjelo: '+e.message})}});

http.createServer((req,res)=>{
  const url=new URL(req.url,'http://x');
  const raw=(code,t,h)=>{res.writeHead(code,h||{});res.end(t)};
  const send=(code,o,h)=>raw(code,JSON.stringify(o),{'Content-Type':'application/json; charset=utf-8',...h});
  if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html'))
    return raw(200,fs.readFileSync(path.join(__dirname,'public','index.html')),{'Content-Type':'text/html; charset=utf-8'});
  /* ikone za početni zaslon mobitela (logo tvrtke) i manifest */
  {const IK={'/icon-192.png':'image/png','/icon-512.png':'image/png','/icon-maskable-512.png':'image/png','/apple-touch-icon.png':'image/png','/apple-touch-icon-precomposed.png':'image/png','/favicon.png':'image/png','/badge-96.png':'image/png','/favicon.ico':'image/png','/manifest.webmanifest':'application/manifest+json'},t=req.method==='GET'&&IK[url.pathname];
   if(t){const f=url.pathname==='/apple-touch-icon-precomposed.png'?'apple-touch-icon.png':url.pathname==='/favicon.ico'?'favicon.png':url.pathname.slice(1);return raw(200,fs.readFileSync(path.join(__dirname,'public',f)),{'Content-Type':t,'Cache-Control':'public, max-age=86400'})}}
  if(req.method==='GET'&&url.pathname==='/sw.js')
    return raw(200,fs.readFileSync(path.join(__dirname,'public','sw.js')),{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-cache','Service-Worker-Allowed':'/'});
  if(req.method==='GET'&&url.pathname==='/logo.png')
    return raw(200,fs.readFileSync(path.join(__dirname,'public','logo.png')),{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});
  if(req.method==='GET'&&url.pathname==='/core.js')
    return raw(200,fs.readFileSync(path.join(__dirname,'core.js')),{'Content-Type':'application/javascript; charset=utf-8'});
  let body='';req.on('data',d=>{body+=d;if(body.length>1e6)req.destroy()});
  req.on('end',()=>{
    for(const [m,re,auth,fn,key] of routes){
      const x=m===req.method&&re.exec(url.pathname);if(!x)continue;
      let b={};try{b=body?JSON.parse(body):{}}catch(e){return send(400,{e:'Neispravan zahtjev.'})}
      const c={b,p:x.slice(1),q:Object.fromEntries(url.searchParams),h:req.headers,send,raw,ip:clientIp(req)};
      if(auth){const t=/(?:^|;\s*)t=([^;]+)/.exec(req.headers.cookie||'');
        if(t&&sign(t[1].split('.')[0])===t[1])c.u=db.users.find(u=>u.id===t[1].split('.')[0]);
        if(c.u&&(c.u.disabled||c.u.deleted))return send(401,{e:'Račun je onemogućen. Obratite se administratoru.'});
        if(!c.u)return send(401,{e:'Prijavite se.'});
        if(auth===2&&c.u.role!=='admin')return send(403,{e:'Samo za administratore.'});
        if((typeof auth==='string'||Array.isArray(auth))&&!can(c.u,auth))return send(403,{e:'Nemate pravo pristupa ovom dijelu.'})}
      const ak=req.method!=='GET'&&AKT[key];
      if(ak){let u=c.u,pre;try{if(!u)u=db.users.find(x=>x.username===String(b.username||'').trim().toLowerCase());if(u&&u.role==='user'&&ak.pre)pre=ak.pre(c)}catch(e){}
        if(u&&u.role==='user')c.send=(code,o,h)=>{if(code===200)try{const[t,d]=ak.f(c,pre,o);const n=key==='POST /api/narudzbe'&&o&&db.narudzbe.find(x=>x.id===o.id&&x.status==='sent');aktAdd(u,t,d,{g:AKG[key],to:n?n.adminId:'',np:AKNP.has(key)})}catch(e){console.error(e)}send(code,o,h)}}
      return Promise.resolve(fn(c)).catch(e=>{console.error(e);send(500,{e:'Greška na serveru.'})});
    }
    send(404,{e:'Nije pronađeno.'});
  });
}).listen(PORT,()=>console.log('Aplikacija radi na http://localhost:'+PORT));
