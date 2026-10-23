'use strict';
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
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
const DATA_VERSION=6;
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
  6:d=>{ /* pošta radnika: što je radnik ručno obrisao iz svoje pošte (zapisi ostaju) */ if(!d.inboxDel||typeof d.inboxDel!=='object')d.inboxDel={};if(!d.inboxCleaned){const n=new Date();d.inboxCleaned=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')} }
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
  const from=/</.test(f)?f:{name:'Evidencija radnog vremena',address:f};
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
const routes=[],R=(m,p,a,f)=>routes.push([m,new RegExp('^'+p.replace(/:\w+/g,'([^/]+)')+'$'),a,f]);
const noAdm=c=>c.u.role==='admin'&&(c.send(403,{e:'Administratori ne unose radno vrijeme.'}),true);
const valid=m=>/^\d{4}-\d{2}$/.test(m||'');
const fails={};
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
R('GET','/api/me',1,c=>c.send(200,{id:c.u.id,name:c.u.name,role:c.u.role,sites:db.sites,meals:db.meals,vrste:VRSTE}));
R('GET','/api/data',1,c=>{const a=c.u.role==='admin';
  c.send(200,{entries:db.entries.filter(e=>a||e.uid===c.u.id).map(e=>({...e,vrsta:e.vrsta||'Redovan rad',name:core.nameOf(e.uid)})),closed:db.closed.filter(k=>a||k.startsWith(c.u.id+'|')),
    requests:db.requests.filter(r=>a||r.uid===c.u.id).map(r=>({...r,name:core.nameOf(r.uid)})),slreq:db.slreq.filter(q=>a||q.uid===c.u.id).map(q=>({...q,name:core.nameOf(q.uid)})),prijenos:Object.fromEntries(Object.entries(db.prijenos).filter(([k])=>a||k.startsWith(c.u.id+'|'))),
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
R('POST','/api/slreq',1,c=>{if(noAdm(c))return;const d=String(c.b.date||''),m=d.slice(0,7);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return c.send(400,{e:'Odaberite datum slobodnog dana.'});
  if(db.closed.includes(c.u.id+'|'+m))return c.send(400,{e:'Taj je mjesec završen.'});
  if(core.bank(db.entries.filter(x=>x.uid===c.u.id),m,core.pr(c.u.id,m))>=8)return c.send(400,{e:'Imate barem 8 sati za slobodan dan, zahtjev nije potreban.'});
  if(db.slreq.some(q=>q.uid===c.u.id&&q.date===d&&(q.status==='open'||(q.status==='approved'&&!q.entryId))))return c.send(400,{e:'Za taj datum već postoji zahtjev.'});
  db.slreq.push({id:crypto.randomUUID(),uid:c.u.id,date:d,reason:String(c.b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open',entryId:null});save();c.send(200,{ok:1})});
R('POST','/api/slreq/:id/decide',2,c=>{const q=db.slreq.find(x=>x.id===c.p[0]);if(!q||q.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  q.status=c.b.approve?'approved':'rejected';q.note=String(c.b.note||'').trim().slice(0,200);q.decided=Date.now();q.decidedBy=c.u.id;save();c.send(200,{ok:1})});
R('PUT','/api/prijenos',2,c=>{const u=db.users.find(x=>x.id===c.b.uid&&x.role==='user'&&!x.deleted),v=parseFloat(String(c.b.value).replace(',','.'));
  if(!u)return c.send(404,{e:'Radnik nije pronađen.'});if(!valid(c.b.month))return c.send(400,{e:'Neispravan mjesec.'});
  if(!isFinite(v)||Math.abs(v)>1000)return c.send(400,{e:'Unesite broj sati (može biti negativan).'});
  const k=u.id+'|'+c.b.month;if(v===0)delete db.prijenos[k];else db.prijenos[k]=Math.round(v*100)/100;save();c.send(200,{ok:1})});
const dd=core.dfmt,span=q=>q.dates.length===1?dd(q.dates[0]):dd(q.dates[0])+' – '+dd(q.dates[q.dates.length-1]);
R('POST','/api/gorq',1,c=>{if(noAdm(c))return;const dates=core.rangeDates(String(c.b.from||''),c.b.to?String(c.b.to):'');
  if(!dates)return c.send(400,{e:'Neispravan raspon datuma (najviše 92 dana).'});if(!dates.length)return c.send(400,{e:'Odabrani datumi nisu radni dani.'});
  if(dates.some(d=>db.closed.includes(c.u.id+'|'+d.slice(0,7))))return c.send(400,{e:'Neki od dana nalaze se u završenom mjesecu.'});
  const taken=new Set(db.gorq.filter(q=>q.uid===c.u.id&&(q.status==='open'||q.status==='approved')).flatMap(q=>q.dates));
  if(dates.some(d=>taken.has(d)))return c.send(400,{e:'Za neke od tih dana već postoji zahtjev ili odobrenje.'});
  db.gorq.push({id:crypto.randomUUID(),uid:c.u.id,dates,reason:String(c.b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open',source:'zahtjev'});save();c.send(200,{ok:1,dana:dates.length})});
R('POST','/api/gorq/:id/decide',2,c=>{const q=db.gorq.find(x=>x.id===c.p[0]);if(!q||q.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  q.status=c.b.approve?'approved':'rejected';q.note=String(c.b.note||'').trim().slice(0,200);q.decided=Date.now();q.decidedBy=c.u.id;
  core.notify(q.uid,c.b.approve?'Zahtjev za godišnji odmor prihvaćen: '+span(q)+' ('+q.dates.length+' dana). Opcija Godišnji odmor otključana je za te dane.':'Zahtjev za godišnji odmor odbijen: '+span(q)+(q.note?' ('+q.note+')':'')+'.',q.dates[q.dates.length-1]);save();c.send(200,{ok:1})});
R('POST','/api/gorq/grupa',2,c=>{const dates=core.rangeDates(String(c.b.from||''),c.b.to?String(c.b.to):'');
  if(!dates)return c.send(400,{e:'Neispravan raspon datuma (najviše 92 dana).'});if(!dates.length)return c.send(400,{e:'Odabrani datumi nisu radni dani.'});
  const ids=[...new Set(Array.isArray(c.b.uids)?c.b.uids:[])].filter(id=>db.users.some(u=>u.id===id&&u.role==='user'&&!u.disabled&&!u.deleted));
  if(!ids.length)return c.send(400,{e:'Odaberite barem jednog radnika.'});
  ids.forEach(id=>{const q={id:crypto.randomUUID(),uid:id,dates,reason:String(c.b.note||'').trim().slice(0,200),ts:Date.now(),status:'approved',source:'admin',decided:Date.now(),decidedBy:c.u.id,note:''};db.gorq.push(q);
    core.notify(id,'Administrator vam je odobrio godišnji odmor: '+span(q)+' ('+dates.length+' dana). Opcija Godišnji odmor otključana je za te dane.',dates[dates.length-1])});
  save();c.send(200,{ok:1,radnika:ids.length,dana:dates.length})});
R('GET','/api/godisnji',2,c=>{const y=parseInt(c.q.year)||new Date().getFullYear();c.send(200,db.users.filter(u=>u.role==='user'&&!u.deleted).map(u=>({uid:u.id,name:u.name,...core.goStats(u.id,y)})).sort((a,b)=>a.name.localeCompare(b.name,'hr')))});
R('PUT','/api/godisnji',2,c=>{const u=db.users.find(x=>x.id===c.b.uid&&x.role==='user'&&!x.deleted),y=parseInt(c.b.year),uk=parseFloat(String(c.b.ukupno).replace(',','.')),po=parseFloat(String(c.b.pocetno).replace(',','.'));
  if(!u)return c.send(404,{e:'Radnik nije pronađen.'});if(!(y>=2000&&y<=2100))return c.send(400,{e:'Neispravna godina.'});
  if(!(uk>=0&&uk<=366)||!(po>=0&&po<=366))return c.send(400,{e:'Unesite broj dana između 0 i 366.'});
  db.godisnji[u.id+'|'+y]={ukupno:uk,pocetno:po};save();c.send(200,{ok:1})});
R('POST','/api/seen',1,c=>{if(c.u.role==='admin')return c.send(403,{e:'Samo za radnike.'});for(const q of db.slreq.concat(db.gorq,db.requests))if(q.uid===c.u.id&&q.status!=='open'&&!q.seen)q.seen=Date.now();save();c.send(200,{ok:1})});
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
R('POST','/api/slreq/:id/change',2,chg('sl'));R('POST','/api/gorq/:id/change',2,chg('go'));R('POST','/api/requests/:id/change',2,chg('mj'));
R('DELETE','/api/slreq/:id',1,c=>wd(c,'slreq'));R('DELETE','/api/gorq/:id',1,c=>wd(c,'gorq'));R('DELETE','/api/requests/:id',1,c=>wd(c,'requests'));
function wd(c,k){if(c.u.role==='admin')return c.send(403,{e:'Samo za radnike.'});const i=db[k].findIndex(x=>x.id===c.p[0]&&x.uid===c.u.id);
  if(i<0)return c.send(404,{e:'Zahtjev nije pronađen.'});if(db[k][i].status!=='open')return c.send(400,{e:'Zahtjev je već riješen i ne može se povući.'});
  db[k].splice(i,1);save();c.send(200,{ok:1})}
/* Poruke administratora: pojedinačno, odabranima ili svima; radnik ih vidi na početnoj dok ne potvrdi čitanje */
R('POST','/api/poruke',2,c=>{const t=String(c.b.text||'').trim().slice(0,2000);if(!t)return c.send(400,{e:'Upišite tekst poruke.'});
  const act=db.users.filter(u=>u.role==='user'&&!u.deleted&&!u.disabled).map(u=>u.id);
  const to=c.b.all?act:[...new Set(Array.isArray(c.b.uids)?c.b.uids:[])].filter(id=>act.includes(id));
  if(!to.length)return c.send(400,{e:'Odaberite barem jednog radnika.'});
  db.poruke.push({id:crypto.randomUUID(),from:c.u.id,text:t,ts:Date.now(),to,all:!!c.b.all,reads:{}});save();c.send(200,{ok:1,n:to.length})});
R('POST','/api/poruke/:id/read',1,c=>{const p=db.poruke.find(x=>x.id===c.p[0]&&x.to.includes(c.u.id));if(!p)return c.send(404,{e:'Poruka nije pronađena.'});
  if(!p.reads[c.u.id])p.reads[c.u.id]=Date.now();save();c.send(200,{ok:1})});
R('DELETE','/api/poruke/:id',2,c=>{const i=db.poruke.findIndex(x=>x.id===c.p[0]);if(i<0)return c.send(404,{e:'Poruka nije pronađena.'});db.poruke.splice(i,1);save();c.send(200,{ok:1})});
/* Pošta radnika (gumb s pismom) */
R('GET','/api/inbox',1,c=>c.send(200,core.inbox(c.u.id)));
R('DELETE','/api/inbox/:k/:id',1,c=>{if(!core.inboxHide(c.u.id,c.p[0],c.p[1]))return c.send(404,{e:'Stavka nije pronađena.'});save();c.send(200,{ok:1})});
R('POST','/api/obav/read',1,c=>{db.obav.forEach(o=>{if(o.uid===c.u.id)o.read=true});db.gorq.forEach(q=>{if(q.uid===c.u.id&&q.source==='admin'&&!q.seen)q.seen=Date.now()});save();c.send(200,{ok:1})});
R('POST','/api/close',1,c=>{if(noAdm(c))return;if(!valid(c.b.month))return c.send(400,{e:'Neispravan mjesec.'});
  const md=core.missingDays(c.u.id,c.b.month);if(md.length)return c.send(400,{e:'Unos se ne može završiti. Nedostaje unos za: '+md.map(d=>d.slice(8,10)+'.'+d.slice(5,7)+'.').join(', ')+'.'});
  const k=c.u.id+'|'+c.b.month;if(!db.closed.includes(k)){db.closed.push(k);save()}c.send(200,{ok:1})});
R('POST','/api/reopen',2,c=>{db.closed=db.closed.filter(k=>k!==c.b.uid+'|'+c.b.month);save();c.send(200,{ok:1})});
R('POST','/api/requests',1,c=>{if(noAdm(c))return;const m=String(c.b.month||'');if(!valid(m))return c.send(400,{e:'Neispravan mjesec.'});
  if(!db.closed.includes(c.u.id+'|'+m))return c.send(400,{e:'Taj mjesec nije završen, pa ga možete mijenjati.'});
  if(db.requests.some(r=>r.uid===c.u.id&&r.month===m&&r.status==='open'))return c.send(400,{e:'Zahtjev za taj mjesec već je poslan.'});
  db.requests.push({id:crypto.randomUUID(),uid:c.u.id,month:m,reason:String(c.b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open'});save();c.send(200,{ok:1})});
R('POST','/api/requests/:id/decide',2,c=>{const r=db.requests.find(x=>x.id===c.p[0]);if(!r||r.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  r.status=c.b.approve?'approved':'rejected';r.note=String(c.b.note||'').trim().slice(0,200);r.decided=Date.now();r.decidedBy=c.u.id;
  if(c.b.approve)db.closed=db.closed.filter(k=>k!==r.uid+'|'+r.month);save();c.send(200,{ok:1})});
R('PUT','/api/config',2,c=>{const s=strs(c.b.sites),m=[...new Set(strs(c.b.meals).map(x=>db.meals.includes(x)?x:x.toLocaleUpperCase('hr-HR')))]; /* nove opcije toplog obroka velikim slovima */if(!m.length)return c.send(400,{e:'Mora ostati barem jedna opcija obroka.'});
  addNews(s.filter(x=>!db.sites.includes(x)));db.sites=s;db.meals=m;save();c.send(200,{ok:1})});
/* Novo gradilište: radnici ga vide kao obavijest pri prvom otvaranju aplikacije nakon dodavanja */
function addNews(list){const t=Date.now();list.forEach(x=>db.siteNews.push({site:x,ts:t}));if(db.siteNews.length>200)db.siteNews=db.siteNews.slice(-200)}
R('POST','/api/sitenews/seen',1,c=>{c.u.siteSeen=Date.now();save();c.send(200,{ok:1})});
/* Zahtjev radnika za novo gradilište */
R('POST','/api/sitereq',1,c=>{if(noAdm(c))return;const t=String(c.b.text||'').trim().slice(0,200);if(!t)return c.send(400,{e:'Upišite opisni naziv gradilišta.'});
  db.sitereq.push({id:crypto.randomUUID(),uid:c.u.id,text:t,ts:Date.now(),status:'open'});save();c.send(200,{ok:1})});
R('DELETE','/api/sitereq/:id',1,c=>wd(c,'sitereq'));
R('POST','/api/sitereq/:id/decide',2,c=>{const r=db.sitereq.find(x=>x.id===c.p[0]);if(!r||r.status!=='open')return c.send(404,{e:'Zahtjev nije pronađen ili je već riješen.'});
  r.decided=Date.now();r.decidedBy=c.u.id;
  if(c.b.approve){const nm=String(c.b.name||'').trim().slice(0,100);if(!nm)return c.send(400,{e:'Upišite naziv gradilišta.'});
    if(!db.sites.includes(nm)){db.sites.push(nm);addNews([nm])}r.status='approved';r.site=nm}
  else{r.status='rejected';r.note=String(c.b.note||'').trim().slice(0,200);core.notify(r.uid,'Zahtjev za novo gradilište „'+r.text+'“ je odbijen'+(r.note?' ('+r.note+')':'')+'.','')}
  save();c.send(200,{ok:1})});
const appUrl=c=>{if(db.appUrl)return db.appUrl.replace(/\/+$/,'');const h=String(c.h.host||'localhost');const pr=String(c.h['x-forwarded-proto']||'').split(',')[0]||(/"scheme":"https"/.test(String(c.h['cf-visitor']||''))?'https':'http');return pr+'://'+h};
const genPw=()=>{const a='abcdefghjkmnpqrstuvwxyz23456789';let p='';for(let i=0;i<10;i++)p+=a[crypto.randomInt(a.length)];return p};
R('GET','/api/smtp',2,c=>{const m=db.smtp||{};c.send(200,{host:m.host||'',port:m.port||587,secure:!!m.secure,user:m.user||'',passSet:!!m.pass,from:m.from||'',appUrl:db.appUrl||'',detected:appUrl({h:c.h}),env:!m.host&&!!process.env.SMTP_HOST})});
R('PUT','/api/smtp',2,c=>{const b=c.b,m=db.smtp=db.smtp||{},str=v=>String(v==null?'':v).trim().slice(0,200);
  m.host=str(b.host);m.port=parseInt(b.port)||587;m.secure=!!b.secure;m.user=str(b.user);m.from=str(b.from);if(b.pass)m.pass=String(b.pass).slice(0,200);if(b.clearPass)m.pass='';
  const u=str(b.appUrl);if(u&&!/^https?:\/\/[^\s]+$/i.test(u))return c.send(400,{e:'Adresa aplikacije mora počinjati s https:// (npr. https://sati.vasadomena.hr).'});db.appUrl=u;save();c.send(200,{ok:1})});
R('POST','/api/smtp/test',2,async c=>{const M=mailer();if(M.err)return c.send(400,{e:M.err});if(!c.u.email)return c.send(400,{e:'Upišite svoj e-mail u popisu korisnika (gumb E-mail).'});
  try{await M.t.sendMail({from:M.from,to:c.u.email,subject:'Probna poruka – Evidencija radnog vremena',text:'E-mail iz aplikacije radi.\n\nAdresa aplikacije: '+appUrl(c)});c.send(200,{ok:1,to:c.u.email})}catch(e){c.send(400,{e:'Slanje nije uspjelo: '+e.message})}});
R('POST','/api/users/:id/sendlogin',2,async c=>{const u=db.users.find(x=>x.id===c.p[0]&&!x.deleted);if(!u)return c.send(404,{e:'Korisnik nije pronađen.'});
  if(u.disabled)return c.send(400,{e:'Prijava ovog korisnika je onemogućena. Prvo je omogućite.'});
  if(!u.email)return c.send(400,{e:'Korisnik nema upisan e-mail.'});
  const M=mailer();if(M.err)return c.send(400,{e:M.err});
  const pw=genPw(),url=appUrl(c);
  const text='Poštovani/a '+u.name+',\n\nevo vaših podataka za prijavu u aplikaciju za evidenciju radnog vremena:\n\nAdresa: '+url+'\nKorisničko ime: '+u.username+'\nLozinka: '+pw+'\n\nNakon prve prijave promijenite lozinku (gumb „Lozinka“ na početnoj stranici).\nNa mobitelu adresu možete dodati na početni zaslon (Chrome: izbornik → Dodaj na početni zaslon; iPhone: Dijeli → Dodaj na početni zaslon).\n\nOva poruka je poslana automatski. Ako je niste očekivali, javite se administratoru.';
  try{await M.t.sendMail({from:M.from,to:u.email,subject:'Pristup aplikaciji Evidencija radnog vremena',text})}catch(e){return c.send(400,{e:'Slanje nije uspjelo, lozinka nije promijenjena: '+e.message})}
  u.salt=crypto.randomBytes(16).toString('hex');u.hash=hash(pw,u.salt);u.loginSent=Date.now();save();c.send(200,{ok:1,to:u.email})});
R('POST','/api/users/:id/purge',2,c=>{const u=db.users.find(x=>x.id===c.p[0]);
  if(!u||u.purged)return c.send(404,{e:'Nije pronađeno.'});if(!u.deleted)return c.send(400,{e:'Trajno se može obrisati samo prethodno izbrisan korisnik.'});
  /* ime ostaje zbog evidencije (unosi, izvještaji), sve ostalo se briše; korisnik se više nigdje ne nudi */
  u.purged=Date.now();u.email='';delete u.salt;delete u.hash;delete u.loginSent;save();c.send(200,{ok:1})});
R('GET','/api/users',2,c=>c.send(200,db.users.filter(u=>!u.purged).map(({id,name,username,role,email,disabled,deleted,loginSent})=>({id,name,username:deleted?'':username,role,email,disabled:!!disabled,deleted:deleted||0,loginSent:loginSent||0}))));
R('POST','/api/users',2,c=>{const b=c.b,un=String(b.username||'').trim().toLowerCase(),pw=String(b.password||'');
  if(!String(b.name||'').trim()||!un||pw.length<6)return c.send(400,{e:'Unesite ime i prezime, korisničko ime i lozinku (min. 6 znakova).'});
  if(db.users.some(u=>u.username===un))return c.send(400,{e:'Korisničko ime već postoji.'});
  addUser(String(b.name).trim(),un,pw,b.role==='admin'?'admin':'user',String(b.email||'').trim());save();c.send(200,{ok:1})});
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
  if(b.role!==undefined&&u.id===c.u.id&&(b.role==='admin'?'admin':'user')!==u.role)return bad('Ne možete promijeniti vlastitu ulogu.');
  if(b.password){u.salt=crypto.randomBytes(16).toString('hex');u.hash=hash(String(b.password),u.salt)}
  if(b.name!==undefined)u.name=String(b.name).trim().slice(0,100);if(un!==undefined)u.username=un;if(em!==undefined)u.email=em;
  if(b.disabled!==undefined)u.disabled=!!b.disabled;if(b.role!==undefined&&u.id!==c.u.id)u.role=b.role==='admin'?'admin':'user';
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
R('GET','/api/sitehours',2,c=>vp(c.q.period)?c.send(200,core.siteHours(c.q.period,String(c.q.site||''))):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/sitehours.csv',2,c=>vp(c.q.period)?c.raw(200,core.siteCsv(c.q.period,String(c.q.site||'')),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sati-po-gradilistima-'+c.q.period+'.csv"'}):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/sitehours.xlsx',2,c=>vp(c.q.period)?c.raw(200,Buffer.from(core.siteXlsx(c.q.period,String(c.q.site||''))),{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="sati-po-gradilistima-'+c.q.period+'.xlsx"'}):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/stats',2,c=>/^\d{4}(-\d{2})?$/.test(c.q.period||'')?c.send(200,core.stats(c.q.period,todayStr())):c.send(400,{e:'Neispravno razdoblje.'}));
R('GET','/api/report',2,c=>valid(c.q.month)?c.send(200,core.report(c.q.month,flt(c.q),todayStr())):c.send(400,{e:'Neispravan mjesec.'}));
R('GET','/api/report.csv',2,c=>{if(!valid(c.q.month))return c.send(400,{e:'Neispravan mjesec.'});const k=['sum','day','site','det','sl','mis'].includes(c.q.kind)?c.q.kind:'sum';
  c.raw(200,core.csv(c.q.month,k,flt(c.q),todayStr()),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+({det:'unosi-',day:'sati-po-danima-',site:'po-gradilistima-',sl:'slobodni-dani-',mis:'bez-unosa-'}[k]||'sazetak-')+c.q.month+'.csv"'})});
R('GET','/api/report.xlsx',2,c=>valid(c.q.month)?c.raw(200,Buffer.from(core.xlsx(c.q.month,flt(c.q),todayStr())),{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="izvjestaj-'+c.q.month+'.xlsx"'}):c.send(400,{e:'Neispravan mjesec.'}));
R('POST','/api/report/send',2,async c=>{if(!valid(c.b.month))return c.send(400,{e:'Neispravan mjesec.'});
  try{c.send(200,{msg:await mail(c.b.month)})}catch(e){c.send(500,{e:'Slanje nije uspjelo: '+e.message})}});

http.createServer((req,res)=>{
  const url=new URL(req.url,'http://x');
  const raw=(code,t,h)=>{res.writeHead(code,h||{});res.end(t)};
  const send=(code,o,h)=>raw(code,JSON.stringify(o),{'Content-Type':'application/json; charset=utf-8',...h});
  if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html'))
    return raw(200,fs.readFileSync(path.join(__dirname,'public','index.html')),{'Content-Type':'text/html; charset=utf-8'});
  if(req.method==='GET'&&url.pathname==='/logo.png')
    return raw(200,fs.readFileSync(path.join(__dirname,'public','logo.png')),{'Content-Type':'image/png','Cache-Control':'public, max-age=86400'});
  if(req.method==='GET'&&url.pathname==='/core.js')
    return raw(200,fs.readFileSync(path.join(__dirname,'core.js')),{'Content-Type':'application/javascript; charset=utf-8'});
  let body='';req.on('data',d=>{body+=d;if(body.length>1e6)req.destroy()});
  req.on('end',()=>{
    for(const [m,re,auth,fn] of routes){
      const x=m===req.method&&re.exec(url.pathname);if(!x)continue;
      let b={};try{b=body?JSON.parse(body):{}}catch(e){return send(400,{e:'Neispravan zahtjev.'})}
      const c={b,p:x.slice(1),q:Object.fromEntries(url.searchParams),h:req.headers,send,raw,ip:clientIp(req)};
      if(auth){const t=/(?:^|;\s*)t=([^;]+)/.exec(req.headers.cookie||'');
        if(t&&sign(t[1].split('.')[0])===t[1])c.u=db.users.find(u=>u.id===t[1].split('.')[0]);
        if(c.u&&(c.u.disabled||c.u.deleted))return send(401,{e:'Račun je onemogućen. Obratite se administratoru.'});
        if(!c.u)return send(401,{e:'Prijavite se.'});
        if(auth===2&&c.u.role!=='admin')return send(403,{e:'Samo za administratore.'})}
      return Promise.resolve(fn(c)).catch(e=>{console.error(e);send(500,{e:'Greška na serveru.'})});
    }
    send(404,{e:'Nije pronađeno.'});
  });
}).listen(PORT,()=>console.log('Aplikacija radi na http://localhost:'+PORT));
