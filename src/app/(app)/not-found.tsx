import Link from "next/link";
export default function NotFound() {
  return (
    <div className="card p-6 max-w-xl">
      <div className="label mb-2">Not here</div>
      <p className="serif text-lg">That page does not exist, or it belongs to someone else.</p>
      <Link href="/setup" className="btn mt-4">Start a campaign</Link>
    </div>
  );
}
