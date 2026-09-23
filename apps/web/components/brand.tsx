import Link from "next/link";

interface BrandProps {
  href?: string;
  inverted?: boolean;
  name?: string;
}

export function Brand({ href = "/", inverted = false, name = "OpenRound" }: BrandProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase())
    .join("");

  return (
    <Link className="brand" href={href} style={inverted ? { color: "white" } : undefined}>
      <span className="brand-mark" aria-hidden="true">
        {initials || "OR"}
      </span>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">{name}</span>
    </Link>
  );
}

export function CreatorBrand(props: Omit<BrandProps, "href">) {
  return <Brand {...props} href="/home" />;
}
