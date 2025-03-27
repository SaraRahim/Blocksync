// @type {import('tailwindcss').Config}
module.exports = {
    content: [
      "./src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          brandOrange: '#E66C43',
          brandTeal: '#4CA9AC',
          brandDark: '#212226',
          brandPurple: '#9C2F6D',
          brandProgress: '#276749'
        },
        fontFamily: {
          inter: ['Inter', 'sans-serif']
        }
      },
    },
    plugins: [],
  }