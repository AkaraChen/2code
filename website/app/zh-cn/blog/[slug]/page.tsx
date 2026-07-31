import type { Metadata } from 'next'
import {
  generatePostMetadata,
  generatePostParams,
  renderPostPage,
} from '../../../blog/lib/post-route'

type PageProps = Readonly<{ params: Promise<{ slug: string }> }>

// Required by `output: 'export'` — every article is prerendered at build time.
export async function generateStaticParams() {
  return generatePostParams('zh-cn')
}

export function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return generatePostMetadata('zh-cn', params)
}

export default function ChineseBlogPostPage({ params }: PageProps) {
  return renderPostPage('zh-cn', params)
}
