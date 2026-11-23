import '@fontsource/wix-madefor-display/500.css';
import '@fontsource/wix-madefor-display/600.css';
import '@fontsource/wix-madefor-text/400.css';
import '@fontsource/wix-madefor-text/500.css';
import '@fontsource/wix-madefor-text/600.css';
import './styles/tokens.css';
import './styles/base.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { queryClient } from './api.ts';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('Service worker not registered', err);
    });
  });
}
