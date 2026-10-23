'use strict';
/* Promjena zaboravljene lozinke bez brisanja podataka.
   Upotreba (dok je aplikacija zaustavljena):  node reset-admin.js admin NovaLozinka123 */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const [un,pw]=process.argv.slice(2),DB=path.join(__dirname,'data','db.json');
if(!un||!pw||pw.length<6){console.log('Upotreba: node reset-admin.js KORISNICKO_IME NOVA_LOZINKA (min. 6 znakova)');process.exit(1)}
if(!fs.existsSync(DB)){console.log('Nema podataka (data\\db.json). Pokrenite aplikaciju jednom.');process.exit(1)}
const db=JSON.parse(fs.readFileSync(DB,'utf8')),u=db.users.find(x=>x.username===un.toLowerCase()&&!x.deleted);
if(!u){console.log('Korisnik "'+un+'" ne postoji. Postojeći: '+db.users.filter(x=>!x.deleted).map(x=>x.username).join(', '));process.exit(1)}
fs.mkdirSync(path.join(__dirname,'data','backup'),{recursive:true});
fs.copyFileSync(DB,path.join(__dirname,'data','backup','db-prije-reset-'+Date.now()+'.json'));
u.salt=crypto.randomBytes(16).toString('hex');u.hash=crypto.scryptSync(pw,u.salt,32).toString('hex');u.disabled=false;
fs.writeFileSync(DB+'.tmp',JSON.stringify(db));fs.renameSync(DB+'.tmp',DB);
console.log('Lozinka za "'+u.username+'" je promijenjena, a prijava omogućena. Pokrenite aplikaciju ponovno.');
