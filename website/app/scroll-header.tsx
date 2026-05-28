'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import { type AppLocale, type resources } from './i18n/resources'

type Messages = (typeof resources)[AppLocale]

type ScrollHeaderProps = Readonly<{
  messages: Messages
}>

function ExternalIcon() {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 4h6v6" />
      <path d="m5 11 7-7" />
    </svg>
  )
}

export function ScrollHeader({ messages }: ScrollHeaderProps) {
  const [hasScrolledPastHero, setHasScrolledPastHero] = useState(false)

  const updateHeaderState = useEffectEvent(() => {
    const threshold = Math.max(window.innerHeight - 88, 0)
    setHasScrolledPastHero(window.scrollY >= threshold)
  })

  useEffect(() => {
    const handleViewportChange = () => {
      updateHeaderState()
    }

    updateHeaderState()
    window.addEventListener('scroll', handleViewportChange, { passive: true })
    window.addEventListener('resize', handleViewportChange)

    return () => {
      window.removeEventListener('scroll', handleViewportChange)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [])

  return (
    <header
      className={`topbar ${
        hasScrolledPastHero ? 'topbar-scrolled' : 'topbar-transparent'
      }`}
    >
      <div className="topbar-inner">
        <a className="brand" href="#hero" aria-label={messages.nav.home}>
          <img
            className="brand-icon"
            src="/favicon.ico"
            alt=""
            width={32}
            height={32}
            decoding="async"
          />
          <span className="brand-name">2code</span>
        </a>

        <nav className="topnav" aria-label={messages.nav.primary}>
          <a href="#features">{messages.nav.features}</a>
          <a href="#faq">{messages.nav.faq}</a>
          <a
            href="https://github.com/akarachen/2code"
            target="_blank"
            rel="noreferrer"
          >
            <span>{messages.nav.github}</span>
            <ExternalIcon />
          </a>
        </nav>
      </div>
    </header>
  )
}
