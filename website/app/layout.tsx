import type { Metadata } from 'next'
import Script from 'next/script'
import type { ReactNode } from 'react'
import '@fontsource/zilla-slab/400.css'
import '@fontsource/zilla-slab/500.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/geist-mono/400.css'
import './globals.css'
import { defaultLocale } from './i18n/resources'
import { siteConfig } from './site-config'

export const dynamic = 'error'

// `lang` follows the path (not the browser) so the Chinese page is always
// announced as zh-CN, and an explicit footer choice wins over the auto-redirect.
const localeBootstrapScript = `(function(){var path=window.location.pathname;document.documentElement.lang=path.indexOf('/zh-cn')===0?'zh-CN':'en';var stored=null;try{stored=localStorage.getItem('2code-locale');}catch(e){}var lang=(navigator.languages&&navigator.languages[0])||navigator.language||'en';var prefersZh=stored?stored==='zh-cn':/^zh/i.test(lang);if(path==='/'&&prefersZh){window.location.replace('/zh-cn');}})();`

// Runs before first paint so a stored preference never flashes the wrong theme.
// No stored value means "follow the system", which CSS handles without JS.
const themeBootstrapScript = `(function(){try{var t=localStorage.getItem('2code-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}}catch(e){}})();`

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
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
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
