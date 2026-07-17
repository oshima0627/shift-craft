/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 落ち着いた青系のブランドカラー（視認性重視）
        brand: {
          50: '#eff5ff',
          100: '#dbe8ff',
          200: '#b9d2ff',
          300: '#8ab4ff',
          400: '#5a90f5',
          500: '#3b6fe0',
          600: '#2f59c4',
          700: '#264aa3',
          800: '#213e85',
          900: '#1f376e',
        },
      },
    },
  },
  plugins: [],
}
