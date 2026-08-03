'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = '2code-theme'

type Theme = 'light' | 'dark'

/*
  The resolved theme lives in the DOM (set pre-paint by the boot script) and in
  the OS preference — both external stores, so it is read through
  useSyncExternalStore rather than mirrored into component state.
*/
const listeners = new Set<() => void>()

function emitThemeChange() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(onStoreChange: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')

  listeners.add(onStoreChange)
  query.addEventListener('change', onStoreChange)

  return () => {
    listeners.delete(onStoreChange)
    query.removeEventListener('change', onStoreChange)
  }
}

function resolveCurrentTheme(): Theme {
  const override = document.documentElement.dataset.theme

  if (override === 'dark' || override === 'light') {
    return override
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getServerSnapshot(): Theme {
  return 'light'
}

type ThemeToggleProps = Readonly<{
  label: string
}>

/*
  Three-state model kept deliberately simple: no stored value means "follow the
  system" and CSS handles that alone, so the toggle only ever writes an explicit
  override once the visitor asks for one.
*/
export function ThemeToggle({ label }: ThemeToggleProps) {
  const theme = useSyncExternalStore(
    subscribe,
    resolveCurrentTheme,
    getServerSnapshot,
  )

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'

    document.documentElement.dataset.theme = next

    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private-mode storage failures should not break the toggle.
    }

    emitThemeChange()
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={theme === 'dark'}
    >
      <svg className="theme-icon-light" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3.25" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" />
      </svg>
      <svg className="theme-icon-dark" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
      </svg>
    </button>
  )
}
