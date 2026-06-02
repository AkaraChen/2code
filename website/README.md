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
