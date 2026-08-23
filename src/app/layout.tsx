import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageContainer } from "@/components/layout/PageContainer";
import { TopNav } from "@/components/layout/TopNav";
import { KeyHealthBanner } from "@/components/layout/KeyHealthBanner";
import { RouteProgress } from "@/components/layout/RouteProgress";
import { UsageTracker } from "@/components/layout/UsageTracker";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// One face for the whole system. Hierarchy comes from weight and size — 300 for display type, 400
// for everything else — never from a second family. A display serif was tried and pulled: against
// frosted glass panes the contrast of two families fights the surfaces, which are already doing the
// visual separating.
const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // `template` so a page setting `title: "Clusters"` renders "Clusters · Summit" without every page
  // having to repeat the brand.
  title: { default: "Summit — SEO & content engine", template: "%s · Summit" },
  description:
    "Internal SEO and content engine for ImagineArt: keyword clusters, AI-written drafts, landing pages, image assets, technical audits and backlink outreach.",
  applicationName: "Summit",
  // The favicon is src/app/icon.svg, which Next picks up by file convention; this adds the sizes hint
  // so the browser scales the single SVG rather than hunting for a raster fallback.
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }] },
  // An internal tool behind auth should never be indexed if it is ever exposed.
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authConfigured = !!process.env.GOOGLE_CLIENT_ID?.trim();
  let session = null;
  if (authConfigured) {
    try {
      const { auth } = await import("@auth");
      session = await auth();
    } catch { /* auth not configured */ }
  }
  const user = session?.user ?? (authConfigured ? null : { name: "Demo User", email: "demo@local" });

  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <SessionProvider session={session}>
            {user && <RouteProgress />}
            {user && <UsageTracker />}
            <div className="flex h-svh overflow-hidden text-foreground">
              {user && <Sidebar />}
              <div className="flex min-h-0 flex-1 flex-col min-w-0 py-4 pr-4 pl-4 lg:pl-0">
                {user && <TopNav />}
                {user && <KeyHealthBanner />}
                <main className="min-h-0 flex-1 overflow-y-auto">
                  <PageContainer>{children}</PageContainer>
                </main>
              </div>
            </div>
            <Toaster position="bottom-right" />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
