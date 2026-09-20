import { Nav } from "@/components/layout/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8 pb-24">{children}</div>
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-12 flex items-center justify-between text-xs text-ink-3">
          <span>Geseo</span>
          <span>Decisions by NVIDIA Nemotron 3 on Nebius Token Factory</span>
        </div>
      </footer>
    </div>
  );
}
