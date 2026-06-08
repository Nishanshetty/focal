/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts}'],
  theme: {
    extend: {
      colors: {
        bg:              '#0c1209',
        surface:         '#131a11',
        card:            '#192217',
        accent:          '#8fab8d',
        'accent-bright': '#c4d4c2',
        'accent-dim':    '#3a4e38',
        cream:           '#f0ede4',
        muted:           '#5a6859',
        border:          'rgba(143, 171, 141, 0.12)',
      },
      fontFamily: {
        headline: ['Epilogue', 'sans-serif'],
        sans:     ['Manrope', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
