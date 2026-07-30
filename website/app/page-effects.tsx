'use client'

import { useEffect } from 'react'

const SHORTCUTS: Record<string, string> = {
  d: 'cta-download',
  f: 'cta-features',
  g: 'cta-github',
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

/*
  Two behaviours that must not run on the server:

  1. Scroll-triggered reveals. The `reveal-ready` flag is what arms the hidden
     state in CSS, so without JS (or without IntersectionObserver) nothing is
     ever hidden — the old load-triggered animation had already finished for
     everything below the fold by the time it scrolled into view.
  2. The single-key shortcuts advertised by the keycaps on each CTA. They click
     the real anchors so target/rel behaviour stays identical to a mouse click.
*/
export function PageEffects() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return
    }

    const root = document.documentElement
    root.classList.add('reveal-ready')

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    )

    for (const node of document.querySelectorAll('.reveal')) {
      observer.observe(node)
    }

    return () => {
      observer.disconnect()
      root.classList.remove('reveal-ready')
    }
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented ||
        isTypingTarget(event.target)
      ) {
        return
      }

      const targetId = SHORTCUTS[event.key.toLowerCase()]

      if (!targetId) {
        return
      }

      const element = document.getElementById(targetId)

      if (!(element instanceof HTMLAnchorElement)) {
        return
      }

      event.preventDefault()
      element.click()
    }

    window.addEventListener('keydown', handleKeydown)

    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [])

  return null
}
