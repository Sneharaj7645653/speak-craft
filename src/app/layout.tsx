import type { Metadata, Viewport } from "next";

import "./globals.css";

/**
 * @file        src/app/layout.tsx
 * @layer       Presentation (App Router root layout)
 * @description
 *  The root layout wrapping every route. Establishes the light theme, the crisp
 *  white document background, and global metadata. Renders once per document.
 */

/** Static document metadata. */
export const metadata: Metadata = {
  title: "SpeakCraft — Practice Public Speaking",
  description:
    "Asynchronous public-speaking practice for the campus cohort. Sign in to begin.",
};

/** Viewport + theme-color hint (brand-white surface). */
export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
};

/**
 * Root layout component.
 *
 * @param props.children - The active route's rendered subtree.
 * @returns The `<html>` document shell.
 */
export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
