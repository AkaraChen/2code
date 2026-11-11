'use client'

import { useEffect, useState } from 'react'

type CopyButtonProps = Readonly<{
  text: string
  label: string
  copiedLabel: string
}>

export function CopyButton({ text, label, copiedLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // No clipboard (insecure origin, denied permission): the text is still
      // on screen to select by hand, so fail quietly.
    }
  }

  return (
    <button
      type="button"
      className={`copy-button${copied ? ' is-copied' : ''}`}
      onClick={copy}
      aria-live="polite"
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
