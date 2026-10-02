// Local servers for the spikes:
//   :8787  static page (dist/) + /vault.json fixture
//   :8788  git smart HTTP (git http-backend CGI) over tmp/git/*.git, CORS-enabled, push allowed
//   :9999  @isomorphic-git/cors-proxy (proxies https://github.com/...)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const file = url.pathname === '/vault.json' ? join(ROOT, 'tmp/vault.json')
    : join(ROOT, 'dist', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, git-protocol, authorization, user-agent, x-authorization',
  'access-control-expose-headers': 'content-type, content-length',
};

function serveGit(req, res) {
  if (req.method === 'OPTIONS') return res.writeHead(200, CORS).end();
  const url = new URL(req.url, 'http://x');
  const cgi = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: join(ROOT, 'tmp/git'),
      GIT_HTTP_EXPORT_ALL: '1',
      REMOTE_USER: 'spike',
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      GIT_PROTOCOL: req.headers['git-protocol'] ?? '',
      HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
    },
  });
  req.pipe(cgi.stdin);
  cgi.stderr.on('data', (d) => process.stderr.write(`[git] ${d}`));
  let head = Buffer.alloc(0), sent = false;
  cgi.stdout.on('data', (chunk) => {
    if (sent) return res.write(chunk);
    head = Buffer.concat([head, chunk]);
    const i = head.indexOf('\r\n\r\n');
    if (i < 0) return;
    const headers = { ...CORS };
    let status = 200;
    for (const line of head.subarray(0, i).toString().split('\r\n')) {
      const [k, ...v] = line.split(':');
      if (k.toLowerCase() === 'status') status = parseInt(v.join(':'));
      else headers[k.toLowerCase()] = v.join(':').trim();
    }
    res.writeHead(status, headers);
    res.write(head.subarray(i + 4));
    sent = true;
  });
  cgi.on('close', () => (sent ? res.end() : res.writeHead(500, CORS).end()));
}

export async function startServers() {
  process.env.INSECURE_HTTP_ORIGINS ??= 'localhost:8788';
  const { default: corsProxy } = await import('@isomorphic-git/cors-proxy');
  const servers = [
    createServer(serveStatic).listen(8787),
    createServer(serveGit).listen(8788),
    createServer(corsProxy).listen(9999),
  ];
  return () => servers.forEach((s) => s.close());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServers();
  console.log('servers up: http://localhost:8787 (page), :8788 (git), :9999 (cors-proxy)');
}
