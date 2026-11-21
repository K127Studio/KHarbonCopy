import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });
/** brand typeface: used wherever the project name KHarbonCopy is written */
const brand = localFont({ src: "../public/fonts/opiated.woff2", variable: "--font-opiated", display: "swap" });

const siteDescription =
  "Carry the style of any Latin typeface over to a Khmer font. KHarbonCopy measures your font against a reference at full vector precision and redraws every Khmer glyph to match — entirely in the browser, nothing uploaded.";

export const metadata: Metadata = {
  title: { default: "KHarbonCopy | Latin-to-Khmer font style transfer", template: "%s · KHarbonCopy" },
  description: siteDescription,
  applicationName: "KHarbonCopy",
  keywords: [
    "Khmer font", "Khmer typeface", "font style transfer", "type design", "font generator",
    "Latin to Khmer", "OpenType", "TTF", "WOFF", "typography", "glyph analysis",
  ],
  category: "design",
  creator: "KHarbonCopy",
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "KHarbonCopy",
    title: "KHarbonCopy | Latin-to-Khmer font style transfer",
    description: siteDescription,
    images: [{ url: "/images/logo.png", alt: "KHarbonCopy logo" }],
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "KHarbonCopy | Latin-to-Khmer font style transfer",
    description: siteDescription,
    images: ["/images/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${brand.variable}`}>
      <body>{children}</body>
    </html>
  );
}
