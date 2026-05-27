import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:     '#0B1424',
        bg2:    '#0F1A2E',
        s1:     '#152138',
        s2:     '#1A2A42',
        s3:     '#22334D',
        b1:     '#243752',
        b2:     '#324C6B',
        blue:   '#0A7AFF',
        blue2:  '#3D9FFF',
        violet: '#6D28D9',
        green:  '#059669',
        amber:  '#D97706',
        red:    '#DC2626',
        gold:   '#B8953A',
        goldl:  '#D4AF55',
        t1:     '#D9E8F5',
        t2:     '#6B8FA8',
        t3:     '#607C92',
      },
      fontFamily: {
        sans:  ['Noto Sans Hebrew', 'Plus Jakarta Sans', 'sans-serif'],
        serif: ['DM Serif Display', 'serif'],
        mono:  ['DM Mono', 'monospace'],
      },
      fontSize: {
        '3xs': ['9px',  '12px'],
        '2xs': ['10px', '14px'],
      },
      letterSpacing: {
        kicker: '0.2em',
        label:  '0.15em',
      },
      keyframes: {
        fadeUp: {
          'from': { opacity: '0', transform: 'translateY(12px)' },
          'to':   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          'from': { opacity: '0' },
          'to':   { opacity: '1' },
        },
      },
      animation: {
        'fade-up':   'fadeUp 600ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in':   'fadeIn 400ms ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
