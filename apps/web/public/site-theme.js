// Tema claro u oscuro de la página de presentación. Comparte la preferencia de la aplicación
// (`estateforge-theme` en localStorage: 'light' o 'dark') y la clase `dark` de <html>; sin una
// elección guardada sigue al sistema. Se carga en <head> sin `defer` para aplicar el tema antes
// de pintar la página. Si el almacenamiento está bloqueado, la elección dura solo esta visita.
(() => {
  'use strict'

  const KEY = 'estateforge-theme'
  const root = document.documentElement
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null

  const read = () => {
    try {
      const value = window.localStorage.getItem(KEY)
      return value === 'dark' || value === 'light' ? value : null
    } catch {
      return null
    }
  }

  const save = (value) => {
    try {
      window.localStorage.setItem(KEY, value)
    } catch {
      // Almacenamiento bloqueado: se mantiene en memoria.
    }
  }

  let choice = read()

  const isDark = () => (choice ? choice === 'dark' : Boolean(media && media.matches))

  const apply = () => {
    const dark = isDark()
    root.classList.toggle('dark', dark)
    root.classList.toggle('light', !dark)
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      const label = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
      button.setAttribute('aria-label', label)
      button.setAttribute('title', dark ? 'Modo claro' : 'Modo oscuro')
    }
  }

  // El botón solo se muestra cuando este script funciona.
  root.classList.add('theme-ready')
  apply()

  document.addEventListener('DOMContentLoaded', apply)

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('[data-theme-toggle]')) return
    choice = isDark() ? 'light' : 'dark'
    save(choice)
    apply()
  })

  if (media) {
    media.addEventListener('change', () => {
      if (!choice) apply()
    })
  }

  // Cambios hechos en otra pestaña (la aplicación u otra copia de esta página).
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return
    choice = read()
    apply()
  })
})()
