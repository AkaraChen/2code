import { renderFeed } from '../../../blog/lib/feed'

export const dynamic = 'force-static'

export async function GET() {
  return new Response(await renderFeed('zh-cn'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
