/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        ink: '#070D1A',
        panel: '#0C1526',
        card: '#111D33',
        edge: '#1E2C47',
        brand: { DEFAULT: '#4F7DF7', soft: '#7FA1FA' },
        ok: '#10B981',
        warn: '#F59E0B',
        bad: '#EF4444',
        idle: '#64748B',
      },
      boxShadow: {
        glow: '0 0 24px rgba(79,125,247,0.18)',
        card: '0 8px 30px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};
