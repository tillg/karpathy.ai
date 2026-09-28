import 'framework7-icons/css/framework7-icons.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

// autoUpdate: reload once a new service worker takes over, else the open page keeps the old build.
// The browser only looks for a new worker on navigation; a resumed tab or home-screen app rarely
// navigates, so check again whenever the app becomes visible.
registerSW({
  immediate: true,
  onRegisteredSW: (_url, registration) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration?.update();
    });
  },
});

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
