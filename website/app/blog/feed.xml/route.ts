import { renderFeed } from '../lib/feed'

// Re-rendered on the same window as the blog itself, so a post that reaches
// its publishAt shows up in the feed without a deploy.
export const revalidate = 3600

export async function GET() {
  return new Response(await renderFeed('en'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
