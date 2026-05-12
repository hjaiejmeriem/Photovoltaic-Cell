/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        solarys: {
          blue: '#1E6FBA',
          'blue-dark': '#0A2540',
          'blue-deep': '#0F1B3D',
          'blue-light': '#5BA3DD',
          'blue-glow': '#3B82F6',
          yellow: '#F4C430',
          'yellow-dark': '#E0B020',
          'yellow-glow': '#FCD34D',
          orange: '#FB923C',
          sky: '#E8F2FB',
          midnight: '#060B1E',
          'midnight-2': '#0B1535',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-slow': 'float 8s ease-in-out infinite',
        'glow': 'glow 3s ease-in-out infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'spin-slow': 'spin 20s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'fade-up': 'fadeUp 0.6s ease-out',
        'gradient': 'gradient 8s ease infinite',
        'orbit': 'orbit 12s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        glow: {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(244,196,48,0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(244,196,48,0.6)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateX(50px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(50px) rotate(-360deg)' },
        },
      },
      backgroundImage: {
        'mesh-gradient': 'radial-gradient(at 0% 0%, #1E6FBA 0%, transparent 50%), radial-gradient(at 100% 0%, #F4C430 0%, transparent 50%), radial-gradient(at 100% 100%, #3B82F6 0%, transparent 50%), radial-gradient(at 0% 100%, #FB923C 0%, transparent 50%)',
        'grid-pattern': 'linear-gradient(rgba(91,163,221,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(91,163,221,.07) 1px, transparent 1px)',
      }
    },
  },
  plugins: [],
}
