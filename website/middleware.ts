import { NextResponse, type NextRequest } from 'next/server'

/*
  `/blog.md` and `/blog/<slug>.md` are the Markdown alternates the HTML pages
  advertise. The App Router cannot own them directly — `/blog/[slug]` matches
  `/blog/my-post.md` first, with `.md` as part of the slug — so they are
  rewritten onto the route handlers under `/api/blog-markdown`.

  Only these paths are rewritten. `/index.md` and `/zh-cn.md` are still plain
  files in `public/` and are left alone.
*/
const BLOG_MARKDOWN = /^(\/zh-cn)?\/blog(?:\/([^/]+))?\.md$/

export function middleware(request: NextRequest) {
  const match = BLOG_MARKDOWN.exec(request.nextUrl.pathname)

  if (!match) {
    return NextResponse.next()
  }

  const [, zhPrefix, slug] = match
  const locale = zhPrefix ? 'zh-cn' : 'en'
  const url = request.nextUrl.clone()

  url.pathname = slug
    ? `/api/blog-markdown/${locale}/${slug}`
    : `/api/blog-markdown/${locale}`

  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ['/blog.md', '/blog/:slug*', '/zh-cn/blog.md', '/zh-cn/blog/:slug*'],
}
