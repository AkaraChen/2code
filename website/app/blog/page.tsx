import type { Metadata } from 'next'
import { getMessages } from '../i18n/resources'
import { buildPageMetadata } from '../page-metadata'
import { BlogListContent } from './blog-list-content'
import { listPosts } from './lib/posts'
import { blogFeedPath, blogListMarkdownPath, blogListPath } from './lib/routes'

const messages = getMessages('en')

/*
  Prerendered at build time, then re-rendered at most once an hour. That window
  is what publishes a post whose `publishAt` has passed, with no deploy.
*/
export const revalidate = 3600

export const metadata: Metadata = buildPageMetadata('en', {
  pathname: blogListPath('en'),
  title: messages.blog.metadataTitle,
  description: messages.blog.metadataDescription,
  markdownPath: blogListMarkdownPath('en'),
  rssPath: blogFeedPath('en'),
  languages: {
    en: blogListPath('en'),
    'zh-CN': blogListPath('zh-cn'),
    'x-default': blogListPath('en'),
  },
})

export default async function BlogIndexPage() {
  return (
    <BlogListContent
      locale="en"
      messages={messages}
      posts={await listPosts('en')}
    />
  )
}
