import type { MetadataRoute } from 'next'
import { siteConfig } from './site-config'
import {
  absoluteUrl,
  feedSitemapPaths,
  listPublicPages,
} from './lib/public-pages'

/*
  Not force-static: the sitemap has to pick up posts that publish themselves
  between deploys, so it re-renders on the same window as the blog.
*/
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date()
  const pages = await listPublicPages()

  const entries: MetadataRoute.Sitemap = pages.flatMap((page) => [
    {
      url: absoluteUrl(page.htmlPath),
      lastModified: page.lastModified ?? lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    },
    {
      url: absoluteUrl(page.markdownPath),
      lastModified: page.lastModified ?? lastModified,
      changeFrequency: page.changeFrequency,
      priority: Math.max(0.3, page.priority - 0.3),
    },
  ])

  entries.push(
    {
      url: `${siteConfig.url}${siteConfig.llmsFullTxtPath}`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.4,
    },
    ...feedSitemapPaths().map((path) => ({
      url: absoluteUrl(path),
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.3,
    })),
  )

  return entries
}
