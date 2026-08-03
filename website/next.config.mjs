import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const websiteRoot = dirname(fileURLToPath(import.meta.url))

/*
  Not a static export: the blog schedules posts by date, and a `publishAt` that
  has passed has to become visible on its own. Pages are still prerendered at
  build time — they just carry a revalidate window, so the server re-renders
  them without a deploy.
*/

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: websiteRoot,
  },
}

export default nextConfig
