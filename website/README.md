# 2code Site

Marketing site for 2code, built with the Next.js App Router.

## Scripts

- `bun run dev` starts the Next.js dev server (drafts visible).
- `bun run build` runs `next build`.
- `bun run build:drafts` same build with `draft: true` posts included.
- `bun run build:scheduled` same build with not-yet-published posts included.
- `bun run lint` runs ESLint.
- `bun run start` serves an existing build.
- `bun run preview` builds and then serves it.

## Deployment

Netlify, running the site on the Next.js Runtime (`@netlify/plugin-nextjs`) —
`publish = ".next"`, not a static folder.

This is not a static export. Every page is still prerendered at build time, but
each blog surface carries `revalidate = 3600`, which is what lets a post
published by date appear without a deploy (see **Scheduled publishing**). Pages
with no time dependency — the homepages — are plain static output either way.

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
publishAt: 2026-08-05
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
| `publishAt` | no | Instant the post goes public. Defaults to `date` — set it only when the displayed date and the release moment differ |
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

### Scheduled publishing

A post is public once its publish instant has passed, and that instant is
`publishAt` — or `date` when `publishAt` is absent. So a post dated in the
future is not published yet; use `publishAt` when the date shown on the article
should differ from the moment it goes live.

```markdown
date: 2026-08-05        # shown on the post
publishAt: 2026-08-05   # implied by `date`; can be omitted
publishAt: 2026-08-05T09:00:00+08:00   # a specific local hour
```

A bare `YYYY-MM-DD` is **UTC midnight** — the same frame the daily rebuild runs
in. Write the offset out when a post has to land at a local hour.

Before its publish instant the post is treated exactly like a draft: it is
absent from the index, the sitemap, the feed, and the `.md` alternates, and its
URL is not built at all (so it 404s). It stays visible in `bun run dev` with a
"Scheduled for …" badge.

**No deploy is needed for a post to go live.** The schedule is evaluated on the
server, and every blog surface has `revalidate = 3600`:

- The **article URL** is live on the first request after its publish instant.
  It is not in `generateStaticParams` at build time, so it renders on demand.
- The **index, feed, sitemap and `.md` alternates** were prerendered without it,
  so they pick it up on their next revalidate — within an hour of the instant.

So an article can be linked immediately and the listings catch up shortly after.
Anything finer than that hour is not worth expressing in `publishAt`.

To check a schedule locally, override the clock instead of waiting:

```bash
BLOG_NOW=2026-08-06 bun run build   # build as if it were Aug 6
bun run build:scheduled             # include scheduled posts, keep drafts hidden
```

### Implementation notes

- Rendering is `markdown-it` + `markdown-it-footnote`, with Shiki for syntax
  highlighting. It runs on the server, never in the browser; the blog ships no
  client JS. Shiki emits both the light and dark palette as CSS variables per
  token, so the existing theme toggle works with no re-render.
- Article styles live under `/* ---------- blog ---------- */` in
  `app/globals.css`; the rendered body is scoped to `.prose`.
- Markdown alternates (`/index.md`, `/zh-cn.md`, `/features.md`, `/blog.md`,
  `/blog/<slug>.md`, …) are route handlers under `app/api/page-markdown/` and
  `app/api/blog-markdown/`, reached through a rewrite in `middleware.ts`. The
  App Router cannot own a `.md` URL for a dynamic segment — `/blog/[slug]`
  matches `/blog/my-post.md` first, with `.md` as part of the slug. Going
  through the same `listPosts`/`getPost` / i18n copy as the pages is what keeps
  a scheduled post's Markdown twin in step with its HTML. `Accept: text/markdown`
  is honored on the HTML URLs and rewritten onto the same handlers.
- `content/blog/*/example-post.md` is a permanent draft kept as a rendering
  fixture: it exercises every supported element in one page, so template changes
  can be checked at a glance. It never ships.

## GEO / SEO surfaces

Discovery surfaces. `/llms-full.txt` is a file in `public/`; everything else
in this table is generated from `app/lib/public-pages.ts` (the same catalog
feeds `sitemap.xml` and `/llms.txt`).

| Path | Role |
| --- | --- |
| `/llms.txt` | Short product map for AI systems (`.md` links to every catalog page) |
| `/llms-full.txt` | Full product brief, comparisons, install facts |
| `/index.md`, `/zh-cn.md` | Markdown alternates of the homepages |
| `/features`, `/faq`, `/install`, `/getting-started` | Product pages (and `/zh-cn/…`) so crawlers that skip `/blog` still see docs |
| `/blog.md`, `/zh-cn/blog.md` | Markdown alternates of the blog indexes |
| `/blog/<slug>.md` | Markdown alternate of each post (both locales) |
| `/blog/feed.xml`, `/zh-cn/blog/feed.xml` | RSS 2.0 feeds |
| `/robots.txt` | Generated from `app/robots.ts` (search bots allowed, training crawlers blocked) |
| `/sitemap.xml` | Generated from `app/sitemap.ts` |

HTML pages advertise the Markdown alternate via `rel="alternate" type="text/markdown"` in metadata. Each HTML page also carries a visually-hidden (clip-rect) pointer to `/llms.txt` near the top of the document. Markdown pages start with a blockquote pointing at the same index.

Locale preference uses a same-host HTTP 302 in `middleware.ts` (cookie + `Accept-Language`, crawlers skipped). Do not add `window.location.replace` for this.
