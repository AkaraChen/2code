import { renderFeed } from '../lib/feed'

export const dynamic = 'force-static'

export async function GET() {
  return new Response(await renderFeed('en'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
