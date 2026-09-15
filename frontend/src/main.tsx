import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The shell reloads once when its bundle is missing; clearing the flag here lets it
// recover again after the next deploy instead of only ever helping once.
try { sessionStorage.removeItem('atez-shell-reloaded') } catch { /* private mode */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
