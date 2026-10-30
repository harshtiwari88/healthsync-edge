import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/500.css';
import '@fontsource/noto-sans-devanagari/600.css';
import '@fontsource/noto-sans-devanagari/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import {GlobalErrorBoundary} from './components/GlobalErrorBoundary.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[SwasthyaSetu Guard] Handled background promise rejection:', event.reason);
    event.preventDefault();
  });

  try {
    registerSW({immediate: true});
  } catch (err) {
    console.warn('[SwasthyaSetu PWA] Service worker registration skipped:', err);
  }
}

const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
if (rootEl) {
  createRoot(rootEl).render(
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  );
}

