import type { ReactNode } from 'react'

/*
  The handful of 24px stroke icons the drawn app windows and the rail need,
  matching the lucide set Herdr and 2code use. Decorative everywhere they appear.
*/
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function BranchIcon() {
  return (
    <Icon>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Icon>
  )
}

export function TerminalIcon() {
  return (
    <Icon>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </Icon>
  )
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function ChevronIcon() {
  return (
    <Icon>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

export function CommentIcon() {
  return (
    <Icon>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Icon>
  )
}

export function AgentIcon() {
  return (
    <Icon>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4M9 13v2M15 13v2" />
    </Icon>
  )
}

export function ArrowUpRightIcon() {
  return (
    <svg className="ui-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h6v6" />
      <path d="m5 11 7-7" />
    </svg>
  )
}
