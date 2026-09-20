import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
      <div className="text-6xl font-bold text-muted-foreground/20">404</div>
      <h2 className="text-xl font-semibold">Page not found</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link href="/campaigns/autonomous">
        <Button variant="outline">Go to Campaigns</Button>
      </Link>
    </div>
  );
}
