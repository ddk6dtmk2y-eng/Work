import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createBackup(dir = process.env.DATA_DIR || './data') {
 const targetDir=join(dir,'backups');mkdirSync(targetDir,{recursive:true});
 const source=new DatabaseSync(join(dir,'hostflow.sqlite'),{readOnly:true});
 const target=join(targetDir,`hostflow-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
 try {
  await backup(source,target);
  const restored=new DatabaseSync(target,{readOnly:true});
  try {
   if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');
   restored.prepare('SELECT count(*) FROM users').get();
  } finally {restored.close();}
  const names=readdirSync(targetDir).filter(n=>/^hostflow-\d{4}-.*\.sqlite$/.test(n)).sort().reverse();
  for(const name of names.slice(7))unlinkSync(join(targetDir,name));
  return target;
 } finally {source.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(`Verified backup: ${await createBackup()}`);
