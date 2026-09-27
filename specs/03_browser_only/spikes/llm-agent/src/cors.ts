// L1 in-browser: real fetch with a fake key. 'response' = browser surfaced an HTTP status (CORS ok);
// 'TypeError' = blocked (CORS) or network error.
const FAKE = 'sk-invalid-spike-key';
const body = JSON.stringify({ model: 'x', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
const bearer = { 'content-type': 'application/json', authorization: `Bearer ${FAKE}` };
const targets: [string, string, Record<string, string>][] = [
  ['anthropic (no direct header)', 'https://api.anthropic.com/v1/messages', { 'content-type': 'application/json', 'x-api-key': FAKE, 'anthropic-version': '2023-06-01' }],
  ['anthropic + dangerous-direct-browser-access', 'https://api.anthropic.com/v1/messages', { 'content-type': 'application/json', 'x-api-key': FAKE, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }],
  ['openai', 'https://api.openai.com/v1/chat/completions', bearer],
  ['openrouter', 'https://openrouter.ai/api/v1/chat/completions', bearer],
  ['gemini (native, x-goog-api-key)', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', { 'content-type': 'application/json', 'x-goog-api-key': FAKE }],
  ['gemini (openai-compat)', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', bearer],
  ['mistral', 'https://api.mistral.ai/v1/chat/completions', bearer],
  ['groq', 'https://api.groq.com/openai/v1/chat/completions', bearer],
  ['ollama via forwarder (localhost:11435)', 'http://localhost:11435/v1/chat/completions', { 'content-type': 'application/json' }],
];
(window as any).runCors = async () => {
  const rows = [];
  for (const [name, url, headers] of targets) {
    const t = performance.now();
    try {
      const r = await fetch(url, { method: 'POST', headers, body: name.startsWith('gemini (native') ? JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }) : body });
      const txt = (await r.text()).slice(0, 90).replace(/\s+/g, ' ');
      rows.push({ name, outcome: 'response', status: r.status, body: txt, ms: Math.round(performance.now() - t) });
    } catch (e: any) {
      rows.push({ name, outcome: 'blocked', error: `${e.name}: ${e.message}`, ms: Math.round(performance.now() - t) });
    }
  }
  return rows;
};
