/**
 * @file Next.js runtime configuration.
 * @remarks
 *  App Router is enabled by default in Next 14. Strict Mode is turned on to
 *  surface unsafe lifecycle usage during development. No custom rewrites are
 *  required for Phase 1 — API routes are colocated under `src/app/api`.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
