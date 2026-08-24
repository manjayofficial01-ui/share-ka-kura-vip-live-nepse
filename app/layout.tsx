import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, IBM_Plex_Mono, Noto_Sans_Devanagari } from 'next/font/google'
import './globals.css'

const _spaceGrotesk = Space_Grotesk({ subsets: ['latin'] })
const _plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'] })
// Devanagari fallback so "का कुरा" renders with proper glyphs everywhere
const _notoDevanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], weight: ['400', '700'] })

export const metadata: Metadata = {
  title: 'Share का कुरा VIP | AI Powered NEPSE Terminal',
  description:
    'AI powered live market terminal for the Nepal Stock Exchange: index values, market status, sector performance, and security quotes.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#070B14',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark bg-background">
      <body className="antialiased font-sans">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
