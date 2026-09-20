import type { Metadata } from "next";
import { SetupForm } from "@/components/setup/SetupForm";

export const metadata: Metadata = { title: "Setup" };

export default function SetupPage() {
  return (
    <div>
      <div className="mb-8 max-w-2xl">
        <h1 className="serif text-3xl sm:text-4xl font-semibold tracking-tight">Get your product featured, without doing the outreach.</h1>
        <p className="text-ink-2 mt-3">Tell the agent what you sell and what you can spend. It finds publications, emails their editors, negotiates a price, and comes back only when it genuinely needs you.</p>
      </div>
      <SetupForm />
    </div>
  );
}
