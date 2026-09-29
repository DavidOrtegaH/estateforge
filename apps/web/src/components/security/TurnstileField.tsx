import { useEffect, useRef } from 'react'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? ''
const SCRIPT_ID = 'estateforge-turnstile-script'
const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileWidget = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      theme: 'auto'
      language: string
      appearance: 'interaction-only'
      callback: (token: string) => void
      'error-callback': () => void
      'expired-callback': () => void
    },
  ) => string | number
  remove: (widgetId: string | number) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileWidget
  }
}

export function isTurnstileConfigured(): boolean {
  return Boolean(SITE_KEY)
}

interface TurnstileFieldProps {
  onTokenChange: (token: string | undefined) => void
}

export function TurnstileField({
  onTokenChange,
}: TurnstileFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | number | null>(null)
  const onTokenChangeRef = useRef(onTokenChange)

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange
  }, [])

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) {
      return
    }

    let cancelled = false

    const renderWidget = () => {
      if (
        cancelled ||
        !containerRef.current ||
        !window.turnstile
      ) {
        return
      }

      if (widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }

      containerRef.current.innerHTML = ''

      widgetIdRef.current = window.turnstile.render(
        containerRef.current,
        {
          sitekey: SITE_KEY,
          theme: 'auto',
          language: 'es',
          appearance: 'interaction-only',
          callback: (token) => onTokenChangeRef.current(token),
          'error-callback': () => onTokenChangeRef.current(undefined),
          'expired-callback': () => onTokenChangeRef.current(undefined),
        },
      )
    }

    const existingScript = document.getElementById(SCRIPT_ID)

    if (existingScript) {
      if (window.turnstile) {
        renderWidget()
      } else {
        existingScript.addEventListener('load', renderWidget, {
          once: true,
        })
      }
    } else {
      const script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      script.addEventListener('load', renderWidget, { once: true })
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true

      if (
        widgetIdRef.current !== null &&
        window.turnstile
      ) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [])

  if (!SITE_KEY) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className="min-h-16.25"
      aria-label="Verificación de seguridad"
    />
  )
}
