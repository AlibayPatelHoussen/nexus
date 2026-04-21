import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      colors: {
        // Dark theme
        dark: {
          bg:       '#0a0a0f',
          bg2:      '#0f0f17',
          surface:  '#13131e',
          surface2: '#1a1a28',
          surface3: '#20202f',
          border:   'rgba(255,255,255,0.07)',
          border2:  'rgba(255,255,255,0.11)',
          text:     '#f0f0f8',
          text2:    '#9191a8',
          text3:    '#5a5a72',
        },
        // Light theme
        light: {
          bg:       '#f2f2f7',
          bg2:      '#ffffff',
          surface:  '#ffffff',
          surface2: '#f9f9fb',
          surface3: '#f2f2f7',
          border:   'rgba(0,0,0,0.07)',
          border2:  'rgba(0,0,0,0.11)',
          text:     '#1c1c1e',
          text2:    '#48484a',
          text3:    '#8e8e93',
        },
        accent: {
          blue:   '#4f8ef7',
          green:  '#3ecf6e',
          orange: '#f79b4f',
          red:    '#f75a5a',
          purple: '#a78bfa',
          teal:   '#4fd1c5',
          yellow: '#f7d04f',
        },
      },
      borderRadius: {
        DEFAULT: '14px',
        sm: '10px',
        xs: '8px',
      },
      boxShadow: {
        sm:  '0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
        DEFAULT: '0 4px 16px rgba(0,0,0,0.3)',
        lg:  '0 8px 32px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}

export default config
