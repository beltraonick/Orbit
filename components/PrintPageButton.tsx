'use client'

// Plain browser print — works on a computer; on iPhone use SharePdfButton.
export function PrintPageButton({ label = 'Print', className, style }: { label?: string; className?: string; style?: React.CSSProperties }) {
  return (
    <button type="button" data-pdf-ignore onClick={() => window.print()} className={className} style={style}>
      {label}
    </button>
  )
}
