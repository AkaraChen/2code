/*
  Emits the Markdown alternates for the blog into `out/` after `next build`.

  Why a post-build script instead of a route handler: the site advertises every
  HTML page's Markdown twin at a `.md` URL (`/index.md`, `/zh-cn.md`), and the
  App Router cannot produce a route segment that ends in `.md` for a dynamic
  slug. The posts are already Markdown on disk, so copying them out with a small
  header is both cheaper and more faithful than re-serialising rendered HTML.

  Draft rule matches a production `next build`: drafts are skipped unless
  BLOG_INCLUDE_DRAFTS=1.
*/
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import matter from 'gray-matter'

const websiteRoot = path.resolve(import.meta.dirname, '..')
const contentRoot = path.join(websiteRoot, 'content', 'blog')
const outRoot = path.join(websiteRoot, 'out')

const SITE_URL = 'https://2code.akr.moe'
const LOCALES = [
  { locale: 'en', prefix: '', label: 'English' },
  { locale: 'zh-cn', prefix: '/zh-cn', label: '简体中文' },
]

const includeDrafts = process.env.BLOG_INCLUDE_DRAFTS === '1'

async function readPosts(locale) {
  let files
  try {
    files = await fs.readdir(path.join(contentRoot, locale))
  } catch {
    return []
  }

  const posts = []

  for (const file of files.filter((name) => /\.mdx?$/.test(name))) {
    const source = await fs.readFile(path.join(contentRoot, locale, file), 'utf8')
    const { data, content } = matter(source)

    if (data.draft === true && !includeDrafts) {
      continue
    }

    posts.push({
      slug: file.replace(/\.mdx?$/, ''),
      title: String(data.title ?? ''),
      description: String(data.description ?? ''),
      date:
        data.date instanceof Date
          ? data.date.toISOString()
          : new Date(String(data.date)).toISOString(),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      body: content.trim(),
    })
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date))
}

function isoDay(iso) {
  return iso.slice(0, 10)
}

function renderPost(post, { prefix }) {
  const url = `${SITE_URL}${prefix}/blog/${post.slug}`

  return [
    `# ${post.title}`,
    '',
    `> ${post.description}`,
    '',
    `- **Published:** ${isoDay(post.date)}`,
    ...(post.tags.length > 0 ? [`- **Tags:** ${post.tags.join(', ')}`] : []),
    `- **Canonical:** ${url}`,
    '',
    '---',
    '',
    post.body,
    '',
  ].join('\n')
}

function renderIndex(posts, { prefix, label }) {
  const url = `${SITE_URL}${prefix}/blog`

  return [
    `# 2code Blog (${label})`,
    '',
    '> Notes on terminal workflows, git worktrees, and running coding agents locally.',
    '',
    `- **Canonical:** ${url}`,
    `- **Feed:** ${url}/feed.xml`,
    '',
    '---',
    '',
    ...(posts.length === 0
      ? ['No posts published yet.', '']
      : posts.flatMap((post) => [
          `## [${post.title}](${SITE_URL}${prefix}/blog/${post.slug})`,
          '',
          `${isoDay(post.date)}${post.tags.length > 0 ? ` · ${post.tags.join(', ')}` : ''}`,
          '',
          post.description,
          '',
        ])),
  ].join('\n')
}

async function main() {
  try {
    await fs.access(outRoot)
  } catch {
    throw new Error(`No build output at ${outRoot} — run \`next build\` first`)
  }

  let written = 0

  for (const target of LOCALES) {
    const posts = await readPosts(target.locale)
    const listFile = path.join(outRoot, `${target.prefix}/blog.md`.slice(1))
    const postDir = path.join(outRoot, `${target.prefix}/blog`.slice(1))

    await fs.mkdir(path.dirname(listFile), { recursive: true })
    await fs.writeFile(listFile, renderIndex(posts, target), 'utf8')
    written += 1

    if (posts.length > 0) {
      await fs.mkdir(postDir, { recursive: true })
    }

    for (const post of posts) {
      await fs.writeFile(
        path.join(postDir, `${post.slug}.md`),
        renderPost(post, target),
        'utf8',
      )
      written += 1
    }
  }

  console.log(`emit-blog-markdown: wrote ${written} Markdown alternate(s)`)
}

await main()
