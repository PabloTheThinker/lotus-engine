import { createRoot } from 'react-dom/client'
import './index.css'
import './editor/indieMpGameplay'
import App from './App.tsx'

// No StrictMode: the viewport owns a WebGL context — double-mounting in dev
// would create and tear down the renderer twice for no benefit.
createRoot(document.getElementById('root')!).render(<App />)
