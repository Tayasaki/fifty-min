module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FAF8F6',
        surface: '#FFFFFF',
        'surface-2': '#F4EEF7',
        teal: '#7BB7AA',
        purple: '#B8A0BB',
        gold: '#C9973E',
        'text-primary': '#1F1F2E',
        'text-muted': '#6B7280',
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        spotlight: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(123,183,170,0.18) 0%, transparent 70%)',
        'spotlight-purple': 'radial-gradient(ellipse 60% 50% at 80% 0%, rgba(184,160,187,0.14) 0%, transparent 70%)',
        'hero-gradient': 'linear-gradient(135deg, rgba(123,183,170,0.08) 0%, rgba(184,160,187,0.08) 100%)',
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'float-delayed': 'float 6s ease-in-out infinite 2s',
        'float-slow': 'float 8s ease-in-out infinite 1s',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in': 'fadeIn 1s ease-out forwards',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(-20px) rotate(5deg)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'teal-glow': '0 4px 24px rgba(123,183,170,0.35)',
        'purple-glow': '0 4px 24px rgba(184,160,187,0.35)',
        'gold-glow': '0 4px 20px rgba(201,151,62,0.25)',
        'teal-glow-sm': '0 2px 12px rgba(123,183,170,0.25)',
        card: '0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
        'card-hover': '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
