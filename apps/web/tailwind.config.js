/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: { 950: '#07080a', 900: '#0c0d10', 850: '#111317', 800: '#16181d', 700: '#1e2128', 600: '#2a2e37', 500: '#3a3f4a' },
        lime: { DEFAULT: '#c6ff1a', 400: '#d4ff4d', 500: '#c6ff1a', 600: '#a6d916', 900: '#2b3a05' },
        ink: { DEFAULT: '#f4f6f8', muted: '#9aa3b2', faint: '#6b7280' },
        danger: '#ff5c5c',
        warn: '#ffb020',
        info: '#4cc3ff',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
