declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it'

  /** markdown-it 15 ships its own types; this plugin does not. */
  const footnotePlugin: (md: MarkdownIt) => void
  export default footnotePlugin
}
