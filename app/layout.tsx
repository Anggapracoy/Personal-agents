import { APP_ORIGIN } from "../lib/deployment";

import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./brand-tokens.css";
import "./wdyt.css";
import "./browser-viewer.css";
import "./field-focus.css";
import "../public/ink-glass.css";

export const metadata: Metadata = {
  metadataBase: new URL(APP_ORIGIN),
  title: "Dash",
  description: "Dash is your personal assistant. Text it a task, or let it spot what needs attention in your connected apps and offer to help.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Dash",
    title: "Dash | Your assistant. Less on your plate.",
    description: "Your personal assistant for everyday tasks. Dash notices what needs attention and helps get it done.",
    images: [{
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      alt: "Dash | Your assistant. Less on your plate.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dash | Your assistant. Less on your plate.",
    description: "Your personal assistant for everyday tasks. Dash notices what needs attention and helps get it done.",
    images: ["/opengraph-image"],
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
  icons: {
    icon: { url: "/favicon.svg?v=dash-1", type: "image/svg+xml" },
    shortcut: "/favicon.svg?v=dash-1",
    apple: "/dash-icon.png",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#000000" }] };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The native shell adds its root class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
