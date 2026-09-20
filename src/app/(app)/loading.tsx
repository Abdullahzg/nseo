export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-2/3" />
      <div className="skeleton h-5 w-1/2" />
      <div className="skeleton h-40 w-full" />
    </div>
  );
}
