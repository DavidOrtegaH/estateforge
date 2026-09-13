import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'

import './index.css'

import App from './App.tsx'

function applyInitialTheme() {
  const storedTheme = window.localStorage.getItem(
    'estateforge-theme',
  )

  const shouldUseDarkMode =
    storedTheme === 'dark' ||
    (storedTheme !== 'light' &&
      window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches)

  document.documentElement.classList.toggle(
    'dark',
    shouldUseDarkMode,
  )
}

applyInitialTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)