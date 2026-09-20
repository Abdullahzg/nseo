import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", display: "swap", weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Geseo", template: "%s · Geseo" },
  description: "An autonomous outreach agent that finds publications, emails editors, negotiates placements, and asks you only when it must. Built on NVIDIA Nemotron via Nebius Token Factory.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f3ec" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
