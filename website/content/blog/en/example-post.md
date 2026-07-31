---
title: 'Example post: everything the blog renders'
description: A draft kept in the repo as a rendering fixture — it exercises every Markdown element the blog styles, and never ships.
date: 2026-07-31
slug: example-post
tags: [meta, example]
draft: true
---

This file is **not** a real post. It stays marked `draft: true` so it never
reaches production, and exists so anyone touching the blog templates can see
every element render at once: run `bun run dev` and open `/blog/example-post`.

Delete it once there are real posts to look at.

## Headings and prose

Paragraphs use the site's reading measure. Inline elements: `inline code`,
[an internal link](/blog), [an external link](https://github.com/AkaraChen/2code),
**bold**, *italic*, and a <kbd>⌘</kbd> keycap.

### A third-level heading

> A blockquote, for pulling a line out of the flow.

## Lists

- An unordered item
- Another item, long enough to wrap onto a second line so the hanging indent is
  visible at narrow widths
  - A nested item

1. First
2. Second
3. Third

## Code

```bash
brew install --cask akarachen/tap/2code
```

```typescript
export function readingMinutes(text: string): number {
  const words = text.match(/[A-Za-z0-9]+/g) ?? []
  return Math.max(1, Math.round(words.length / 200))
}
```

```rust
fn main() {
    println!("2code");
}
```

## Table

| Surface | Path | Role |
| --- | --- | --- |
| List | `/blog` | Published posts, newest first |
| Post | `/blog/<slug>` | One article |
| Feed | `/blog/feed.xml` | RSS 2.0 |

## Footnotes

Worktrees are the unit of isolation here.[^worktree]

[^worktree]: Each profile gets its own `git worktree`, so terminals in one lane
never touch another lane's checkout.

---

That is the full element set the article styles cover.
