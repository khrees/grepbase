import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from '@/lib/providers';
import ToastHost from '@/components/ToastHost';

export const metadata: Metadata = {
  metadataBase: new URL('https://grepbase.khrees.com'),
  title: 'Grepbase | AI Git History Explorer',
  description: 'Explore any GitHub repository commit-by-commit with AI explanations, interactive diffs, and full code history. Understand any codebase in minutes.',
  keywords: ['code exploration', 'git timeline', 'AI code analysis', 'grepbase'],
  openGraph: {
    title: 'Grepbase — Your git history, explained',
    description: 'Paste a GitHub repo. Walk every commit. Understand what changed and why — with AI.',
    url: 'https://grepbase.khrees.com',
    siteName: 'Grepbase',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Grepbase — Your git history, explained',
    description: 'Paste a GitHub repo. Walk every commit. Understand what changed and why — with AI.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>
        <Providers>
          {children}
        </Providers>
        <ToastHost />
      </body>
    </html>
  );
}
