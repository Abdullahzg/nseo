import { SessionProvider } from "next-auth/react";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageContainer } from "@/components/layout/PageContainer";
import { TopNav } from "@/components/layout/TopNav";
import { KeyHealthBanner } from "@/components/layout/KeyHealthBanner";
import { LoadingProvider } from "@/components/layout/LoadingProvider";
import { GlobalLoader } from "@/components/layout/GlobalLoader";
import { RouteProgress } from "@/components/layout/RouteProgress";
import { UsageTracker } from "@/components/layout/UsageTracker";
import { SearchDialog } from "@/components/layout/SearchDialog";
import { Toaster } from "@/components/ui/sonner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
    <SessionProvider session={session}>
      <LoadingProvider>
        <GlobalLoader />
        {user && <RouteProgress />}
        {user && <UsageTracker />}
        {user && <SearchDialog />}
        {user && <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:p-2 focus:bg-background focus:border focus:rounded-md">Skip to content</a>}
        <div className="flex h-svh overflow-hidden text-foreground bg-background">
          {user && <Sidebar />}
          <div className="flex min-h-0 flex-1 flex-col min-w-0">
            {user && <TopNav />}
            {user && <KeyHealthBanner />}
            <main id="main-content" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <div className="mx-auto max-w-7xl px-4 pt-6 pb-32 sm:px-6 lg:px-8">
                <PageContainer>{children}</PageContainer>
              </div>
            </main>
          </div>
        </div>
        <Toaster position="bottom-right" />
      </LoadingProvider>
    </SessionProvider>
  );
}
