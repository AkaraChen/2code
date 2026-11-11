'use client'

import { useEffect, useState } from 'react'
import { BranchIcon, ChevronIcon } from './ui-icons'

type Lane = Readonly<{
  id: string
  label: string
  /** Shown instead of a status dot, e.g. "Needs you" on Install. */
  badge?: string
}>

type ChapterRailProps = Readonly<{
  label: string
  project: string
  lanes: readonly Lane[]
  legend: Readonly<{ working: string; done: string; idle: string }>
}>

/*
  The table of contents is drawn as 2code's own sidebar: one project, one
  profile per chapter. Chapters already read turn green, the one in view pulses
  like a working agent, the rest wait as empty rings. Server output (and no-JS)
  shows every lane idle, which is a fine resting state.
*/
export function ChapterRail({ label, project, lanes, legend }: ChapterRailProps) {
  const [current, setCurrent] = useState(-1)

  useEffect(() => {
    let frame = 0

    const update = () => {
      frame = 0
      const line = window.innerHeight * 0.35
      let next = -1

      lanes.forEach((lane, index) => {
        const target = document.getElementById(lane.id)
        if (target && target.getBoundingClientRect().top < line) {
          next = index
        }
      })

      setCurrent(next)
    }

    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [lanes])

  return (
    <nav className="rail" aria-label={label}>
      <p className="rail-label">{project}</p>
      <div className="rail-project">
        <img src="/app-icon.png" alt="" width={18} height={18} />
        2code
        <ChevronIcon />
      </div>
      <ol className="rail-lanes">
        {lanes.map((lane, index) => {
          const state =
            index < current ? 'done' : index === current ? 'working' : 'idle'

          return (
            <li key={lane.id}>
              <a
                className="lane"
                href={`#${lane.id}`}
                aria-current={index === current ? 'location' : undefined}
              >
                <BranchIcon />
                <span>{lane.label}</span>
                {lane.badge ? (
                  <span className="needs-you">{lane.badge}</span>
                ) : (
                  <span className={`status-dot is-${state}`} aria-hidden="true" />
                )}
              </a>
            </li>
          )
        })}
      </ol>
      <div className="rail-legend" aria-hidden="true">
        <span>
          <span className="status-dot is-working" />
          {legend.working}
        </span>
        <span>
          <span className="status-dot is-done" />
          {legend.done}
        </span>
        <span>
          <span className="status-dot is-idle" />
          {legend.idle}
        </span>
      </div>
    </nav>
  )
}
