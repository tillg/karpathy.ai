import { mkdirSync } from 'node:fs';
import { Api, REMOTES } from './helpers';

export default async function globalSetup() {
  // Tags this run's vaults so teardown never removes another concurrent run's vaults.
  process.env.E2E_RUN_ID = Date.now().toString(36);
  mkdirSync(REMOTES, { recursive: true });
  const api = await Api.create();
  const res = await api.ctx.get('/api/health');
  if (!res.ok()) throw new Error(`dev stack not reachable (https://localhost:8443/api/health → ${res.status()}); run deploy/dev.sh up`);
  await api.ctx.dispose();
}
