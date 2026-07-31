import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import MarkdownItCallable, { type MarkdownIt } from 'markdown-it'
import footnotePlugin from 'markdown-it-footnote'
import { createHighlighter, type Highlighter } from 'shiki'
import { supportedLocales, type AppLocale } from '../../i18n/resources'

/*
  Blog content lives as Markdown files on disk, not in a CMS: the site is a
  static export, so every read here happens once at build time. Nothing in this
  module is reachable at runtime — it is imported only by server components,
  `sitemap.ts`, and the feed route handlers.
*/

const CONTENT_ROOT = path.join(process.cwd(), 'content', 'blog')

export type BlogPostMeta = Readonly<{
  locale: AppLocale
  slug: string
  title: string
  description: string
  /** ISO-8601 date, always normalised to UTC midnight when authored as YYYY-MM-DD. */
  date: string
  /** Instant the post becomes public. Defaults to `date` when not set explicitly. */
  publishAt: string
  tags: readonly string[]
  draft: boolean
  /** True when `publishAt` is still in the future at build time. */
  scheduled: boolean
  coverImage?: string
  ogImage?: string
  readingMinutes: number
}>

export type BlogPost = BlogPostMeta &
  Readonly<{
    /** Rendered article body. */
    html: string
    /** Markdown body with the frontmatter stripped — feeds the `.md` alternates. */
    markdown: string
  }>

/*
  Drafts are excluded from production output but always visible in `next dev`,
  so a post can be written and reviewed locally before it exists publicly.
  `BLOG_INCLUDE_DRAFTS=1 bun run build` produces a static build that includes
  them, which is how you preview a draft on the real static output.
*/
export function includeDrafts(): boolean {
  return (
    process.env.BLOG_INCLUDE_DRAFTS === '1' ||
    process.env.NODE_ENV !== 'production'
  )
}

/*
  Scheduled posts get the same preview treatment as drafts: visible while
  writing, absent from the shipped build. `BLOG_INCLUDE_SCHEDULED=1` exists on
  its own so a real static build can be checked against a future publish date
  without also un-hiding every draft.
*/
export function includeScheduled(): boolean {
  return process.env.BLOG_INCLUDE_SCHEDULED === '1' || includeDrafts()
}

/*
  One reference instant per build, not per call: a build that straddles midnight
  must not publish a post into the list while the sitemap and the feed — read
  moments later — still consider it scheduled. `BLOG_NOW` overrides it so a
  schedule can be tested without touching the clock.
*/
let buildNow: number | null = null

export function publishReferenceTime(): number {
  if (buildNow === null) {
    const override = process.env.BLOG_NOW

    if (override) {
      const parsed = new Date(override)

      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`BLOG_NOW is not a valid date: "${override}"`)
      }

      buildNow = parsed.getTime()
    } else {
      buildNow = Date.now()
    }
  }

  return buildNow
}

function localeDir(locale: AppLocale) {
  return path.join(CONTENT_ROOT, locale)
}

async function listSlugs(locale: AppLocale): Promise<string[]> {
  let entries: string[]

  try {
    entries = await fs.readdir(localeDir(locale))
  } catch {
    // A locale with no content directory yet is an empty blog, not an error.
    return []
  }

  return entries
    .filter((name) => name.endsWith('.md') || name.endsWith('.mdx'))
    .map((name) => name.replace(/\.mdx?$/, ''))
}

async function readSource(locale: AppLocale, slug: string) {
  for (const extension of ['.md', '.mdx']) {
    const file = path.join(localeDir(locale), `${slug}${extension}`)

    try {
      return { file, source: await fs.readFile(file, 'utf8') }
    } catch {
      continue
    }
  }

  return null
}

function requireString(
  value: unknown,
  field: string,
  file: string,
  fallback?: string,
): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  if (fallback !== undefined) {
    return fallback
  }

  // Failing the build is the point: a malformed post should never ship silently.
  throw new Error(`Blog post ${file} is missing required frontmatter "${field}"`)
}

/*
  A bare `2026-08-05` is UTC midnight, which is what YAML already does with an
  unquoted date. A post that must land at a local hour spells the offset out:
  `publishAt: 2026-08-05T09:00:00+08:00`.
*/
function normaliseDate(value: unknown, field: string, file: string): string {
  // gray-matter's YAML parser turns an unquoted `2026-07-31` into a Date.
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''))

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Blog post ${file} has an invalid frontmatter "${field}" (expected YYYY-MM-DD or an ISO-8601 timestamp)`,
    )
  }

  return parsed.toISOString()
}

function normaliseTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((tag) => String(tag).trim())
    .filter((tag) => tag.length > 0)
}

/*
  Two reading speeds because the two locales measure different units: ~200
  words/min for Latin prose, ~350 characters/min for Chinese. A post that mixes
  both (Chinese prose with English product names) gets the sum of its parts.
*/
function readingMinutes(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')

  const cjkCharacters = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length
  const latinWords = (
    text.replace(/[一-鿿㐀-䶿]/g, ' ').match(/[A-Za-z0-9]+/g) ??
    []
  ).length

  return Math.max(1, Math.round(latinWords / 200 + cjkCharacters / 350))
}

const HIGHLIGHT_THEMES = { light: 'github-light', dark: 'github-dark' } as const

// Kept deliberately short: every language here is bundled into the build step.
const HIGHLIGHT_LANGUAGES = [
  'bash',
  'shell',
  'json',
  'jsonc',
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'rust',
  'toml',
  'yaml',
  'css',
  'html',
  'markdown',
  'diff',
  'python',
  'sql',
]

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: [HIGHLIGHT_THEMES.light, HIGHLIGHT_THEMES.dark],
    langs: HIGHLIGHT_LANGUAGES,
  })

  return highlighterPromise
}

let rendererPromise: Promise<MarkdownIt> | null = null

async function createRenderer(): Promise<MarkdownIt> {
  const highlighter = await getHighlighter()

  /*
    Syntax highlighting runs at build time (Shiki) instead of shipping a
    client-side highlighter: the site currently loads zero JavaScript for
    content, and a blog about a terminal app is code-heavy enough that
    unhighlighted blocks would be a real regression. `defaultColor: false`
    emits both themes as CSS variables on each token, so the existing
    light/dark toggle keeps working without a re-render.
  */
  const renderer = new MarkdownItCallable({
    html: true,
    linkify: true,
    breaks: false,
    highlight: (code, language) => {
      try {
        return highlighter.codeToHtml(code, {
          lang: language || 'text',
          themes: HIGHLIGHT_THEMES,
          defaultColor: false,
        })
      } catch {
        return highlighter.codeToHtml(code, {
          lang: 'text',
          themes: HIGHLIGHT_THEMES,
          defaultColor: false,
        })
      }
    },
  })

  renderer.use(footnotePlugin)

  const defaultLinkOpen =
    renderer.renderer.rules.link_open ??
    ((tokens, index, options, _env, self) =>
      self.renderToken(tokens, index, options))

  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = String(tokens[index].attrGet('href') ?? '')

    if (/^https?:\/\//.test(href)) {
      tokens[index].attrSet('target', '_blank')
      tokens[index].attrSet('rel', 'noreferrer')
    }

    return defaultLinkOpen(tokens, index, options, env, self)
  }

  return renderer
}

function getRenderer() {
  rendererPromise ??= createRenderer()
  return rendererPromise
}

function parse(
  locale: AppLocale,
  slug: string,
  file: string,
  source: string,
): BlogPostMeta & { markdown: string } {
  const { data, content } = matter(source)

  const frontmatterSlug = requireString(data.slug, 'slug', file, slug)

  if (frontmatterSlug !== slug) {
    throw new Error(
      `Blog post ${file} declares slug "${frontmatterSlug}" but lives at "${slug}"`,
    )
  }

  const date = normaliseDate(data.date, 'date', file)

  /*
    `publishAt` defaults to `date` rather than to "now": a post dated in the
    future is a post that has not happened yet, which is what every static site
    generator means by a future date, and it keeps the common case — one date,
    one release — to a single field. Set `publishAt` explicitly only when the
    displayed date and the release moment genuinely differ.
  */
  const publishAt =
    data.publishAt === undefined || data.publishAt === null
      ? date
      : normaliseDate(data.publishAt, 'publishAt', file)

  return {
    locale,
    slug,
    title: requireString(data.title, 'title', file),
    description: requireString(data.description, 'description', file),
    date,
    publishAt,
    tags: normaliseTags(data.tags),
    draft: data.draft === true,
    scheduled: new Date(publishAt).getTime() > publishReferenceTime(),
    coverImage:
      typeof data.coverImage === 'string' ? data.coverImage : undefined,
    ogImage: typeof data.ogImage === 'string' ? data.ogImage : undefined,
    readingMinutes: readingMinutes(content),
    markdown: content.trim(),
  }
}

function byDateDescending(a: BlogPostMeta, b: BlogPostMeta) {
  return b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
}

/**
 * Every post for a locale, newest first, with drafts and not-yet-published
 * posts filtered per environment.
 */
export async function listPosts(
  locale: AppLocale,
): Promise<readonly BlogPostMeta[]> {
  const slugs = await listSlugs(locale)
  const withDrafts = includeDrafts()
  const withScheduled = includeScheduled()

  const posts = await Promise.all(
    slugs.map(async (slug) => {
      const found = await readSource(locale, slug)

      if (!found) {
        return null
      }

      return parse(locale, slug, found.file, found.source)
    }),
  )

  return posts
    .filter((post): post is BlogPostMeta & { markdown: string } => post !== null)
    .filter((post) => withDrafts || !post.draft)
    .filter((post) => withScheduled || !post.scheduled)
    .sort(byDateDescending)
}

/** Published posts across both locales — used by the sitemap and the `.md` emitter. */
export async function listAllPosts(): Promise<readonly BlogPostMeta[]> {
  const perLocale = await Promise.all(
    supportedLocales.map((locale) => listPosts(locale)),
  )

  return perLocale.flat()
}

export async function getPost(
  locale: AppLocale,
  slug: string,
): Promise<BlogPost | null> {
  const found = await readSource(locale, slug)

  if (!found) {
    return null
  }

  const meta = parse(locale, slug, found.file, found.source)

  if (!includeDrafts() && meta.draft) {
    return null
  }

  if (!includeScheduled() && meta.scheduled) {
    return null
  }

  const renderer = await getRenderer()

  return { ...meta, html: renderer.render(meta.markdown) }
}

/** True when the same slug is also published in the other locale. */
export async function hasTranslation(
  locale: AppLocale,
  slug: string,
): Promise<boolean> {
  const posts = await listPosts(locale)
  return posts.some((post) => post.slug === slug)
}
