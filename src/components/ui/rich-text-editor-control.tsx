"use client"

import { IconButton } from "@chakra-ui/react"
import { useRichTextEditorContext } from "@/components/ui/rich-text-editor-context"
import * as React from "react"

interface BooleanControlOptions {
  icon: React.ReactElement
  label: string
  isActive: (editor: ReturnType<typeof useRichTextEditorContext>["editor"]) => boolean
  command: (editor: NonNullable<ReturnType<typeof useRichTextEditorContext>["editor"]>) => void
}

export function createBooleanControl(options: BooleanControlOptions) {
  const Control = React.forwardRef<HTMLButtonElement>(
    function BooleanControl(_props, ref) {
      const { editor } = useRichTextEditorContext()
      if (!editor) return null
      const active = options.isActive(editor)
      return (
        <IconButton
          ref={ref}
          size="xs"
          variant={active ? "subtle" : "ghost"}
          aria-label={options.label}
          onClick={() => options.command(editor)}
        >
          {options.icon}
        </IconButton>
      )
    },
  )
  Control.displayName = options.label
  return Control
}

export function createSelectControl(_options: Record<string, unknown>) {
  return () => null
}

export function createSwatchControl(_options: Record<string, unknown>) {
  return () => null
}
