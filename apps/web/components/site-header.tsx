import Link from "next/link";
import { Brand } from "./brand";

export function SiteHeader() {
  return (
    <header className="shell topbar">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Brand />
      <nav className="nav-links" aria-label="Primary navigation">
        <Link href="/pricing">Pricing</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/signin">Sign in</Link>
        <Link className="button small-button" href="/join">
          Join a round
        </Link>
      </nav>
    </header>
  );
}
