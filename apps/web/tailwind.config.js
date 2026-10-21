/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces (names kept from v1 so every screen re-themes from tokens)
        obsidian: { 950: v('bg'), 900: v('surface'), 850: v('surface-2'), 800: v('surface-3'), 700: v('line'), 600: v('line-strong'), 500: v('line-stronger') },
        lime: { DEFAULT: v('accent'), 400: v('accent-hover'), 500: v('accent'), 600: v('accent-press'), 900: v('accent-deep') },
        forest: v('forest'),
        ink: { DEFAULT: v('text'), muted: v('text-muted'), faint: v('text-faint') },
        danger: v('danger'),
        warn: v('warn'),
        info: v('info'),
        onaccent: v('on-accent'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Inter', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 0 rgb(255 255 255 / 0.03) inset, 0 12px 32px -18px rgb(0 0 0 / 0.55)',
        lift: '0 18px 50px -24px rgb(0 0 0 / 0.65)',
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.15rem' },
    },
  },
  plugins: [],
};
