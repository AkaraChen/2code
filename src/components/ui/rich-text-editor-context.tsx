"use client"

import type { Editor } from "@tiptap/react"
import { createContext, useContext } from "react"

interface RichTextEditorContextValue {
  editor: Editor | null
}

export const RichTextEditorContext =
  createContext<RichTextEditorContextValue | null>(null)

export function useRichTextEditorContext() {
  const context = useContext(RichTextEditorContext)
  if (!context) {
    throw new Error(
      "useRichTextEditorContext must be used within RichTextEditor.Root",
    )
  }
  return context
}
