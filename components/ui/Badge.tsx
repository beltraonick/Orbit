type BadgeVariant = 'default' | 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'brand' | 'purple'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-surface-elevated text-secondary border-[var(--border)]',
  green: 'bg-green/10 text-green border-green/20',
  amber: 'bg-amber/10 text-amber border-amber/20',
  red: 'bg-danger/10 text-danger border-danger/20',
  blue: 'bg-blue/10 text-blue border-blue/20',
  gray: 'bg-surface-elevated text-tertiary border-[var(--border)]',
  brand: 'bg-brand/10 text-brand border-brand/20',
  purple: 'bg-purple/10 text-purple border-purple/20',
}

export function Badge({ variant = 'default', className = '', children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
        variants[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}
