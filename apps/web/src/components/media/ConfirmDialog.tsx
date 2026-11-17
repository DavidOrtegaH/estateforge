import { useModalDialog } from '@/hooks/useModalDialog'

// Confirmación modal con el mismo aspecto y la misma gestión del foco que los demás diálogos.
export function ConfirmDialog({
  id,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  id: string
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useModalDialog<HTMLElement>({ open: true, onClose: onCancel })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="relative z-10 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl"
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${id}-description`} className="mt-2 text-sm text-muted-foreground">
          {description}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              destructive
                ? 'rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10'
                : 'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
