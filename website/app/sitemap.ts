import type { MetadataRoute } from 'next'
import { siteConfig } from './site-config'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    {
      url: siteConfig.url,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteConfig.url}/zh-cn`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    // GEO / AI discovery surfaces (also linked from HTML head + llms.txt)
    {
      url: `${siteConfig.url}/llms.txt`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.4,
    },
    {
      url: `${siteConfig.url}/llms-full.txt`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.4,
    },
    {
      url: `${siteConfig.url}/index.md`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
    {
      url: `${siteConfig.url}/zh-cn.md`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.5,
    },
  ]
}
