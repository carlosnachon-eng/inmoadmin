// Isolated UI fixture. Does NOT certify real authentication or DEV integration.
import { mkdtemp, mkdir, copyFile, writeFile, rm, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp('/private/tmp/cierre251-visual-');
for(const folder of ['pages','lib','components'])await mkdir(path.join(dir,folder));
for(const file of ['pages/cierres.js','lib/cierreCancellation.js','lib/permisos.js','components/CierreCancellationDialog.js'])await copyFile(path.join(root,file),path.join(dir,file));
await copyFile(path.join(root,'tests/fixtures/cierreCancellation/supabase.js'),path.join(dir,'lib/supabase.js'));
await copyFile(path.join(root,'tests/fixtures/cierreCancellation/app.js'),path.join(dir,'pages/_app.js'));
await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
await writeFile(path.join(dir,'package.json'),'{"private":true}');
const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',process.env.CIERRE_QA_PORT||'3251'],{cwd:dir,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));await rm(dir,{recursive:true,force:true});process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
child.on('exit',async()=>{if(!stopping){await rm(dir,{recursive:true,force:true});process.exit(1);}});
