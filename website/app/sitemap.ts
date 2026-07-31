import type { MetadataRoute } from 'next'
import { listPosts } from './blog/lib/posts'
import {
  blogFeedPath,
  blogListMarkdownPath,
  blogListPath,
  blogPostMarkdownPath,
  blogPostPath,
} from './blog/lib/routes'
import { supportedLocales } from './i18n/resources'
import { siteConfig } from './site-config'

export const dynamic = 'force-static'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date()

  const entries: MetadataRoute.Sitemap = [
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

  /*
    Blog URLs are derived from the content directory rather than listed by hand:
    adding a Markdown file is the whole publishing step, and the sitemap has to
    follow from that alone.
  */
  for (const locale of supportedLocales) {
    entries.push(
      {
        url: `${siteConfig.url}${blogListPath(locale)}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.8,
      },
      {
        url: `${siteConfig.url}${blogListMarkdownPath(locale)}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.4,
      },
      {
        url: `${siteConfig.url}${blogFeedPath(locale)}`,
        lastModified,
        changeFrequency: 'weekly',
        priority: 0.3,
      },
    )

    for (const post of await listPosts(locale)) {
      if (post.draft || post.scheduled) {
        continue
      }

      entries.push(
        {
          url: `${siteConfig.url}${blogPostPath(locale, post.slug)}`,
          lastModified: new Date(post.date),
          changeFrequency: 'monthly',
          priority: 0.7,
        },
        {
          url: `${siteConfig.url}${blogPostMarkdownPath(locale, post.slug)}`,
          lastModified: new Date(post.date),
          changeFrequency: 'monthly',
          priority: 0.4,
        },
      )
    }
  }

  return entries
}
