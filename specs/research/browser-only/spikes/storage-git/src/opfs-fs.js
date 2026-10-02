// Minimal fs.promises shim over OPFS (main-thread async API) — just what isomorphic-git needs.
const fsErr = (code, path) => Object.assign(new Error(`${code}: ${path}`), { code });
const split = (p) => p.split('/').filter((s) => s && s !== '.');

export class OpfsFs {
  constructor(base) {
    this.base = base;
    this.dirs = new Map(); // path -> FileSystemDirectoryHandle
    const bind = (f) => f.bind(this);
    this.promises = Object.fromEntries(
      ['readFile', 'writeFile', 'unlink', 'readdir', 'mkdir', 'rmdir', 'stat', 'lstat', 'readlink', 'symlink', 'chmod'].map((k) => [k, bind(this[k])]),
    );
  }
  async root() {
    return (this._root ??= (await navigator.storage.getDirectory()).getDirectoryHandle(this.base, { create: true }));
  }
  async dir(parts) {
    const key = '/' + parts.join('/');
    if (this.dirs.has(key)) return this.dirs.get(key);
    let h = await this.root();
    for (const p of parts) {
      try { h = await h.getDirectoryHandle(p); }
      catch (e) { throw fsErr(e.name === 'TypeMismatchError' ? 'ENOTDIR' : 'ENOENT', key); }
    }
    this.dirs.set(key, h);
    return h;
  }
  async entry(path) {
    const parts = split(path);
    if (!parts.length) return { kind: 'directory', handle: await this.root() };
    const parent = await this.dir(parts.slice(0, -1));
    const name = parts.at(-1);
    try { return { kind: 'file', handle: await parent.getFileHandle(name) }; } catch {}
    try { return { kind: 'directory', handle: await parent.getDirectoryHandle(name) }; } catch {}
    throw fsErr('ENOENT', path);
  }
  async readFile(path, opts) {
    const { kind, handle } = await this.entry(path);
    if (kind !== 'file') throw fsErr('EISDIR', path);
    const file = await handle.getFile();
    const enc = typeof opts === 'string' ? opts : opts?.encoding;
    return enc ? file.text() : Buffer.from(await file.arrayBuffer());
  }
  async writeFile(path, data) {
    const parts = split(path);
    const parent = await this.dir(parts.slice(0, -1));
    const w = await (await parent.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }
  async unlink(path) {
    const parts = split(path);
    const parent = await this.dir(parts.slice(0, -1));
    try { await parent.removeEntry(parts.at(-1)); } catch { throw fsErr('ENOENT', path); }
  }
  async readdir(path) {
    const { kind, handle } = await this.entry(path);
    if (kind !== 'directory') throw fsErr('ENOTDIR', path);
    const names = [];
    for await (const name of handle.keys()) names.push(name);
    return names;
  }
  async mkdir(path) {
    const parts = split(path);
    const parent = await this.dir(parts.slice(0, -1));
    const exists = await parent.getDirectoryHandle(parts.at(-1)).then(() => true, () => false);
    if (exists) throw fsErr('EEXIST', path);
    await parent.getDirectoryHandle(parts.at(-1), { create: true });
  }
  async rmdir(path) {
    const parts = split(path);
    const parent = await this.dir(parts.slice(0, -1));
    for (const k of this.dirs.keys()) if (k === '/' + parts.join('/') || k.startsWith('/' + parts.join('/') + '/')) this.dirs.delete(k);
    try { await parent.removeEntry(parts.at(-1)); } catch (e) { throw fsErr(e.name === 'InvalidModificationError' ? 'ENOTEMPTY' : 'ENOENT', path); }
  }
  async stat(path) {
    const { kind, handle } = await this.entry(path);
    const file = kind === 'file' ? await handle.getFile() : null;
    const mtimeMs = file?.lastModified ?? 0;
    return {
      type: kind === 'file' ? 'file' : 'dir', mode: kind === 'file' ? 0o100644 : 0o40000, size: file?.size ?? 0,
      ino: 0, uid: 1, gid: 1, dev: 1, mtimeMs, ctimeMs: mtimeMs,
      isFile: () => kind === 'file', isDirectory: () => kind !== 'file', isSymbolicLink: () => false,
    };
  }
  lstat(path) { return this.stat(path); }
  async readlink(path) { throw fsErr('ENOENT', path); }
  async symlink(_, path) { throw fsErr('ENOTSUP', path); }
  async chmod() {}
}
