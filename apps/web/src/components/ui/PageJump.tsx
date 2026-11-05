import { useId, useState, type FormEvent } from 'react'

import { parsePageInput, reachablePages } from '@/lib/pagination'

interface PageJumpProps {
  currentPage: number
  totalPages: number
  // Recibe una página válida (entera, entre 1 y totalPages) distinta de la actual.
  onJump: (page: number) => void
  // Mientras se carga o se procesa algo, como los botones Anterior y Siguiente.
  disabled?: boolean
  // Texto accesible del campo; por defecto «Ir a la página».
  label?: string
  // Última página que el servidor puede consultar, si es menor que el total.
  maxPage?: number
}

/**
 * «Ir a [número] [Ir]»: salto directo a una página. Solo navega al confirmar (botón o
 * Enter); un valor no válido muestra el motivo y no navega. Con una sola página está
 * desactivado.
 */
export function PageJump({ currentPage, totalPages, onJump, disabled = false, label = 'Ir a la página', maxPage }: PageJumpProps) {
  const id = useId()
  const errorId = `${id}-error`
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inactive = disabled || totalPages <= 1

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inactive) return
    const result = parsePageInput(value, totalPages, maxPage)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setValue('')
    if (result.page !== currentPage) onJump(result.page)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        Ir a<span className="sr-only"> {label.replace(/^Ir a\s*/i, '')}</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          if (error) setError(null)
        }}
        disabled={inactive}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        placeholder={`1–${reachablePages(totalPages, maxPage)}`}
        className="h-9 w-20 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={inactive}
        className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        Ir
      </button>
      {error && <p id={errorId} role="alert" className="basis-full text-xs text-red-700">{error}</p>}
    </form>
  )
}
