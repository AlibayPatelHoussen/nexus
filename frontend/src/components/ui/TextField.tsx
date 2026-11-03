import { forwardRef, useId } from 'react'
import { cn } from '@/utils'

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?:    string
  /** Visually hide the label (still read by screen readers) */
  hideLabel?: boolean
  hint?:     string
  error?:    string
  trailing?: React.ReactNode
}

/** NSTextField / UITextField with label, hint and error message. */
const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, hint, error, trailing, className, id, ...rest },
  ref,
) {
  const auto = useId()
  const fieldId = id ?? auto
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5 min-w-0', className)}>
      {label && (
        <label htmlFor={fieldId} className={cn('text-subhead text-label2', hideLabel && 'sr-only')}>{label}</label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full min-h-control px-2.5 rounded-[7px] bg-surface text-label placeholder:text-label3',
            'border-[0.5px] border-separator outline-none transition-[box-shadow,border-color] duration-fast',
            'focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_35%,transparent)]',
            'max-md:text-[17px] max-md:min-h-[44px] max-md:rounded-[10px]',
            error && 'border-danger',
            trailing ? 'pr-9' : '',
          )}
          {...rest}
        />
        {trailing && <div className="absolute right-1 top-1/2 -translate-y-1/2 flex">{trailing}</div>}
      </div>
      {error ? (
        <p id={`${fieldId}-error`} role="alert" className="text-subhead text-danger-text">{error}</p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-subhead text-label2">{hint}</p>
      ) : null}
    </div>
  )
})

export default TextField
