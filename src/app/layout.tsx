import type { Metadata } from "next";
import { Poppins } from "next/font/google";
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
            <div className="flex h-svh overflow-hidden text-foreground bg-background">
              {user && <Sidebar />}
              <div className="flex min-h-0 flex-1 flex-col min-w-0 p-4 lg:p-6">
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
