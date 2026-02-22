import type { Metadata } from 'next';
import './globals.css';
import ToastHost from '@/components/ToastHost';

export const metadata: Metadata = {
  title: 'Grepbase - Understand Code Through Time',
  description: 'Walk through any open source project\'s history with AI-powered explanations. Learn how projects evolved, one commit at a time.',
  keywords: ['code', 'git', 'learning', 'AI', 'open source', 'commits']
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
