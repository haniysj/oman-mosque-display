/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'Tahoma', 'Arial', 'sans-serif'],
        amiri: ['Amiri', 'Cairo', 'serif'],
      },
      colors: {
        ink: '#102A43', ink2: '#334E68', muted: '#627D98', paper: '#EEF2F6', line: '#D9E2EC',
        teal: { DEFAULT: '#1F7A6D', soft: '#D5EFEA' },
        rose: { DEFAULT: '#C2453A', soft: '#F8DEDB' },
        saffron: { DEFAULT: '#E09A2D', soft: '#FBEBD0' },
        gold: { DEFAULT: '#D4AF61', light: '#F1DFA8', deep: '#9C7A2E' },
        emerald: { night: '#062A22', deep: '#0B3D30', mid: '#11553F' },
        navy: { night: '#07142A', deep: '#0E2244' },
      },
    },
  },
  plugins: [],
};
