import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/source-serif-4/400.css'
import './atlas.css'
import { AtlasDataProvider } from './data'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AtlasDataProvider>
      <App />
    </AtlasDataProvider>
  </StrictMode>,
)
