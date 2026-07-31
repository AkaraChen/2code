# 2code Site

Marketing site for 2code, built with Next.js App Router in static export mode.

## Scripts

- `bun run dev` starts the Next.js dev server.
- `bun run build` creates the static export.
- `bun run lint` runs ESLint.
- `bun run preview` serves the generated `out/` folder locally.

## Static Output

`next.config.mjs` sets `output: 'export'`, so a production build emits a fully static site into `out/`.

## Assets

Public assets live in `public/`, and the site entrypoint lives in `app/`.

## GEO / SEO surfaces

Static discovery files (copied into `out/` on build):

| Path | Role |
| --- | --- |
| `/llms.txt` | Short product map for AI systems |
| `/llms-full.txt` | Full product brief, comparisons, install facts |
| `/index.md` | Markdown alternate of the English homepage |
| `/zh-cn.md` | Markdown alternate of the Chinese homepage |
| `/robots.txt` | Generated from `app/robots.ts` (search bots allowed, training crawlers blocked) |
| `/sitemap.xml` | Generated from `app/sitemap.ts` |

HTML pages advertise the Markdown alternate via `rel="alternate" type="text/markdown"` in metadata.
