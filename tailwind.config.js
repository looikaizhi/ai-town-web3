/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    fontFamily: {
      display: ['var(--font-display)', 'sans-serif'],
      body: ['var(--font-body)', 'monospace'],
    },
    extend: {
      colors: {
        brown: {
          100: '#FFFFFF',
          200: '#EAD4AA',
          300: '#E4A672',
          500: '#B86F50',
          700: '#743F39',
          800: '#3F2832',
          900: '#181425',
        },
        clay: {
          100: '#C0CBDC',
          300: '#8B9BB4',
          500: '#5A6988',
          700: '#3A4466',
          900: '#181425',
        },
        // SP2 semantic action colors
        buy: '#22C55E',
        sell: '#DC2626',
        info: '#2563EB',
        gold: '#EAB308',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
