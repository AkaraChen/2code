'use client'

import { useEffect, useRef } from 'react'

export function HeroParallaxMedia() {
  const mediaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const media = mediaRef.current

    if (!media) {
      return
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0

    const updateParallax = () => {
      frame = 0

      if (motionQuery.matches) {
        media.style.setProperty('--hero-parallax-y', '0px')
        return
      }

      const offset = Math.max(window.scrollY * -0.14, -160)
      media.style.setProperty('--hero-parallax-y', `${offset}px`)
    }

    const requestParallaxUpdate = () => {
      if (frame) {
        return
      }

      frame = window.requestAnimationFrame(updateParallax)
    }

    updateParallax()
    window.addEventListener('scroll', requestParallaxUpdate, { passive: true })
    window.addEventListener('resize', requestParallaxUpdate)
    motionQuery.addEventListener('change', requestParallaxUpdate)

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }

      window.removeEventListener('scroll', requestParallaxUpdate)
      window.removeEventListener('resize', requestParallaxUpdate)
      motionQuery.removeEventListener('change', requestParallaxUpdate)
    }
  }, [])

  return (
    <div className="hero-fixed-media" aria-hidden="true" ref={mediaRef}>
      <img
        src="/hero.webp"
        alt=""
        className="hero-fixed-banner"
        width={1920}
        height={1322}
        loading="eager"
        decoding="async"
      />
    </div>
  )
}
