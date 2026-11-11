import { createHash } from 'node:crypto'
import { AGENT_CACHE_CONTROL } from './agent-docs'

export function textResponse(
  body: string,
  contentType: 'text/markdown' | 'text/plain',
): Response {
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`

  return new Response(body, {
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': AGENT_CACHE_CONTROL,
      ETag: etag,
      Vary: 'Accept',
    },
  })
}
