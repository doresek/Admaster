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
        bg:     '#070A0E',
        bg2:    '#0C1118',
        s1:     '#111A24',
        s2:     '#162030',
        s3:     '#1D2D3E',
        b1:     '#1E2F42',
        b2:     '#2A4158',
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
        t3:     '#2E4459',
      },
      fontFamily: {
        sans:  ['Noto Sans Hebrew', 'Plus Jakarta Sans', 'sans-serif'],
        serif: ['DM Serif Display', 'serif'],
        mono:  ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
