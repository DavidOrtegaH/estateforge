import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  wrapperClassName?: string
  visibilityLabel?: string
}

export function PasswordInput({
  className = '',
  wrapperClassName = '',
  visibilityLabel = 'contraseña',
  disabled,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        {...inputProps}
        type={visible ? 'text' : 'password'}
        disabled={disabled}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${visibilityLabel}`}
        aria-pressed={visible}
        title={`${visible ? 'Ocultar' : 'Mostrar'} ${visibilityLabel}`}
        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
