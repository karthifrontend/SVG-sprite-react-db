// App entry point. Mounts the React tree, global styles, and providers (auth, toast) onto #root.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

declare global {
  interface Window {
    GOOGLE_CLIENT_ID?: string;
  }
}

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
