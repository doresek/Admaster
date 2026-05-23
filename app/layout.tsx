import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AdMaster Pro',
  description: 'AI Social Media Platform — Powered by Claude',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Hebrew:wght@300;400;500;600;700&family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'Noto Sans Hebrew', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
