import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });

// Only in production builds: in dev the cache would serve stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
}
