/**
 * @file PostCSS configuration consumed by the Next.js build pipeline.
 * @remarks Tailwind processes utility classes; Autoprefixer adds vendor prefixes.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
