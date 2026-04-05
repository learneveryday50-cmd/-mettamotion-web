/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './blog/**/*.html',
    './terms/**/*.html',
    './privacy/**/*.html',
    './refund/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        navy:  { DEFAULT: '#080d18', 2: '#0d1526', 3: '#111d35', 4: '#182440' },
        brand: { DEFAULT: '#1a6fff', dim: '#1256cc', glow: '#4d97ff' },
        teal:  { DEFAULT: '#00d4ff', dim: '#00a8cc' },
        smoke: { DEFAULT: '#8a9bbf', dim: '#3a4a6b' },
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        mono:    ['Space Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
