import { Wordmark } from "@/components/layout/Logo";
import Link from "next/link";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const configured = !!process.env.GOOGLE_CLIENT_ID?.trim();
  return (
    <div className="min-h-svh flex items-center justify-center p-6">
      <div className="card p-8 max-w-md w-full">
        <div className="text-2xl"><Wordmark /></div>
        <p className="text-ink-2 mt-2">Owners sign in with Google to run real campaigns. Everyone else can run the demo without an account.</p>
        {error === "not_owner" && <div className="mt-4 text-sm text-danger">That Google account is not an owner of this deployment. You can still run demos.</div>}
        <div className="mt-6 flex flex-col gap-2">
          {configured && <a href="/api/auth/signin?callbackUrl=/setup" className="btn justify-center">Sign in with Google</a>}
          <Link href="/setup" className="btn btn-ghost justify-center">Run the demo as a guest</Link>
        </div>
      </div>
    </div>
  );
}
