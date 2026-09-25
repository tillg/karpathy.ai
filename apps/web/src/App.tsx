import { useEffect, useState } from 'react';
import { Shell } from './components/Shell';
import { TokenScreen } from './components/TokenScreen';
import { getToken, setUnauthorizedHandler } from './lib/api';
import { AppProvider } from './store';

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  useEffect(() => setUnauthorizedHandler(() => setAuthed(false)), []);
  if (!authed) return <TokenScreen onDone={() => setAuthed(true)} />;
  return <AppProvider><Shell /></AppProvider>;
}
