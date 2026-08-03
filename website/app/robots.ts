import type { MetadataRoute } from 'next'
import { siteConfig } from './site-config'

export const dynamic = 'force-static'

/**
 * GEO crawler policy (Tw93 AI visibility checklist):
 * - Allow search/retrieval + user-triggered AI bots so products stay discoverable
 * - Block bulk training crawlers and undeclared scrapers
 * - Keep default open for traditional search engines
 *
 * Reference: https://tw93.fun/2026-05-01/ai-visibility.html
 * Competitor pattern (superset.sh): explicit AI assistant allows + training scrapers blocked
 */
export default function robots(): MetadataRoute.Robots {
  const allowAll = { allow: '/' as const }
  const disallowAll = { disallow: '/' as const }

  return {
    rules: [
      {
        userAgent: '*',
        ...allowAll,
      },
      // Search & retrieval — keep visible in AI answers
      {
        userAgent: 'OAI-SearchBot',
        ...allowAll,
      },
      {
        userAgent: 'Claude-SearchBot',
        ...allowAll,
      },
      {
        userAgent: 'PerplexityBot',
        ...allowAll,
      },
      {
        userAgent: 'GoogleOther',
        ...allowAll,
      },
      // User-triggered fetch (paste URL into chat)
      {
        userAgent: 'ChatGPT-User',
        ...allowAll,
      },
      {
        userAgent: 'Claude-User',
        ...allowAll,
      },
      {
        userAgent: 'Perplexity-User',
        ...allowAll,
      },
      {
        userAgent: 'Google-Agent',
        ...allowAll,
      },
      // Training crawlers — opt out of model training corpora
      {
        userAgent: 'GPTBot',
        ...disallowAll,
      },
      {
        userAgent: 'ClaudeBot',
        ...disallowAll,
      },
      {
        userAgent: 'anthropic-ai',
        ...disallowAll,
      },
      {
        userAgent: 'CCBot',
        ...disallowAll,
      },
      {
        userAgent: 'meta-externalagent',
        ...disallowAll,
      },
      {
        userAgent: 'Meta-ExternalAgent',
        ...disallowAll,
      },
      {
        userAgent: 'FacebookBot',
        ...disallowAll,
      },
      // Training opt-out tokens (not real crawlers; robots declaration)
      {
        userAgent: 'Google-Extended',
        ...disallowAll,
      },
      {
        userAgent: 'Applebot-Extended',
        ...disallowAll,
      },
      // Undeclared / bulk scrapers
      {
        userAgent: 'Bytespider',
        ...disallowAll,
      },
      {
        userAgent: 'Diffbot',
        ...disallowAll,
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  }
}
