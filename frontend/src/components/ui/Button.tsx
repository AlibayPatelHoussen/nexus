import { forwardRef } from 'react'
import { cn } from '@/utils'
import Spinner from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive' | 'destructive-plain'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** "large": full-width iOS button (50 px) */
  size?:    'regular' | 'small' | 'large'
  icon?:    React.ReactNode
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:             'bg-accent-fill text-white active:opacity-80',
  secondary:           'bg-fill text-label hoverable active:opacity-70',
  plain:               'bg-transparent text-accent-text active:opacity-50',
  destructive:         'bg-fill text-danger-text hoverable active:opacity-70',
  'destructive-plain': 'bg-transparent text-danger-text active:opacity-50',
}

const SIZES = {
  small:   'min-h-[24px] px-2 text-subhead rounded-[6px]',
  regular: 'min-h-control px-3 text-body rounded-control',
  large:   'min-h-[50px] w-full px-5 text-[17px] font-semibold rounded-[12px]',
}

/** Push button, styled like AppKit / UIKit buttons. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'regular', icon, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const plain = variant === 'plain' || variant === 'destructive-plain'
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none',
        'transition-[background-color,opacity] duration-fast ease-out disabled:opacity-40',
        'min-w-hit',
        SIZES[size],
        plain && size !== 'large' && 'px-1',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  )
})

export default Button
