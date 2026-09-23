import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic tokens — driven by CSS variables so they flip in dark mode automatically
        background: 'var(--background)',
        surface: 'var(--surface)',
        'surface-elevated': 'var(--surface-elevated)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
        // RGB-channel format enables opacity modifiers (bg-brand/10, text-green/80, etc.)
        brand: 'rgb(var(--color-brand) / <alpha-value>)',
        'brand-hover': 'rgb(var(--color-brand-hover) / <alpha-value>)',
        green: 'rgb(var(--color-green) / <alpha-value>)',
        amber: 'rgb(var(--color-amber) / <alpha-value>)',
        blue: 'rgb(var(--color-blue) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        purple: 'rgb(var(--color-purple) / <alpha-value>)',
      },
      borderRadius: {
        card: '16px',
        button: '10px',
        input: '10px',
      },
      fontFamily: {
        sans: ['-apple-system', 'SF Pro Display', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
