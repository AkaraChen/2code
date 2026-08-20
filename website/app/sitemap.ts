import type { MetadataRoute } from 'next'
import { absoluteUrl, listPublicPages } from './lib/public-pages'

/*
  Not force-static: the sitemap has to pick up posts that publish themselves
  between deploys, so it re-renders on the same window as the blog.

  Feeds stay out of the sitemap: afdocs treats every sitemap URL as a "page",
  and an XML feed cannot carry the HTML llms.txt directive. Blog indexes
  advertise RSS via rel=alternate instead.
*/
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date()
  const pages = await listPublicPages()

  return pages.flatMap((page) => [
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
}
