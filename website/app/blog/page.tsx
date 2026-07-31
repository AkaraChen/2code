import type { Metadata } from 'next'
import { getMessages } from '../i18n/resources'
import { buildPageMetadata } from '../page-metadata'
import { BlogListContent } from './blog-list-content'
import { listPosts } from './lib/posts'
import { blogListMarkdownPath, blogListPath } from './lib/routes'

const messages = getMessages('en')

export const metadata: Metadata = buildPageMetadata('en', {
  pathname: blogListPath('en'),
  title: messages.blog.metadataTitle,
  description: messages.blog.metadataDescription,
  markdownPath: blogListMarkdownPath('en'),
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
