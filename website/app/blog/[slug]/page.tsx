import type { Metadata } from 'next'
import {
  generatePostMetadata,
  generatePostParams,
  renderPostPage,
} from '../lib/post-route'

type PageProps = Readonly<{ params: Promise<{ slug: string }> }>

/*
  Published posts are prerendered; a scheduled one is rendered on the first
  request after its publishAt and cached from there. One hour is also how long a
  404 for a not-yet-published slug is held.
*/
export const revalidate = 3600

export async function generateStaticParams() {
  return generatePostParams('en')
}

export function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return generatePostMetadata('en', params)
}

export default function BlogPostPage({ params }: PageProps) {
  return renderPostPage('en', params)
}
