import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const websiteRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  turbopack: {
    root: websiteRoot,
  },
}

export default nextConfig
