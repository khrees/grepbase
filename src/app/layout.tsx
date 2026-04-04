import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/lib/providers';
import ToastHost from '@/components/ToastHost';

export const metadata: Metadata = {
  title: 'Grepbase | AI-Powered Code Exploration',
  description: 'Understand the evolution of any codebase with interactive timelines and AI-generated insights. The eagle-eye view of your repository.',
  keywords: ['code exploration', 'git timeline', 'AI code analysis', 'grepbase'],
  openGraph: {
    title: 'Grepbase | Understand Code Through Time',
    description: 'Transform complex git histories into interactive AI-powered walkthroughs.',
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
    title: 'Grepbase | Understand Code Through Time',
    description: 'Transform complex git histories into interactive AI-powered walkthroughs.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
        </Providers>
        <ToastHost />
      </body>
    </html>
  );
}
