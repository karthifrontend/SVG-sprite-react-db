import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

// Expose the Google OAuth client id configured at build time (Vite
// injects `import.meta.env.VITE_*` as a string | undefined). The
// AuthContext reads this global when initialising Google Identity
// Services, so the provider can be configured via a `.env` file
// without touching the source.
//   .env example:
//     VITE_GOOGLE_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
declare global {
  interface Window {
    GOOGLE_CLIENT_ID?: string;
  }
}
// Vite preserves any whitespace after the `=` in `.env` values, so we
// trim explicitly. An empty string is treated as "not configured" so
// the auth flow can show a clear error instead of failing inside GIS.
const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
window.GOOGLE_CLIENT_ID = googleClientId || undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
