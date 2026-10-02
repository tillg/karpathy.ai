// Builds fixtures (gitignored): public/fixture/all.json = every *.md of mylife_wiki (read-only copy, no .git),
// public/vault-small/*.json = a synthetic 12-note vault + one skill, for the agent spike (L3).
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const SRC = process.env.VAULT_SRC ?? '/Users/tgartner/git/mylife_wiki';
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === '.git' || n === 'node_modules') continue;
    const p = join(d, n); const s = statSync(p);
    if (s.isDirectory()) walk(p); else if (n.endsWith('.md')) files.push({ path: relative(SRC, p), text: readFileSync(p, 'utf8') });
  }
})(SRC);
mkdirSync('public/fixture', { recursive: true });
writeFileSync('public/fixture/all.json', JSON.stringify(files));
console.log(`large fixture: ${files.length} files, ${files.reduce((a, f) => a + f.text.length, 0)} chars`);

const topics = [
  ['phare-du-petit-minou', 'Phare du Petit Minou', 'Lighthouse near Brest in Brittany, built 1848, reachable over a stone bridge.', ['brittany', 'travel-2025']],
  ['brittany', 'Brittany', 'Region in western France. See [[phare-du-petit-minou]] and [[crepes]].', ['travel-2025']],
  ['crepes', 'Crêpes', 'Buckwheat galettes from [[brittany]]; best with cidre.', ['brittany']],
  ['travel-2025', 'Travel 2025', 'Trips: [[brittany]] in May, [[lisbon]] in October.', ['brittany', 'lisbon']],
  ['lisbon', 'Lisbon', 'Capital of Portugal. Tram 28, [[pasteis-de-nata]].', ['travel-2025']],
  ['pasteis-de-nata', 'Pastéis de nata', 'Custard tarts from [[lisbon]] (Belém).', ['lisbon']],
  ['karpathy', 'Andrej Karpathy', 'Author of the LLM-wiki idea, see [[llm-wiki]].', ['llm-wiki']],
  ['llm-wiki', 'LLM Wiki', 'Pattern: an LLM maintains a Markdown wiki from raw sources. By [[karpathy]].', ['karpathy', 'obsidian']],
  ['obsidian', 'Obsidian', 'Markdown note app with [[llm-wiki]] vaults and wikilinks.', ['llm-wiki']],
  ['sourdough', 'Sourdough', 'Bread recipe: 75% hydration, overnight proof. Relates to [[baking]].', ['baking']],
  ['baking', 'Baking', 'Hobby. See [[sourdough]].', ['sourdough']],
  ['index', 'Index', 'Entry point: [[travel-2025]], [[llm-wiki]], [[baking]].', ['travel-2025', 'llm-wiki', 'baking']],
];
const small = topics.map(([slug, title, body, rel]) => ({
  path: `Wiki/${slug}.md`,
  text: `---\ntype: entity\ntags: [${rel.join(', ')}]\nupdated: 2026-09-01\nrelated: [${rel.map((r) => `"[[${r}]]"`).join(', ')}]\n---\n\n# ${title}\n\n${body}\n`,
}));
small.push({ path: '.claude/skills/mark-seen/SKILL.md', text: `---\nname: mark-seen\ndescription: Mark a wiki note as seen/visited. Use when the user says they saw or visited something.\n---\n\n# mark-seen\n\n1. Find the note (use search).\n2. Read it.\n3. Write it back unchanged except: append a final line exactly \`Seen: yes\` and change the frontmatter \`updated:\` to 2026-09-27.\n` });
small.push({ path: '.claude/skills/summarize/SKILL.md', text: `---\nname: summarize\ndescription: Summarize a note in three bullet points.\n---\n\n# summarize\n\nRead the note and answer with three bullets. Do not write files.\n` });
mkdirSync('public/vault-small', { recursive: true });
writeFileSync('public/vault-small/vault.json', JSON.stringify(small));
console.log(`small vault: ${small.length} files`);
