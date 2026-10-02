// Builds spike fixtures under tmp/. Reads /Users/tgartner/git/mylife_wiki READ-ONLY.
//   tmp/vault.json      all .md files of the source vault as [{path, content}] (S1)
//   tmp/git/mylife.git  full bare clone of the source vault, incl. media (S2 "big")
//   tmp/git/mdvault.git bare repo with only the .md files (S2 "md", S3 push target)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = process.env.SPIKE_SRC_VAULT ?? '/Users/tgartner/git/mylife_wiki';
const TMP = new URL('../tmp/', import.meta.url).pathname;
const GIT = join(TMP, 'git');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

mkdirSync(GIT, { recursive: true });

// Tracked .md files of HEAD (ignores .git and untracked files).
const mdPaths = git(SRC, 'ls-files', '-z', '*.md').split('\0').filter(Boolean);
const files = mdPaths.map((path) => ({ path, content: readFileSync(join(SRC, path), 'utf8') }));
writeFileSync(join(TMP, 'vault.json'), JSON.stringify(files));
const bytes = files.reduce((s, f) => s + Buffer.byteLength(f.content), 0);
console.log(`vault.json: ${files.length} files, ${(bytes / 1e6).toFixed(2)} MB`);

if (!existsSync(join(GIT, 'mylife.git'))) {
  // --no-hardlinks: never share object files with the source repo.
  execFileSync('git', ['clone', '--bare', '--no-hardlinks', SRC, join(GIT, 'mylife.git')], { stdio: 'inherit' });
}

// md-only repo: 3 commits so that full vs. depth-1 clone differ.
const work = join(TMP, 'mdwork');
rmSync(work, { recursive: true, force: true });
rmSync(join(GIT, 'mdvault.git'), { recursive: true, force: true });
mkdirSync(work, { recursive: true });
git(work, 'init', '-q', '-b', 'main');
const env = ['-c', 'user.name=Spike', '-c', 'user.email=spike@example.invalid'];
const thirds = [0, 1, 2].map((i) => files.filter((_, j) => j % 3 === i));
for (const [i, part] of thirds.entries()) {
  for (const f of part) {
    mkdirSync(dirname(join(work, f.path)), { recursive: true });
    writeFileSync(join(work, f.path), f.content);
  }
  git(work, 'add', '-A');
  git(work, ...env, 'commit', '-q', '-m', `fixture part ${i + 1}/3`);
}
git(TMP, 'clone', '-q', '--bare', work, join(GIT, 'mdvault.git'));
git(join(GIT, 'mdvault.git'), 'gc', '-q');
git(join(GIT, 'mdvault.git'), 'config', 'http.receivepack', 'true');
console.log('mdvault.git ready:', git(join(GIT, 'mdvault.git'), 'count-objects', '-vH').split('\n').find((l) => l.startsWith('size-pack')));
