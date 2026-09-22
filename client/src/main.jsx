import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';


createRoot(document.getElementById('root')).render(<App />);

// Register the service worker so the app is installable (PWA).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
