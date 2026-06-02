import type { Metadata } from 'next'
import Script from 'next/script'
import type { ReactNode } from 'react'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import './globals.css'
import { defaultLocale } from './i18n/resources'
import { siteConfig } from './site-config'

export const dynamic = 'error'

const localeBootstrapScript = `(function(){var path=window.location.pathname;var lang=(navigator.languages&&navigator.languages[0])||navigator.language||'en';var isZh=/^zh/i.test(lang);document.documentElement.lang=isZh?'zh-CN':'en';if(path==='/'&&isZh){window.location.replace('/zh-cn/');}})();`

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
}

type RootLayoutProps = Readonly<{
  children: ReactNode
}>

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang={defaultLocale} data-scroll-behavior="smooth">
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript }} />
        {process.env.NODE_ENV === 'development' ? (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  )
}
