import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const sans = Poppins({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Geseo — AI Outreach Platform", template: "%s · Geseo" },
  description:
    "AI-powered outreach platform: autonomous prospect discovery, qualification, contact resolution, personalized email outreach, and intelligent negotiation.",
  applicationName: "Geseo",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }] },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
