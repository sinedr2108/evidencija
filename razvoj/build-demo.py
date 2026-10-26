import re
import os,sys
# Upotreba: python3 build-demo.py [putanja/do/evidencija] [izlaz.html]
P=(sys.argv[1] if len(sys.argv)>1 else os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','evidencija')).rstrip('/')+'/'
src=open(P+'public/index.html',encoding='utf-8').read()
core=open(P+'core.js',encoding='utf-8').read()
style=re.search(r'<style>(.*?)</style>',src,re.S).group(1)
body=src[src.index('<body>')+6:src.index('</body>')]
script=re.search(r'<script>(.*)</script>',body,re.S).group(1)
html=body[:body.index('<script>')].replace('<script src="/core.js"></script>','')
html=html.replace('<main>','',1).replace('</main>','')

# CSS tokeni
style=re.sub(r':root\{--bg:.*?\n@media \(prefers-color-scheme:dark\)\{:root\{.*?\}\}\n','',style,count=1,flags=re.S)
tokens='''
:root{--pu:#7c3aed;--gy:#52525b;--rd:#dc2626;--rdx:#fff;--yl:#eab308;--gr:#16a34a;--grx:#ffffff;--sh:#2563eb;--shx:#ffffff;--bg:#f5f5f2;--card:#ffffff;--tx:#1d1d1b;--mu:#6b6b66;--ac:#d97706;--acx:#ffffff;--bd:#dcdcd6;--ok:#15803d;--er:#b91c1c}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--pu:#8b5cf6;--gy:#71717a;--rd:#f87171;--rdx:#2a0a0a;--yl:#facc15;--gr:#4ade80;--grx:#052e16;--sh:#60a5fa;--shx:#0b1220;--bg:#171716;--card:#242422;--tx:#f0f0ec;--mu:#a3a39c;--bd:#3a3a37;--ok:#4ade80;--er:#f87171;color-scheme:dark}}
:root[data-theme="dark"]{--pu:#8b5cf6;--gy:#71717a;--rd:#f87171;--rdx:#2a0a0a;--yl:#facc15;--gr:#4ade80;--grx:#052e16;--sh:#60a5fa;--shx:#0b1220;--bg:#171716;--card:#242422;--tx:#f0f0ec;--mu:#a3a39c;--bd:#3a3a37;--ok:#4ade80;--er:#f87171;color-scheme:dark}
'''
style=tokens+style
def srep(o,n):
    global style
    assert o in style,o[:60]
    style=style.replace(o,n)
srep('main{max-width:720px;margin:0 auto;padding:max(14px,env(safe-area-inset-top)) 14px 40px}',
 'main{max-width:720px;margin:0 auto;padding-block:14px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}')
style=style.replace('color:#fff','color:var(--acx)')
style=re.sub(r'@media print\{[^\n]*\}\n','',style)
style+='''
.demo{background:var(--card);border:1px dashed var(--ac);border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:12px}
.who button{width:100%;text-align:left;margin-top:8px;padding:14px}
input:focus-visible,select:focus-visible,button:focus-visible{outline:2px solid var(--ac);outline-offset:2px}
'''
# fiksne pozicije bez inset
style=re.sub(r'inset:0','top:0;left:0;right:0;bottom:0',style)
style=re.sub(r'(#note\{[^}]*?)left:14px;right:14px',r'\1left:max(16px,env(safe-area-inset-left,0px));right:max(16px,env(safe-area-inset-right,0px))',style)

# HTML
html=re.sub(r'<!--LOGIN-->.*?<!--/LOGIN-->','''<section id="login" class="card hide who" style="margin-top:24px">
 <h1><span style="color:#e84645">TiD</span>y Connect</h1>
 <div class="demo">Demo za isprobavanje. Nema pravog servera ni e-maila, a podaci se spremaju samo u ovom pregledniku. Primjerni unosi su izmišljeni.</div>
 <div class="mu">Uđite kao:</div>
 <button class="sm" data-u="ivan">Radnik: Ivan Horvat</button>
 <button class="sm" data-u="marko">Radnik: Marko Kovač</button>
 <button class="sm" data-u="admin">Administrator</button>
 <button class="sm" id="reset" style="margin-top:18px;width:auto">Vrati početne primjere</button>
 <div class="msg" id="lm"></div>
</section>''',html,count=1,flags=re.S)
html=html.replace('<button class="sm" id="pw">Lozinka</button>','')
html=html.replace('<button class="sm" id="pr">Ispiši</button>','')

def blk(name,new):
    global script
    pat=re.compile(r'/\*'+name+r'\*/.*?(?:/\*/'+name+r'\*/|(?=\n))',re.S)
    assert name=='API' or name=='LOGIN' or name=='EXPORT' or name=='BOOT'
    m=re.search(r'/\*'+name+r'\*/.*?/\*/'+name+r'\*/',script,re.S); assert m,name
    script=script[:m.start()]+new+script[m.end():]
def rep(o,n):
    global script
    assert o in script,o[:70]
    script=script.replace(o,n)

blk('LOGIN','')
rep("$('pw').onclick=async()=>{","if($('pw'))$('pw').onclick=async()=>{") if False else None
# ukloni pw handler (cijeli blok do sljedećeg $('...').onclick na novoj liniji)
m=re.search(r"\$\('pw'\)\.onclick=[^\n]*\n[^\n]*\n",script)
assert m
script=script[:m.start()]+script[m.end():]
rep("$('pr').onclick=()=>print();\n","")
blk('EXPORT',"""async function doExport(kind){const m=$('rm').value;if(!/^\\d{4}-\\d{2}$/.test(m))return;const f={uid:$('fw').value,site:$('fs').value,vrsta:$('fv').value},t=todayStr();
 const nm=kind==='xlsx'?'izvjestaj-'+m+'.xlsx':({det:'unosi-',day:'sati-po-danima-',site:'po-gradilistima-',mis:'bez-unosa-',sum:'sazetak-'}[kind]||'sazetak-')+m+'.csv';
 try{const d=await claude.use('downloads');if(!d){toast('Preuzimanje nije dostupno u ovom prikazu.');return}
  await d.save({filename:nm,data:kind==='xlsx'?core().xlsx(m,f,t):core().csv(m,kind,f,t)})}catch(e){toast('Preuzimanje nije uspjelo.')}}""")
blk('BOOT',"showLogin();")

mock=r'''
/* ===== Demo: lažni server u pregledniku ===== */
const KEY='evidencija-demo-v4';let db=null,cur=null,_c=null;
const VRSTE=Core.VRSTE;
const clone=o=>JSON.parse(JSON.stringify(o));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const pad2=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())};
const core=()=>_c||(_c=Core(db));
const flt=q=>({uid:String(q.uid||''),site:String(q.site||''),vrsta:String(q.vrsta||'')});
function seed(){
 const d=new Date(),y=d.getFullYear(),m=pad2(d.getMonth()+1),t=d.getDate(),meals=['Vlastiti trošak','Restoran 1','Restoran 2','Restoran 3','Ostali restorani'],sites=['Ugljan','Granosta','Hidropneumat'];
 const S={users:[{id:'u_admin',name:'Administrator',username:'admin',role:'admin',email:'uprava@primjer.hr'},{id:'u_ivan',name:'Ivan Horvat',username:'ivan',role:'user',email:''},{id:'u_marko',name:'Marko Kovač',username:'marko',role:'user',email:''}],
  entries:[],closed:[],requests:[],prijenos:{},slreq:[],godisnji:{},gorq:[],obav:[],sites:sites.slice(),meals:meals.slice()};
 const add=(u,date,o)=>S.entries.push(Object.assign({id:uid(),uid:u,date,site:'',vrsta:'Redovan rad',hours:8,meal:'',teren:0,ts:Date.now()+S.entries.length},o));
 for(let i=1;i<t;i++){const dt=new Date(y,d.getMonth(),i),w=dt.getDay();if(w===0||w===6)continue;const ds=y+'-'+m+'-'+pad2(i);
  if(i%9===4)add('u_ivan',ds,{vrsta:'Bolovanje'});
  else if(i%7===2){add('u_ivan',ds,{site:'Ugljan',hours:5,meal:meals[i%5],teren:i%2});add('u_ivan',ds,{site:'Granosta',hours:4})}
  else if(i%8!==5)add('u_ivan',ds,{site:sites[i%2],meal:meals[i%5]});
  if(i%10===6)add('u_marko',ds,{vrsta:'Godišnji odmor'});
  else add('u_marko',ds,{site:sites[(i+1)%3],hours:i%3===0?9:8,meal:meals[(i+2)%5],teren:i%4===0?1:0})}

 const Y=y;S.godisnji['u_ivan|'+Y]={ukupno:20,pocetno:3};S.godisnji['u_marko|'+Y]={ukupno:22,pocetno:0};
 const nx=new Date(y,d.getMonth(),t+7);let a=new Date(nx);while(a.getDay()===0||a.getDay()===6)a.setDate(a.getDate()+1);const ds=a.getFullYear()+'-'+pad2(a.getMonth()+1)+'-'+pad2(a.getDate());
 S.gorq.push({id:uid(),uid:'u_marko',dates:[ds],reason:'Odobreno od administratora',ts:Date.now(),status:'approved',source:'admin',decided:Date.now(),decidedBy:'u_admin',note:''});
 S.obav.push({id:uid(),uid:'u_marko',text:'Administrator vam je odobrio godišnji odmor: '+ds.slice(8,10)+'.'+ds.slice(5,7)+'.'+ds.slice(0,4)+'. (1 dan). Opcija Godišnji odmor otključana je za taj dan.',ts:Date.now(),read:false});
 return S}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){}}
function initDb(){db=null;_c=null;try{const s=localStorage.getItem(KEY);if(s)db=JSON.parse(s)}catch(e){}if(!db){db=seed();persist()}}
initDb();
/* demo: fotografije otpremnica samo u memoriji (ne preživljavaju ponovno otvaranje) */
const DF={};fotoSrc=f=>DF[f]||'';fotoDl=f=>DF[f]||'';db.otpremnice=[];
const strs=a=>[...new Set((Array.isArray(a)?a:[]).map(s=>String(s).trim()).filter(Boolean))];
const mon=m=>/^\d{4}-\d{2}$/.test(m||'');
const fail=t=>{throw new Error(t)};
/* demo: aktivnosti radnika za administratora (samo u memoriji) */
let DAn=0;const DA=[],DAT={'POST entries':'Novi unos radnog vremena','PUT entries':'Izmjena unosa radnog vremena','DELETE entries':'Obrisan unos radnog vremena','POST close':'Završen mjesec','POST slreq':'Zahtjev za slobodan dan','POST gorq':'Zahtjev za godišnji odmor','POST requests':'Zahtjev za ponovno otvaranje mjeseca','POST sitereq':'Zahtjev za novo gradilište','DELETE slreq':'Povučen zahtjev za slobodan dan','DELETE gorq':'Povučen zahtjev za godišnji odmor','DELETE requests':'Povučen zahtjev za otvaranje mjeseca','DELETE sitereq':'Povučen zahtjev za novo gradilište','POST otpremnice':'Nova otpremnica','POST otpremnice/odgovor':'Odgovor na pitanje o otpremnici','DELETE otpremnice':'Obrisana otpremnica','POST password':'Promjena lozinke'};
const demoAkt=(u,t,d)=>{DA.push({id:++DAn,ts:Date.now(),uid:u.id,name:u.name,t,d,login:t==='Prijava u aplikaciju'});if(DA.length>300)DA.shift()};
function linkSl(e){db.slreq.forEach(q=>{if(q.entryId===e.id)q.entryId=null});if(e.vrsta!=='Slobodan dan')return;const m=e.date.slice(0,7),mine=db.entries.filter(x=>x.uid===e.uid&&x!==e);
 if(core().bank(mine,m,core().pr(e.uid,m))<8){const ap=core().approval(e.uid,e.date,null);if(ap)ap.entryId=e.id}}
async function api(m,u,b){b=b||{};const [p,qs]=u.split('?'),Q=Object.fromEntries(new URLSearchParams(qs||'')),s=p.split('/'),key=m+' '+s[0]+(s[1]&&(s[0]==='report')?'/'+s[1]:'');
 if(key==='POST login'){const x=db.users.find(z=>z.username===String(b.username||'').toLowerCase());if(!x)fail('Nepoznat korisnik.');if(x.disabled||x.deleted)fail('Račun je onemogućen. Obratite se administratoru.');cur=x.id;if(x.role==='user')demoAkt(x,'Prijava u aplikaciju','');return{ok:1}}
 if(key==='POST logout'){cur=null;return{ok:1}}
 const U=db.users.find(z=>z.id===cur);if(!U||U.disabled||U.deleted){cur=null;showLogin();fail('Prijavite se.')}
 const C=core(),adm=()=>{if(U.role!=='admin')fail('Samo za administratore.')},noAdm=()=>{if(U.role==='admin')fail('Administratori ne unose radno vrijeme.')};
 const own=id=>db.entries.find(x=>x.id===id&&x.uid===U.id)||fail('Unos nije pronađen.');
 const locked=e=>{if(db.closed.includes(U.id+'|'+e.date.slice(0,7)))fail('Taj je mjesec završen.')};
 let out={ok:1};
 if(key==='GET me')out={id:U.id,name:U.name,role:U.role,sites:db.sites,meals:db.meals,vrste:VRSTE};
 else if(key==='GET data'){const a=U.role==='admin';out={entries:db.entries.filter(e=>a||e.uid===U.id).map(e=>({...e,vrsta:e.vrsta||'Redovan rad',name:C.nameOf(e.uid)})),closed:db.closed.filter(k=>a||k.startsWith(U.id+'|')),requests:db.requests.filter(r=>a||r.uid===U.id).map(r=>({...r,name:C.nameOf(r.uid)})),slreq:db.slreq.filter(q=>a||q.uid===U.id).map(q=>({...q,name:C.nameOf(q.uid)})),prijenos:Object.fromEntries(Object.entries(db.prijenos).filter(([k])=>a||k.startsWith(U.id+'|'))),gorq:db.gorq.filter(q=>a||q.uid===U.id).map(q=>({...q,name:C.nameOf(q.uid)})),obav:a?[]:db.obav.filter(o=>o.uid===U.id&&!o.read&&(!o.until||o.until>=todayStr())),sitereq:db.sitereq.filter(r=>a||r.uid===U.id).map(r=>({...r,name:C.nameOf(r.uid)})),siteNews:a?[]:db.siteNews.filter(n=>n.ts>(U.siteSeen||0)).map(n=>n.site),poruke:a?db.poruke.slice().sort((x,y)=>y.ts-x.ts).map(p=>({...p,fromName:C.nameOf(p.from),toNames:Object.fromEntries(p.to.map(id=>[id,C.nameOf(id)]))})):db.poruke.filter(p=>p.to.includes(U.id)&&!p.reads[U.id]).map(p=>({id:p.id,text:p.text,ts:p.ts,fromName:C.nameOf(p.from)})),go:a?null:C.goStats(U.id,new Date().getFullYear()),godatumi:a?[]:[...C.goDates(U.id)]}}
 else if(key==='POST entries'){noAdm();const er=C.check(U,b);if(er)fail(er);const e={id:uid(),uid:U.id,...C.rec(b),ts:Date.now()};db.entries.push(e);linkSl(e);out=e}
 else if(key==='PUT entries'){noAdm();const e=own(s[1]);locked(e);const er=C.check(U,b,e.id);if(er)fail(er);Object.assign(e,C.rec(b));linkSl(e);out=e}
 else if(key==='DELETE entries'){noAdm();const e=own(s[1]);locked(e);{const m=e.date.slice(0,7),mine=db.entries.filter(x=>x.uid===U.id),aft=C.bank(mine.filter(x=>x!==e),m,C.pr(U.id,m));if(aft<0&&aft<C.bank(mine,m,C.pr(U.id,m)))fail('Brisanje nije moguće jer je slobodan dan već iskorišten, pa bi Sati za slobodan dan postali negativni.')}db.slreq.forEach(q=>{if(q.entryId===e.id)q.entryId=null});db.entries=db.entries.filter(x=>x!==e)}
 else if(key==='POST close'){noAdm();if(!mon(b.month))fail('Neispravan mjesec.');{const md=C.missingDays(U.id,b.month);if(md.length)fail('Unos se ne može završiti. Nedostaje unos za: '+md.map(d=>d.slice(8,10)+'.'+d.slice(5,7)+'.').join(', ')+'.')}const k=U.id+'|'+b.month;if(!db.closed.includes(k))db.closed.push(k)}
 else if(key==='POST reopen'){adm();db.closed=db.closed.filter(k=>k!==b.uid+'|'+b.month)}
 else if(m==='POST'&&s[2]==='change'&&['slreq','gorq','requests'].includes(s[0])){adm();const kind=s[0],q=db[kind].find(x=>x.id===s[1]);if(!q||q.status==='open')fail('Zahtjev nije pronađen ili još nije riješen.');const ap=!!b.approve,now=ap?'approved':'rejected';if(q.status===now)fail('Zahtjev već ima tu odluku.');{const ev=kind==='slreq'?q.date:kind==='gorq'?q.dates[0]:'';if(ev&&todayStr()>ev)fail('Datum na koji se zahtjev odnosi ('+C.dfmt(ev)+') je prošao, pa se odluka više ne može mijenjati.')}let txt;
  if(kind==='slreq'){if(!ap&&q.entryId)fail('Radnik je već iskoristio taj slobodan dan, odluka se ne može promijeniti.');txt='Zahtjev za slobodan dan ('+C.dfmt(q.date)+')'}
  else if(kind==='gorq'){const sp=q.dates.length===1?C.dfmt(q.dates[0]):C.dfmt(q.dates[0])+' – '+C.dfmt(q.dates[q.dates.length-1]);if(!ap&&db.entries.some(e=>e.uid===q.uid&&e.vrsta==='Godišnji odmor'&&q.dates.includes(e.date)))fail('Radnik je već upisao godišnji odmor za neke od tih dana, odluka se ne može promijeniti.');if(ap){const tk=new Set(db.gorq.filter(x=>x!==q&&x.uid===q.uid&&x.status==='approved').flatMap(x=>x.dates));if(q.dates.some(d=>tk.has(d)))fail('Za neke od tih dana već postoji odobrenje.')}txt='Zahtjev za godišnji odmor ('+sp+')'}
  else{const k=q.uid+'|'+q.month;if(ap)db.closed=db.closed.filter(x=>x!==k);else if(!db.closed.includes(k))db.closed.push(k);txt='Zahtjev za ponovno otvaranje mjeseca '+q.month}
  const note=String(b.note||'').trim().slice(0,200);q.status=now;q.note=note;q.decided=Date.now();q.decidedBy=U.id;q.changed=Date.now();delete q.seen;C.notify(q.uid,'Administrator je izmijenio odluku. '+txt+': '+(ap?'PRIHVAĆEN':'ODBIJEN')+(note?' ('+note+')':'')+'.',kind==='slreq'?q.date:kind==='gorq'?q.dates[q.dates.length-1]:todayStr())}
 else if(m==='POST'&&s[0]==='requests'&&s[2]==='decide'){adm();const r=db.requests.find(x=>x.id===s[1]);if(!r||r.status!=='open')fail('Zahtjev nije pronađen ili je već riješen.');r.status=b.approve?'approved':'rejected';r.note=String(b.note||'').trim().slice(0,200);r.decided=Date.now();r.decidedBy=U.id;if(b.approve)db.closed=db.closed.filter(k=>k!==r.uid+'|'+r.month)}
 else if(key==='POST requests'){noAdm();const mm=String(b.month||'');if(!mon(mm))fail('Neispravan mjesec.');if(!db.closed.includes(U.id+'|'+mm))fail('Taj mjesec nije završen, pa ga možete mijenjati.');if(db.requests.some(r=>r.uid===U.id&&r.month===mm&&r.status==='open'))fail('Zahtjev za taj mjesec već je poslan.');db.requests.push({id:uid(),uid:U.id,month:mm,reason:String(b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open'})}
 else if(key==='GET stats'){adm();out=C.stats(Q.period,todayStr())}
 else if(key==='GET sitehours'){adm();out=C.siteHours(Q.period,Q.site||'')}
 else if(key==='GET godisnji'){adm();const y=parseInt(Q.year)||new Date().getFullYear();out=db.users.filter(z=>z.role==='user'&&!z.deleted).map(z=>({uid:z.id,name:z.name,...C.goStats(z.id,y)})).sort((a,b)=>a.name.localeCompare(b.name,'hr'))}
 else if(key==='PUT godisnji'){adm();const x=db.users.find(z=>z.id===b.uid&&z.role==='user'),y=parseInt(b.year),uk=parseFloat(String(b.ukupno).replace(',','.')),po=parseFloat(String(b.pocetno).replace(',','.'));if(!x)fail('Radnik nije pronađen.');if(!(uk>=0&&uk<=366)||!(po>=0&&po<=366))fail('Unesite broj dana između 0 i 366.');db.godisnji[x.id+'|'+y]={ukupno:uk,pocetno:po}}
 else if(key==='POST gorq'&&s[1]==='grupa'){adm();const dates=C.rangeDates(String(b.from||''),b.to?String(b.to):'');if(!dates)fail('Neispravan raspon datuma (najviše 92 dana).');if(!dates.length)fail('Odabrani datumi nisu radni dani.');const ids=[...new Set(Array.isArray(b.uids)?b.uids:[])].filter(id=>db.users.some(z=>z.id===id&&z.role==='user'));if(!ids.length)fail('Odaberite barem jednog radnika.');
  const sp=q=>q.dates.length===1?C.dfmt(q.dates[0]):C.dfmt(q.dates[0])+' – '+C.dfmt(q.dates[q.dates.length-1]);
  ids.forEach(id=>{const q={id:uid(),uid:id,dates,reason:String(b.note||'').trim().slice(0,200),ts:Date.now(),status:'approved',source:'admin',decided:Date.now(),decidedBy:U.id,note:''};db.gorq.push(q);C.notify(id,'Administrator vam je odobrio godišnji odmor: '+sp(q)+' ('+dates.length+' dana). Opcija Godišnji odmor otključana je za te dane.',dates[dates.length-1])});out={ok:1,radnika:ids.length,dana:dates.length}}
 else if(m==='POST'&&s[0]==='gorq'&&s[2]==='decide'){adm();const q=db.gorq.find(x=>x.id===s[1]);if(!q||q.status!=='open')fail('Zahtjev nije pronađen ili je već riješen.');const sp=q.dates.length===1?C.dfmt(q.dates[0]):C.dfmt(q.dates[0])+' – '+C.dfmt(q.dates[q.dates.length-1]);q.status=b.approve?'approved':'rejected';q.note=String(b.note||'').trim().slice(0,200);q.decided=Date.now();q.decidedBy=U.id;C.notify(q.uid,b.approve?'Zahtjev za godišnji odmor prihvaćen: '+sp+' ('+q.dates.length+' dana). Opcija Godišnji odmor otključana je za te dane.':'Zahtjev za godišnji odmor odbijen: '+sp+(q.note?' ('+q.note+')':'')+'.',q.dates[q.dates.length-1])}
 else if(key==='POST gorq'){noAdm();const dates=C.rangeDates(String(b.from||''),b.to?String(b.to):'');if(!dates)fail('Neispravan raspon datuma (najviše 92 dana).');if(!dates.length)fail('Odabrani datumi nisu radni dani.');if(dates.some(d=>db.closed.includes(U.id+'|'+d.slice(0,7))))fail('Neki od dana nalaze se u završenom mjesecu.');const taken=new Set(db.gorq.filter(q=>q.uid===U.id&&(q.status==='open'||q.status==='approved')).flatMap(q=>q.dates));if(dates.some(d=>taken.has(d)))fail('Za neke od tih dana već postoji zahtjev ili odobrenje.');db.gorq.push({id:uid(),uid:U.id,dates,reason:String(b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open',source:'zahtjev'});out={ok:1,dana:dates.length}}
 else if(key==='POST seen'){noAdm();for(const q of db.slreq.concat(db.gorq,db.requests))if(q.uid===U.id&&q.status!=='open'&&!q.seen)q.seen=Date.now()}
 else if(m==='DELETE'&&['slreq','gorq','requests','sitereq'].includes(s[0])){noAdm();const l=db[s[0]],i=l.findIndex(x=>x.id===s[1]&&x.uid===U.id);if(i<0)fail('Zahtjev nije pronađen.');if(l[i].status!=='open')fail('Zahtjev je već riješen i ne može se povući.');l.splice(i,1)}
 else if(key==='POST poruke'&&s[2]==='read'){const p=db.poruke.find(x=>x.id===s[1]&&x.to.includes(U.id))||fail('Poruka nije pronađena.');if(!p.reads[U.id])p.reads[U.id]=Date.now()}
 else if(key==='POST poruke'){adm();const t=String(b.text||'').trim().slice(0,2000);if(!t)fail('Upišite tekst poruke.');const act=db.users.filter(u=>u.role==='user'&&!u.deleted&&!u.disabled).map(u=>u.id);const to=b.all?act:[...new Set(Array.isArray(b.uids)?b.uids:[])].filter(id=>act.includes(id));if(!to.length)fail('Odaberite barem jednog radnika.');db.poruke.push({id:uid(),from:U.id,text:t,ts:Date.now(),to,all:!!b.all,reads:{}});out={ok:1,n:to.length}}
 else if(key==='DELETE poruke'){adm();const i=db.poruke.findIndex(x=>x.id===s[1]);if(i<0)fail('Poruka nije pronađena.');db.poruke.splice(i,1)}
 else if(key==='POST sitenews'){U.siteSeen=Date.now()}
 else if(key==='POST sitereq'&&s[2]==='decide'){adm();const q=db.sitereq.find(x=>x.id===s[1]&&x.status==='open')||fail('Zahtjev nije pronađen ili je već riješen.');q.decided=Date.now();q.decidedBy=U.id;if(b.approve){const nm=String(b.name||'').trim();if(!nm)fail('Upišite naziv gradilišta.');if(!db.sites.includes(nm)){db.sites.push(nm);db.siteNews.push({site:nm,ts:Date.now()})}q.status='approved';q.site=nm}else{q.status='rejected';q.note=String(b.note||'').trim();C.notify(q.uid,'Zahtjev za novo gradilište „'+q.text+'“ je odbijen'+(q.note?' ('+q.note+')':'')+'.','')}}
 else if(key==='POST sitereq'){noAdm();const t=String(b.text||'').trim().slice(0,200);if(!t)fail('Upišite opisni naziv gradilišta.');db.sitereq.push({id:uid(),uid:U.id,text:t,ts:Date.now(),status:'open'})}
 else if(key==='POST obav'){db.obav.forEach(o=>{if(o.uid===U.id)o.read=true});db.gorq.forEach(q=>{if(q.uid===U.id&&q.source==='admin'&&!q.seen)q.seen=Date.now()})}
 else if(key==='PUT prijenos'){adm();const x=db.users.find(z=>z.id===b.uid&&z.role==='user'),v=parseFloat(String(b.value).replace(',','.'));if(!x)fail('Radnik nije pronađen.');if(!mon(b.month))fail('Neispravan mjesec.');if(!isFinite(v)||Math.abs(v)>1000)fail('Unesite broj sati (može biti negativan).');const k=x.id+'|'+b.month;if(v===0)delete db.prijenos[k];else db.prijenos[k]=Math.round(v*100)/100}
 else if(m==='POST'&&s[0]==='slreq'&&s[2]==='decide'){adm();const q=db.slreq.find(x=>x.id===s[1]);if(!q||q.status!=='open')fail('Zahtjev nije pronađen ili je već riješen.');q.status=b.approve?'approved':'rejected';q.note=String(b.note||'').trim().slice(0,200);q.decided=Date.now();q.decidedBy=U.id}
 else if(key==='POST slreq'){noAdm();const d=String(b.date||''),mm=d.slice(0,7);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))fail('Odaberite datum slobodnog dana.');if(db.closed.includes(U.id+'|'+mm))fail('Taj je mjesec završen.');if(C.bank(db.entries.filter(x=>x.uid===U.id),mm,C.pr(U.id,mm))>=8)fail('Imate barem 8 sati za slobodan dan, zahtjev nije potreban.');if(db.slreq.some(q=>q.uid===U.id&&q.date===d&&(q.status==='open'||(q.status==='approved'&&!q.entryId))))fail('Za taj datum već postoji zahtjev.');db.slreq.push({id:uid(),uid:U.id,date:d,reason:String(b.reason||'').trim().slice(0,200),ts:Date.now(),status:'open',entryId:null})}
 else if(key==='PUT config'){adm();const sl0=strs(b.sites);sl0.filter(x=>!db.sites.includes(x)).forEach(x=>db.siteNews.push({site:x,ts:Date.now()}));const sl=sl0,ml=[...new Set(strs(b.meals).map(x=>db.meals.includes(x)?x:x.toLocaleUpperCase('hr-HR')))];if(!ml.length)fail('Mora ostati barem jedna opcija obroka.');db.sites=sl;db.meals=ml}
 else if(key==='GET smtp'){adm();const m=db.smtp||{};out={host:m.host||'',port:m.port||587,secure:!!m.secure,user:m.user||'',passSet:!!m.pass,from:m.from||'',appUrl:db.appUrl||'',detected:'https://sati.vasadomena.hr',env:false}}
 else if(key==='PUT smtp'){adm();const m=db.smtp=db.smtp||{},t=v=>String(v==null?'':v).trim();m.host=t(b.host);m.port=parseInt(b.port)||587;m.secure=!!b.secure;m.user=t(b.user);m.from=t(b.from);if(b.pass)m.pass='***';const u=t(b.appUrl);if(u&&!/^https?:\/\/\S+$/i.test(u))fail('Adresa aplikacije mora počinjati s https:// (npr. https://sati.vasadomena.hr).');db.appUrl=u}
 else if(key==='POST smtp'){adm();fail('U demu se e-mail ne šalje. Na vašem serveru ovdje stiže probna poruka.')}
 else if(m==='POST'&&s[0]==='users'&&s[2]==='sendlogin'){adm();const x=db.users.find(z=>z.id===s[1]&&!z.deleted)||fail('Korisnik nije pronađen.');if(x.disabled)fail('Prijava ovog korisnika je onemogućena. Prvo je omogućite.');if(!x.email)fail('Korisnik nema upisan e-mail.');x.loginSent=Date.now();out={ok:1,demo:true,to:x.email}}
 else if(m==='POST'&&s[0]==='users'&&s[2]==='purge'){adm();const x=db.users.find(z=>z.id===s[1]&&!z.purged)||fail('Nije pronađeno.');if(!x.deleted)fail('Trajno se može obrisati samo prethodno izbrisan korisnik.');x.purged=Date.now();x.email=''}
 else if(key==='GET users'){adm();out=db.users.filter(z=>!z.purged).map(({id,name,username,role,email,disabled,deleted,loginSent})=>({id,name,username:deleted?'':username,role,email,disabled:!!disabled,deleted:deleted||0,loginSent:loginSent||0}))}
 else if(key==='POST users'){adm();const un=String(b.username||'').trim().toLowerCase();if(!String(b.name||'').trim()||!un||String(b.password||'').length<6)fail('Unesite ime i prezime, korisničko ime i lozinku (min. 6 znakova).');if(db.users.some(z=>z.username===un))fail('Korisničko ime već postoji.');db.users.push({id:uid(),name:String(b.name).trim(),username:un,role:b.role==='admin'?'admin':'user',email:String(b.email||'').trim()})}
 else if(key==='PUT users'){adm();const x=db.users.find(z=>z.id===s[1])||fail('Nije pronađeno.');if(x.deleted)fail('Korisnik je izbrisan.');if(b.password&&String(b.password).length<6)fail('Lozinka mora imati barem 6 znakova.');if(b.name!==undefined&&!String(b.name).trim())fail('Upišite ime i prezime.');let un;if(b.username!==undefined){un=String(b.username).trim().toLowerCase();if(!un||/\s/.test(un)||/^~/.test(un))fail('Korisničko ime ne smije biti prazno ni sadržavati razmake.');if(db.users.some(z=>z!==x&&z.username===un))fail('Korisničko ime "'+un+'" već koristi drugi korisnik.')}let em;if(b.email!==undefined){em=String(b.email).trim();if(em&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em))fail('Neispravna e-mail adresa.')}if(b.disabled!==undefined&&x.id===U.id)fail('Ne možete onemogućiti sami sebe.');if(b.role!==undefined&&x.id===U.id&&(b.role==='admin'?'admin':'user')!==x.role)fail('Ne možete promijeniti vlastitu ulogu.');if(b.name!==undefined)x.name=String(b.name).trim();if(un!==undefined)x.username=un;if(em!==undefined)x.email=em;if(b.disabled!==undefined)x.disabled=!!b.disabled;if(b.role!==undefined&&x.id!==U.id)x.role=b.role==='admin'?'admin':'user'}
 else if(key==='DELETE users'){adm();if(s[1]===U.id)fail('Ne možete obrisati sami sebe.');const x=db.users.find(z=>z.id===s[1]);if(!x||x.deleted)fail('Nije pronađeno.');x.deleted=Date.now();x.disabled=true;x.username='~'+x.id;x.email='';for(const k of ['slreq','gorq','requests'])db[k]=db[k].filter(r=>!(r.uid===x.id&&r.status==='open'));db.obav=db.obav.filter(o=>o.uid!==x.id)}
 else if(key==='POST password'){fail('U demu se lozinka ne mijenja.')}
 else if(key==='GET rev'){out={rev:liveRev}}
 else if(key==='POST otpremnice'&&s[1]==='foto'){noAdm();const f='u-'+C.otpKey(U.id)+'-'+uid().replace(/[^0-9a-z]/g,'')+'.jpg';DF[f]=String(b.data||'');out={f}}
 else if(key==='PUT otpremnice'&&s[2]==='site'){adm();const r=C.otpSetSite(U,s[1],String(b.f||''),b.site);if(typeof r==='string')fail(r)}
 else if(key==='POST otpremnice'&&s[2]==='pitanje'){adm();const r=C.otpAsk(U,s[1],String(b.f||''),b.text);if(typeof r==='string')fail(r)}
 else if(key==='POST otpremnice'&&s[2]==='odgovor'){const r=C.otpAnswer(U,s[1],String(b.pid||''),b.text);if(typeof r==='string')fail(r)}
 else if(key==='POST otpremnice'){noAdm();const o=C.otpCheck(U,b,f=>!!DF[f]);if(typeof o==='string')fail(o);db.otpremnice.push(o)}
 else if(key==='GET otpremnice'){out={list:C.otpList(U,Q.od||'',Q.do||''),sites:U.role==='admin'?C.otpSitesAll():[]}}
 else if(key==='DELETE otpremnice'){const r=C.otpDelete(U,s[1]);if(typeof r==='string')fail(r);r.forEach(f=>delete DF[f])}
 else if(key==='GET inbox'){out=core().inbox(U.id)}
 else if(key==='DELETE inbox'){if(!core().inboxHide(U.id,s[1],s[2]))fail('Stavka nije pronađena.');out={ok:1}}
 else if(key==='GET report'){adm();if(!mon(Q.month))fail('Neispravan mjesec.');out=C.report(Q.month,flt(Q),todayStr())}
 else if(key==='POST report/send'){adm();if(!mon(b.month))fail('Neispravan mjesec.');const to=db.users.filter(z=>z.role==='admin'&&z.email).map(z=>z.email);out={msg:'Demo: e-mail se ovdje ne šalje. Na pravom serveru ide s Excel privitkom na: '+(to.join(', ')||'(nema upisanih adresa)')}}
 else if(key==='GET aktivnost'){adm();const sq=Q.b==='demo'?+Q.s||0:0;out={boot:'demo',seq:DA.length?DA[DA.length-1].id:0,list:DA.filter(a=>a.id>sq)}}
 else fail('Nepoznata radnja.');
 if(U&&U.role==='user'&&m!=='GET'){const t=DAT[key+(s[2]?'/'+s[2]:'')]||(s[1]!=='foto'&&DAT[key]);if(t)demoAkt(U,t,[b.date&&C.dfmt(b.date),b.from&&C.dfmt(b.from)+(b.to&&b.to!==b.from?' – '+C.dfmt(b.to):''),b.month,b.vrsta,b.site,b.hours!=null&&String(b.hours).replace('.',',')+' h',b.text,b.reason,b.note].filter(Boolean).join(' · '))}
 persist();return clone(out)}
async function dlSite(kind){const q=new URLSearchParams(shq()),per=q.get('period'),st=q.get('site')||'';const nm='sati-po-gradilistima-'+per+(kind==='xlsx'?'.xlsx':'.csv');
 try{const d=await claude.use('downloads');if(!d){toast('Preuzimanje nije dostupno u ovom prikazu.');return}await d.save({filename:nm,data:kind==='xlsx'?core().siteXlsx(per,st):core().siteCsv(per,st)})}catch(e){toast('Preuzimanje nije uspjelo.')}}
$('shx').onclick=()=>dlSite('xlsx');$('shc2').onclick=()=>dlSite('csv');
$('login').onclick=async e=>{const b=e.target.closest('button');if(!b)return;
 if(b.id==='reset'){if(!await cf('Vratiti početne primjere? Obrisat će se svi unosi napravljeni u demu.'))return;db=seed();_c=null;persist();say('lm','Vraćeni su početni primjeri.',1);return}
 if(b.dataset.u){try{await api('POST','login',{username:b.dataset.u});tab='unos';await load()}catch(x){say('lm',x.message)}}};
'''
# umetni mock nakon definicija (prije BOOT): na mjesto showLogin(); koje smo postavili
rep("showLogin();\n</script>" if "showLogin();\n</script>" in script else "showLogin();",mock+"\nshowLogin();") if False else None
idx=script.rindex("showLogin();")
script=script[:idx]+mock+"\nshowLogin();"+script[idx+len("showLogin();"):]
# stari fetch api je u API bloku: zamijeni
m=re.search(r'/\*API\*/.*?/\*/API\*/',script,re.S)
script=script[:m.start()]+script[m.end():]

import base64
html=html.replace('src="/logo.png"','src="data:image/png;base64,'+base64.b64encode(open(P+'public/logo.png','rb').read()).decode()+'"')
script+="\nsaveFile=async(name,data)=>{try{const d=await claude.use('downloads');if(!d){toast('Preuzimanje nije dostupno u ovom prikazu.');return}await d.save({filename:name,data})}catch(e){toast('Preuzimanje nije uspjelo.')}};\n"
out='<meta charset="utf-8">\n<title>TiDy Connect demo</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>'+style+'</style>\n<main>'+html+'</main>\n<script>'+core+'</script>\n<script>'+script+'</script>\n'
open(sys.argv[2] if len(sys.argv)>2 else 'evidencija-demo.html','w',encoding='utf-8').write(out)
print(len(out))
