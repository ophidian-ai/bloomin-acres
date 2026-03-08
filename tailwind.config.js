/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./*.html'],
  theme: {
    extend: {
      colors: {
        // Scheme A (index, account, club)
        wheat: '#EDA339',
        sage: '#7A9B8E',
        'sage-dark': '#4E6E64',
        'sage-light': '#A8C4BB',
        rust: '#C85A3A',
        berry: '#8B3A3A',
        earth: '#4A3322',
        'earth-mid': '#6B4C35',
        cream: '#FAF0E6',
        'cream-dark': '#F0E4D0',
        'cream-warm': '#EDD9B8',
        // Scheme B aliases (admin, menu, product)
        'wheat-gold': '#EDA339',
        'sage-green': '#7A9B8E',
        'burnt-orange': '#C85A3A',
        'berry-red': '#8B3A3A',
        'earth-brown': '#4A3322',
        'farm-cream': '#FAF0E6',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        playfair: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        lora: ['"Lora"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
