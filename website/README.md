# 2code Site

Marketing site for 2code, built with Next.js App Router in static export mode.

## Scripts

- `bun run dev` starts the Next.js dev server (drafts visible).
- `bun run build` creates the static export, then emits the blog Markdown alternates.
- `bun run build:drafts` same build with `draft: true` posts included.
- `bun run lint` runs ESLint.
- `bun run preview` serves the generated `out/` folder locally.

## Static Output

`next.config.mjs` sets `output: 'export'`, so a production build emits a fully static site into `out/`.

## Assets

Public assets live in `public/`, and the site entrypoint lives in `app/`.

## Blog

### Where posts live

```
content/blog/en/<slug>.md       → /blog/<slug>
content/blog/zh-cn/<slug>.md    → /zh-cn/blog/<slug>
```

One Markdown file per post, plain CommonMark (tables and footnotes included).
Raw HTML is allowed inside a post. The file name is the slug and must match the
`slug` field in the frontmatter — the build fails otherwise.

The two languages are independent: a post does not need a translation. When a
slug exists in only one language, the other language's `hreflang` link and the
footer language switch point at that language's blog index instead of a 404.

### Frontmatter

```markdown
---
title: Why worktrees beat branch switching
description: One sentence used in the list, the meta description, OG, and RSS.
date: 2026-07-31
slug: why-worktrees-beat-branch-switching
tags: [worktrees, git]
draft: false
coverImage: /screenshots/worktree.png
---
```

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Article heading, list entry, `og:title` |
| `description` | yes | List blurb, meta description, OG, RSS `<description>` |
| `date` | yes | `YYYY-MM-DD`; sorts the list (newest first) and sets `article:published_time` |
| `slug` | yes | Must equal the file name without its extension |
| `tags` | no | Shown on the list and article, emitted as `keywords` and RSS `<category>` |
| `draft` | no | `true` hides the post from production builds |
| `coverImage` | no | Root-relative image shown above the article and used as the OG image |
| `ogImage` | no | Share image only, when it should differ from the cover |

Reading time is computed from the body (~200 words/min for Latin text, ~350
characters/min for Chinese) — it is not a frontmatter field.

### Writing and previewing

1. Create `content/blog/<locale>/<slug>.md` with the frontmatter above and
   `draft: true`.
2. `bun run dev`, then open `/blog/<slug>` (or `/zh-cn/blog/<slug>`). Drafts are
   always visible in dev and carry a "Draft" badge.
3. To see a draft in a real static build: `bun run build:drafts && bun run preview`.
4. Check both themes with the header toggle — code blocks are highlighted at
   build time with both palettes baked in.

### Publishing

Flip `draft` to `false` (or remove it) and merge. Everything else follows from
the file: the list entry, the article page, `sitemap.xml`, the RSS feed, and the
`.md` alternate are all derived from `content/blog/`. Nothing else needs editing.

### Implementation notes

- Rendering is `markdown-it` + `markdown-it-footnote`, with Shiki for syntax
  highlighting. All of it runs at build time; the blog ships no client JS.
  Shiki emits both the light and dark palette as CSS variables per token, so the
  existing theme toggle works with no re-render.
- Article styles live under `/* ---------- blog ---------- */` in
  `app/globals.css`; the rendered body is scoped to `.prose`.
- Markdown alternates (`/blog.md`, `/blog/<slug>.md`) are written into `out/`
  by `scripts/emit-blog-markdown.mjs` after `next build`. The App Router cannot
  produce a `.md` URL for a dynamic segment, and the posts are already Markdown,
  so copying them out is both cheaper and more faithful than re-serialising HTML.
- With no published posts, `/blog/[slug]` still has to prerender something —
  `output: 'export'` rejects a dynamic route with zero params. In that case the
  route emits a single unlinked, `noindex` stub at `/blog/no-posts-yet` that
  shows the same empty state as the index. It disappears as soon as one post is
  published.
- `content/blog/*/example-post.md` is a permanent draft kept as a rendering
  fixture: it exercises every supported element in one page, so template changes
  can be checked at a glance. It never ships.

## GEO / SEO surfaces

Static discovery files (copied into `out/` on build):

| Path | Role |
| --- | --- |
| `/llms.txt` | Short product map for AI systems |
| `/llms-full.txt` | Full product brief, comparisons, install facts |
| `/index.md` | Markdown alternate of the English homepage |
| `/zh-cn.md` | Markdown alternate of the Chinese homepage |
| `/blog.md`, `/zh-cn/blog.md` | Markdown alternates of the blog indexes |
| `/blog/<slug>.md` | Markdown alternate of each post (both locales) |
| `/blog/feed.xml`, `/zh-cn/blog/feed.xml` | RSS 2.0 feeds |
| `/robots.txt` | Generated from `app/robots.ts` (search bots allowed, training crawlers blocked) |
| `/sitemap.xml` | Generated from `app/sitemap.ts` |

HTML pages advertise the Markdown alternate via `rel="alternate" type="text/markdown"` in metadata.
