import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('CRM: authentication, CRUD, isolation, export, logout and restart persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hostflow-'));const port=32000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;let child;
 async function start(){child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',OWNER_EMAIL:'',PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code)));});}
 async function stop(){const c=child;await new Promise(resolve=>{c.once('exit',resolve);c.kill();});}
 let cookie='';async function request(path,method='GET',body,origin=base){const r=await fetch(base+'/api/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r;}
 try{await start();assert.equal((await request('state')).status,401);
 let r=await request('register','POST',{email:'owner@example.com',password:'a long test password',sample:true});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 let s=await (await request('state')).json();assert.equal(s.leads.length,5);assert.equal(s.tasks.length,4);
 const lead={name:'Test Owner',email:'test@example.com',phone:'+44 7700 900000',property:'Test Home',address:'London',bedrooms:2,revenue:5000,fee:20,stage:'New lead',notes:'=HYPERLINK("bad")'};
 assert.equal((await request('leads','POST',lead,'https://evil.example')).status,403);
 assert.equal((await request('leads','POST',{...lead,fee:101})).status,400);
 assert.equal((await request('leads','POST',lead)).status,200);s=await (await request('state')).json();const id=s.leads.at(-1).id;
 assert.equal((await request('leads/'+id,'PUT',{...lead,stage:'Won'})).status,200);
 assert.equal((await request('tasks','POST',{lead_id:id,title:'Call owner',due:'2026-11-01'})).status,200);s=await (await request('state')).json();const task=s.tasks.find(t=>t.lead_id===id);
 assert.equal((await request('tasks/'+task.id,'PUT',{done:true})).status,200);
 const csv=await (await request('export')).text();assert.match(csv,/Test Owner/);assert.match(csv,/'=HYPERLINK/);
 await stop();await start();s=await (await request('state')).json();assert.equal(s.leads.find(l=>l.id===id).stage,'Won');assert.equal(s.tasks.find(t=>t.id===task.id).done,1);
 const first=cookie;r=await request('register','POST',{email:'other@example.com',password:'another long password'});cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await (await request('state')).json()).leads.length,0);assert.equal((await request('leads/'+id,'PUT',lead)).status,404);assert.equal((await request('tasks','POST',{lead_id:id,title:'Bad',due:'2026-11-01'})).status,400);
 cookie=first;assert.equal((await request('leads/'+id,'DELETE')).status,200);s=await (await request('state')).json();assert.ok(!s.tasks.some(t=>t.lead_id===id));assert.equal((await request('logout','POST')).status,200);assert.equal((await request('state')).status,401);
 assert.equal((await request('login','POST',{email:'owner@example.com',password:'wrong but long password'})).status,401);assert.equal((await request('login','POST',{email:'owner@example.com',password:'a long test password'})).status,200);
 }finally{if(child?.exitCode===null)await stop();rmSync(dir,{recursive:true,force:true});}
});

test('Production restricts accounts, disables samples and sets secure cookies', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hostflow-production-'));
 const port=42000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'production',REGISTRATION_KEY:'a-private-setup-code-of-32-characters',OWNER_EMAIL:'owner@example.com',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try {
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code)));});
  const request=(path,body,cookie='')=>fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});
  assert.equal((await request('/healthz')).status,200);
  assert.equal((await request('/api/register',{email:'stranger@example.com',password:'a long test password'})).status,403);
  assert.equal((await request('/api/register',{email:'owner@example.com',password:'a long test password'})).status,403);
  const r=await request('/api/register',{email:'OWNER@example.com',password:'a long test password',sample:true,setupCode:'a-private-setup-code-of-32-characters'});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/; Secure/);
  const cookie=r.headers.get('set-cookie').split(';')[0];
  const state=await (await request('/api/state',null,cookie)).json();
  assert.equal(state.email,'owner@example.com');assert.equal(state.leads.length,0);assert.equal(state.tasks.length,0);
  assert.equal((await request('/api/login',{email:'preview@example.com',password:'HostFlow-preview-2026!'})).status,403);
 } finally {if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});rmSync(dir,{recursive:true,force:true});}
});
