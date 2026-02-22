"use client"

import { IconButton } from "@chakra-ui/react"
import { useRichTextEditorContext } from "@/components/ui/rich-text-editor-context"
import * as React from "react"
import {
  LuBold,
  LuItalic,
  LuStrikethrough,
  LuCode,
  LuHighlighter,
  LuList,
  LuListOrdered,
  LuListChecks,
  LuQuote,
  LuMinus,
  LuUndo2,
  LuRedo2,
  LuSquareCode,
} from "react-icons/lu"

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

// Pre-built controls

export const Bold = createBooleanControl({
  label: "Bold",
  icon: <LuBold />,
  isActive: (e) => !!e?.isActive("bold"),
  command: (e) => { e.chain().focus().toggleBold().run() },
})

export const Italic = createBooleanControl({
  label: "Italic",
  icon: <LuItalic />,
  isActive: (e) => !!e?.isActive("italic"),
  command: (e) => { e.chain().focus().toggleItalic().run() },
})

export const Strikethrough = createBooleanControl({
  label: "Strikethrough",
  icon: <LuStrikethrough />,
  isActive: (e) => !!e?.isActive("strike"),
  command: (e) => { e.chain().focus().toggleStrike().run() },
})

export const Code = createBooleanControl({
  label: "Code",
  icon: <LuCode />,
  isActive: (e) => !!e?.isActive("code"),
  command: (e) => { e.chain().focus().toggleCode().run() },
})

export const Highlight = createBooleanControl({
  label: "Highlight",
  icon: <LuHighlighter />,
  isActive: (e) => !!e?.isActive("highlight"),
  command: (e) => { e.chain().focus().toggleHighlight().run() },
})

export const BulletList = createBooleanControl({
  label: "Bullet List",
  icon: <LuList />,
  isActive: (e) => !!e?.isActive("bulletList"),
  command: (e) => { e.chain().focus().toggleBulletList().run() },
})

export const OrderedList = createBooleanControl({
  label: "Ordered List",
  icon: <LuListOrdered />,
  isActive: (e) => !!e?.isActive("orderedList"),
  command: (e) => { e.chain().focus().toggleOrderedList().run() },
})

export const TaskList = createBooleanControl({
  label: "Task List",
  icon: <LuListChecks />,
  isActive: (e) => !!e?.isActive("taskList"),
  command: (e) => { e.chain().focus().toggleTaskList().run() },
})

export const Blockquote = createBooleanControl({
  label: "Blockquote",
  icon: <LuQuote />,
  isActive: (e) => !!e?.isActive("blockquote"),
  command: (e) => { e.chain().focus().toggleBlockquote().run() },
})

export const Hr = createBooleanControl({
  label: "Horizontal Rule",
  icon: <LuMinus />,
  isActive: () => false,
  command: (e) => { e.chain().focus().setHorizontalRule().run() },
})

export const CodeBlock = createBooleanControl({
  label: "Code Block",
  icon: <LuSquareCode />,
  isActive: (e) => !!e?.isActive("codeBlock"),
  command: (e) => { e.chain().focus().toggleCodeBlock().run() },
})

export const Undo = createBooleanControl({
  label: "Undo",
  icon: <LuUndo2 />,
  isActive: () => false,
  command: (e) => { e.chain().focus().undo().run() },
})

export const Redo = createBooleanControl({
  label: "Redo",
  icon: <LuRedo2 />,
  isActive: () => false,
  command: (e) => { e.chain().focus().redo().run() },
})
