/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        brand: {
          dark: '#1e3a8a',
          DEFAULT: '#0369a1',
          light: '#0284c7',
          green: '#58a967',
        },
      },
    },
  },
  plugins: [],
}
