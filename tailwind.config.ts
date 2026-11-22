import type { Config } from "tailwindcss";

/**
 * @file Tailwind CSS design-system configuration.
 * @remarks
 *  Encodes the SpeakCraft brand contract for Phase 1:
 *   - `brand-primary` is strictly `#004CE5` and is the ONLY accent color.
 *   - Surfaces are crisp white with neutral off-white / light-gray containers.
 *  Extending (rather than overriding) the default theme preserves Tailwind's
 *  full utility set while adding brand tokens on top.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /** Primary brand accent. Immutable per Phase 1 design contract. */
        "brand-primary": "#004CE5",
        /** Darker shade used for hover / active affordances. */
        "brand-primary-hover": "#0040C2",
        /** Tint used for subtle focus rings and selected states. */
        "brand-primary-subtle": "#E6EDFC",
        /** Crisp application background. */
        "surface-base": "#FFFFFF",
        /** Off-white container surface for cards and panels. */
        "surface-raised": "#F7F8FA",
        /** Light-gray hairline borders. */
        "surface-border": "#E5E7EB",
      },
      boxShadow: {
        /** Soft elevation for the auth card, tuned for a light theme. */
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 24px rgba(16, 24, 40, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
