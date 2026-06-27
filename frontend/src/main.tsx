import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import { applyTheme } from './theme';
import './styles.css';
import '@xterm/xterm/css/xterm.css';

// Apply the persisted theme before first paint to avoid a flash.
applyTheme(useStore.getState().theme);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
