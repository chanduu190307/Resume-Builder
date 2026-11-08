import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-3 py-24 text-center sm:px-6">
      <p className="text-sm font-medium text-ink-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <Link to="/" className="mt-6 inline-block text-sm font-medium text-accent hover:text-accent-hover">
        Back to home
      </Link>
    </div>
  );
}
