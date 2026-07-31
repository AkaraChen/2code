import type { Metadata } from 'next'
import {
  generatePostMetadata,
  generatePostParams,
  renderPostPage,
} from '../lib/post-route'

type PageProps = Readonly<{ params: Promise<{ slug: string }> }>

// Required by `output: 'export'` — every article is prerendered at build time.
export async function generateStaticParams() {
  return generatePostParams('en')
}

export function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return generatePostMetadata('en', params)
}

export default function BlogPostPage({ params }: PageProps) {
  return renderPostPage('en', params)
}
