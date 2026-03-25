/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary:   '#f4f6fb',
          secondary: '#ffffff',
          tertiary:  '#eef1f8',
          hover:     '#f0f3fa',
        },
        border: {
          subtle:  '#e4e9f4',
          default: '#d1d9ee',
          strong:  '#b8c4de',
        },
        text: {
          primary:   '#1e2a3a',
          secondary: '#5a6a84',
          tertiary:  '#96a3bb',
        },
        brand: {
          blue:   '#4a7fe8',
          light:  '#dce8fc',
          dark:   '#2563eb',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(30,42,58,0.06)',
        sm:   '0 1px 2px rgba(30,42,58,0.04)',
        md:   '0 4px 12px rgba(30,42,58,0.08)',
      },
      animation: {
        'fade-in':  'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
