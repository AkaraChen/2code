import type { Metadata } from 'next'
import { BlogListContent } from '../../blog/blog-list-content'
import { listPosts } from '../../blog/lib/posts'
import { blogListMarkdownPath, blogListPath } from '../../blog/lib/routes'
import { getMessages } from '../../i18n/resources'
import { buildPageMetadata } from '../../page-metadata'

const messages = getMessages('zh-cn')

export const metadata: Metadata = buildPageMetadata('zh-cn', {
  pathname: blogListPath('zh-cn'),
  title: messages.blog.metadataTitle,
  description: messages.blog.metadataDescription,
  markdownPath: blogListMarkdownPath('zh-cn'),
  languages: {
    en: blogListPath('en'),
    'zh-CN': blogListPath('zh-cn'),
    'x-default': blogListPath('en'),
  },
})

export default async function ChineseBlogIndexPage() {
  return (
    <BlogListContent
      locale="zh-cn"
      messages={messages}
      posts={await listPosts('zh-cn')}
    />
  )
}
