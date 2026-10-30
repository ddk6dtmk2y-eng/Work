import http from 'node:http';
import { createBackup } from './backup.js';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const production = process.env.NODE_ENV === 'production';
const registrationKey = process.env.REGISTRATION_KEY || '';
const ownerEmail = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
if (production && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw Error('Set OWNER_EMAIL to your private account email before starting in production.');
if (production && registrationKey.length < 32) throw Error('Set a REGISTRATION_KEY of at least 32 characters.');
const dir = process.env.DATA_DIR || './data'; mkdirSync(dir,{recursive:true});
const db = new DatabaseSync(join(dir,'hostflow.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,password TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),name TEXT,email TEXT,phone TEXT,property TEXT,address TEXT,bedrooms INTEGER,revenue REAL,fee REAL,stage TEXT,notes TEXT);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,user_id INTEGER REFERENCES users(id),lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,title TEXT,due TEXT,done INTEGER DEFAULT 0);`);
const stages=['New lead','Contacted','Meeting booked','Proposal sent','Won','Lost'];
const hash=s=>createHash('sha256').update(s).digest('hex');
function password(p,salt=randomBytes(16).toString('hex')) { return salt+':'+scryptSync(p,salt,64).toString('hex'); }
function verify(p,stored){const [salt]=stored.split(':');return timingSafeEqual(Buffer.from(password(p,salt)),Buffer.from(stored));}
function seed(uid){
 const rows=[['Olivia Bennett','olivia@example.com','+44 7700 900101','The Garden Loft','18 Elm Street, London',2,4200,20,'Proposal sent','Interested in full-service management. Send a tailored proposal.'],['James Carter','james@example.com','+44 7700 900102','Seaside Retreat','8 Marine Parade, Brighton',3,5800,18,'Meeting booked','Available for a call on weekday afternoons.'],['Amelia Wilson','amelia@example.com','+44 7700 900103','City Studio','24 King Street, Manchester',1,2600,20,'New lead','Referred by a current owner.'],['Noah Thompson','noah@example.com','+44 7700 900104','The Georgian House','6 Royal Crescent, Bath',4,7200,18,'Contacted','Currently self-managing; looking for help with guest communication.'],['Sophia Patel','sophia@example.com','+44 7700 900105','Riverside Apartment','12 Quayside, Bristol',2,3900,20,'Won','Onboarding scheduled.']];
 const insert=db.prepare('INSERT INTO leads(user_id,name,email,phone,property,address,bedrooms,revenue,fee,stage,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 rows.forEach((r,i)=>{const id=insert.run(uid,...r).lastInsertRowid;if(i<4)db.prepare('INSERT INTO tasks(user_id,lead_id,title,due) VALUES(?,?,?,?)').run(uid,id,['Send management proposal','Confirm discovery call','Introduce HostFlow','Follow up on pricing'][i],new Date(Date.now()+(i-1)*86400000).toISOString().slice(0,10));});
}
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try {
 if(url.pathname==='/healthz'&&req.method==='GET'){db.prepare('SELECT 1').get();return json(200,{ok:true});}
 if(!url.pathname.startsWith('/api/')){const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(new URL('./public/'+file,import.meta.url)));}
 if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(403,{error:'Invalid request origin'});
 let body={};if(['POST','PUT'].includes(req.method)){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>50000)return json(413,{error:'Request too large'});}try{body=JSON.parse(raw||'{}');}catch{return json(400,{error:'Invalid JSON'});}}
 if(url.pathname==='/api/login'||url.pathname==='/api/register'){
 if(req.method!=='POST')return json(405,{error:'Method not allowed'});
 const ip=req.socket.remoteAddress;const now=Date.now();const a=attempts.get(ip)||{count:0,until:now+900000};if(a.until<now){a.count=0;a.until=now+900000;}if(++a.count>25)return json(429,{error:'Too many attempts. Try again in 15 minutes.'});attempts.set(ip,a);
 const email=String(body.email||'').trim().toLowerCase(),pass=String(body.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||pass.length<12||pass.length>200)return json(400,{error:'Use a valid email and a password of 12–200 characters.'});
 if(ownerEmail && email!==ownerEmail)return json(403,{error:'This workspace is private. Use the owner account.'});
 let user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if(url.pathname==='/api/register'){if(production&&!timingSafeEqual(Buffer.from(hash(String(body.setupCode||''))),Buffer.from(hash(registrationKey))))return json(403,{error:'Enter the private setup code from your hosting settings.'});if(user)return json(409,{error:'Account already exists. Sign in instead.'});const id=db.prepare('INSERT INTO users(email,password) VALUES(?,?)').run(email,password(pass)).lastInsertRowid;user={id,email};if(body.sample===true&&!production)seed(id);}else if(!user||!verify(pass,user.password))return json(401,{error:'Email or password is incorrect.'});
 const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,now+7*86400000);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.NODE_ENV==='production'?'; Secure':''}`);return json(200,{email:user.email});
 }
 const token=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('session='))?.slice(8)||'';
 const session=db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hash(token),Date.now());if(!session)return json(401,{error:'Please sign in.'});const uid=session.user_id;
 if(ownerEmail&&db.prepare('SELECT email FROM users WHERE id=?').get(uid)?.email!==ownerEmail)return json(403,{error:'This workspace is private. Use the owner account.'});
 if(url.pathname==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(200,{});}
 if(url.pathname==='/api/state'&&req.method==='GET')return json(200,{email:db.prepare('SELECT email FROM users WHERE id=?').get(uid).email,leads:db.prepare('SELECT * FROM leads WHERE user_id=?').all(uid),tasks:db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY due,id').all(uid)});
 if(url.pathname==='/api/export'&&req.method==='GET'){const rows=db.prepare('SELECT name,email,phone,property,address,bedrooms,revenue,fee,stage,notes FROM leads WHERE user_id=?').all(uid);const keys=['name','email','phone','property','address','bedrooms','revenue','fee','stage','notes'];const esc=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="hostflow-leads.csv"','Cache-Control':'no-store'});return res.end([keys,...rows.map(r=>keys.map(k=>r[k]))].map(r=>r.map(esc).join(',')).join('\r\n'));}
 const match=url.pathname.match(/^\/api\/(leads|tasks)(?:\/(\d+))?$/);if(!match)return json(404,{error:'Not found'});const [,table,id]=match;
 if(id&&!db.prepare(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).get(id,uid))return json(404,{error:'Not found'});
 if(req.method==='DELETE'&&id){db.prepare(`DELETE FROM ${table} WHERE id=? AND user_id=?`).run(id,uid);return json(200,{});}
 if(!['POST','PUT'].includes(req.method)|| (req.method==='PUT'&&!id))return json(405,{error:'Method not allowed'});
 if(table==='leads'){
 const fields=['name','email','phone','property','address','bedrooms','revenue','fee','stage','notes'];const values=fields.map(k=>['bedrooms','revenue','fee'].includes(k)?Number(body[k]):String(body[k]??'').trim());
 if(!values[0]||!values[3]||values.some(v=>typeof v==='string'&&v.length>5000)||!stages.includes(body.stage)||![values[5],values[6],values[7]].every(Number.isFinite)||values[5]<0||values[6]<0||values[7]<0||values[7]>100)return json(400,{error:'Enter an owner, property, valid stage and non-negative amounts. Fee must be 0–100%.'});
 if(id)db.prepare(`UPDATE leads SET ${fields.map(k=>k+'=?').join(',')} WHERE id=? AND user_id=?`).run(...values,id,uid);else db.prepare(`INSERT INTO leads(user_id,${fields.join(',')}) VALUES(${Array(11).fill('?').join(',')})`).run(uid,...values);
 }else{
 if(id){db.prepare('UPDATE tasks SET done=? WHERE id=? AND user_id=?').run(body.done?1:0,id,uid);}else{if(!String(body.title||'').trim()||String(body.title).length>500||!/^\d{4}-\d{2}-\d{2}$/.test(body.due)||!Number.isFinite(Date.parse(body.due))||!db.prepare('SELECT id FROM leads WHERE id=? AND user_id=?').get(body.lead_id,uid))return json(400,{error:'Choose a lead, task title and valid due date.'});db.prepare('INSERT INTO tasks(user_id,lead_id,title,due) VALUES(?,?,?,?)').run(uid,body.lead_id,body.title.trim(),body.due);}
 }return json(200,{ok:true});
 }catch(e){console.error(e.message);json(500,{error:'Something went wrong. Please try again.'});}
});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('HostFlow CRM listening on port '+(process.env.PORT||3000)));

if(production){const save=()=>createBackup(dir).catch(error=>console.error('Backup failed:',error.message));save();setInterval(save,86400000).unref();}
