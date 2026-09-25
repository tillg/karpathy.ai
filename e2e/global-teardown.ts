import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Api, REMOTES, runId } from './helpers';

/** Removes this run's leftover vaults (repo e2e/*-<run id>-*) and bare remotes. Never touches other vaults. */
export default async function globalTeardown() {
  const tag = `-${runId()}-`;
  const api = await Api.create();
  let left = 0;
  for (const v of await api.vaults()) {
    if (!v.repo.startsWith('e2e/') || !v.repo.includes(tag)) continue;
    await api.removeVault(v.id);
    left++;
  }
  await api.ctx.dispose();
  if (!process.env.E2E_KEEP_REMOTES)
    for (const d of readdirSync(REMOTES)) if (d.includes(tag)) rmSync(join(REMOTES, d), { recursive: true, force: true });
  if (left) console.log(`global teardown: cleaned up ${left} leftover e2e vault(s)`);
}
