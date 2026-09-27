// Multi-page build only used to measure bundle sizes (`npx vite build`).
export default { build: { outDir: 'dist', rollupOptions: { input: { agent: 'agent.html', search: 'search.html' } } } };
