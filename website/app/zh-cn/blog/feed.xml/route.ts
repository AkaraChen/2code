import { renderFeed } from '../../../blog/lib/feed'

// Same publish window as the English feed.
export const revalidate = 3600

export async function GET() {
  return new Response(await renderFeed('zh-cn'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
