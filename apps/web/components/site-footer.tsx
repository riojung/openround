import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <span>© {new Date().getFullYear()} OpenRound community project</span>
        <nav className="button-row" aria-label="Legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/status">Status</Link>
        </nav>
      </div>
    </footer>
  );
}
