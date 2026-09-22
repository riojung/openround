import Link from "next/link";

export function Brand({
  inverted = false,
  name = "OpenRound",
}: {
  inverted?: boolean;
  name?: string;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase())
    .join("");

  return (
    <Link className="brand" href="/" style={inverted ? { color: "white" } : undefined}>
      <span className="brand-mark" aria-hidden="true">
        {initials || "OR"}
      </span>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">{name}</span>
    </Link>
  );
}
