import React from 'react';
import ReactDOM from 'react-dom/client';
import { installStoragePolyfill } from './storagePolyfill.js';
import App from './App.jsx';

// Must run before App.jsx's first read from window.storage.
installStoragePolyfill();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline caching is a progressive enhancement — app still works without it.
    });
  });
}
