// S1 worker variant: write/read all files with the synchronous OPFS access handle.
const enc = new TextEncoder(), dec = new TextDecoder();

async function dirFor(root, path, cache, create) {
  const parts = path.split('/').slice(0, -1);
  let dir = root, key = '';
  for (const p of parts) {
    key += '/' + p;
    dir = cache.get(key) ?? (await dir.getDirectoryHandle(p, { create }));
    cache.set(key, dir);
  }
  return dir;
}

self.onmessage = async ({ data: { files, base } }) => {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(base, { create: true });
    let cache = new Map();
    let t = performance.now();
    for (const f of files) {
      const dir = await dirFor(root, f.path, cache, true);
      const h = await (await dir.getFileHandle(f.path.split('/').pop(), { create: true })).createSyncAccessHandle();
      h.truncate(0);
      h.write(enc.encode(f.content), { at: 0 });
      h.flush();
      h.close();
    }
    const writeMs = performance.now() - t;
    cache = new Map();
    t = performance.now();
    let bytes = 0;
    for (const f of files) {
      const dir = await dirFor(root, f.path, cache, false);
      const h = await (await dir.getFileHandle(f.path.split('/').pop())).createSyncAccessHandle();
      const buf = new Uint8Array(h.getSize());
      h.read(buf, { at: 0 });
      h.close();
      bytes += dec.decode(buf).length;
    }
    self.postMessage({ writeMs, readMs: performance.now() - t, readChars: bytes });
  } catch (e) {
    self.postMessage({ error: `${e.name}: ${e.message}` });
  }
};
