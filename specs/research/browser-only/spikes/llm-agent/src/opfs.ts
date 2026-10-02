// Minimal OPFS vault: nested dirs, read/write/list. Writes use createWritable() when available,
// else a worker with createSyncAccessHandle() (older WebKit).
export async function root(sub = 'vault'): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(sub, { create: true });
}
async function dirFor(r: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split('/'); const name = parts.pop()!;
  let d = r;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return { d, name };
}
export let writeMode = 'unknown';
export async function writeFile(r: FileSystemDirectoryHandle, path: string, text: string) {
  const { d, name } = await dirFor(r, path, true);
  const fh = await d.getFileHandle(name, { create: true });
  if ('createWritable' in fh) {
    writeMode = 'createWritable';
    const w = await (fh as any).createWritable(); await w.write(text); await w.close(); return;
  }
  writeMode = 'syncAccessHandle(worker)';
  await workerWrite(r.name, path, text);
}
function workerWrite(sub: string, path: string, text: string) {
  const src = `onmessage=async e=>{const{sub,path,text}=e.data;let d=await (await navigator.storage.getDirectory()).getDirectoryHandle(sub,{create:true});
  const ps=path.split('/');const n=ps.pop();for(const p of ps)d=await d.getDirectoryHandle(p,{create:true});
  const h=await (await d.getFileHandle(n,{create:true})).createSyncAccessHandle();const b=new TextEncoder().encode(text);
  h.truncate(0);h.write(b,{at:0});h.flush();h.close();postMessage('ok')}`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  return new Promise<void>((res, rej) => { w.onmessage = () => { w.terminate(); res(); }; w.onerror = (e) => rej(e); w.postMessage({ sub, path, text }); });
}
export async function readFile(r: FileSystemDirectoryHandle, path: string) {
  const { d, name } = await dirFor(r, path, false);
  return (await (await d.getFileHandle(name)).getFile()).text();
}
export async function listFiles(r: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for await (const [n, h] of (r as any).entries()) {
    if (h.kind === 'directory') out.push(...(await listFiles(h, prefix + n + '/')));
    else out.push(prefix + n);
  }
  return out;
}
export async function wipe(sub: string) {
  try { await (await navigator.storage.getDirectory()).removeEntry(sub, { recursive: true }); } catch {}
}

// Bulk write in ONE dedicated worker via createSyncAccessHandle (the fast OPFS path).
export function workerBulkWrite(sub: string, files: { path: string; text: string }[]) {
  const src = `onmessage=async e=>{const{sub,files}=e.data;const R=await (await navigator.storage.getDirectory()).getDirectoryHandle(sub,{create:true});
  const enc=new TextEncoder();const dirs=new Map();let fails=0,firstErr=null;
  for(const f of files){try{const ps=f.path.split('/');const n=ps.pop();let key='',d=R;
    for(const p of ps){key+='/'+p;let c=dirs.get(key);if(!c){c=await d.getDirectoryHandle(p,{create:true});dirs.set(key,c)}d=c}
    const h=await (await d.getFileHandle(n,{create:true})).createSyncAccessHandle();const b=enc.encode(f.text);h.truncate(0);h.write(b,{at:0});h.flush();h.close();
  }catch(err){fails++;firstErr??=f.path+': '+err}}postMessage({fails,firstErr})}`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  return new Promise<{ fails: number; firstErr: string | null }>((res, rej) => { w.onmessage = (e) => { w.terminate(); res(e.data); }; w.onerror = (e) => rej(e.message); w.postMessage({ sub, files }); });
}
