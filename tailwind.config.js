/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          50:  '#f0f7f0',
          100: '#d9eeda',
          500: '#2d7a3a',
          600: '#236130',
          700: '#1a4a25',
          900: '#0d2713',
        },
        earth: {
          100: '#f5ede0',
          400: '#c4956a',
          600: '#8b5e3c',
        },
        alert: {
          red:    '#dc2626',  // injury/death
          orange: '#ea580c',  // crop raid/property
          yellow: '#ca8a04',  // sighting
          green:  '#16a34a',  // all clear
        },
        neutral: {
          50:  '#fafaf9',
          900: '#1c1917',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Noto Sans', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
