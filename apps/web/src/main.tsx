import 'framework7-icons/css/framework7-icons.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
