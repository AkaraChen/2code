import type { Metadata } from 'next'
import {
  generatePostMetadata,
  generatePostParams,
  renderPostPage,
} from '../../../blog/lib/post-route'

type PageProps = Readonly<{ params: Promise<{ slug: string }> }>

// Same one-hour publish window as the English article route.
export const revalidate = 3600

export async function generateStaticParams() {
  return generatePostParams('zh-cn')
}

export function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return generatePostMetadata('zh-cn', params)
}

export default function ChineseBlogPostPage({ params }: PageProps) {
  return renderPostPage('zh-cn', params)
}
