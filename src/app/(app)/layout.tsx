import { Wordmark } from "@/components/layout/Logo";
import { Nav } from "@/components/layout/Nav";
import { RunningPill } from "@/components/layout/RunningPill";
import { Notifications } from "@/components/layout/Notifications";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh flex flex-col">
      <Nav />
      <RunningPill />
      <Notifications />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8 pb-24">{children}</div>
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs text-ink-3">
          <Wordmark />
          <span>Decisions by NVIDIA Nemotron 3 on Nebius Token Factory</span>
        </div>
      </footer>
    </div>
  );
}
