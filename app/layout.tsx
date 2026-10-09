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
  title: "Anakbuah",
  description: "Anakbuah is your personal assistant. Chat with it in the app or WhatsApp to get things done.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Anakbuah",
    title: "Anakbuah | Your assistant, wherever you chat.",
    description: "Your personal assistant in the app and WhatsApp.",
    images: [{
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      alt: "Anakbuah | Your assistant, wherever you chat.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Anakbuah | Your assistant, wherever you chat.",
    description: "Your personal assistant in the app and WhatsApp.",
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
