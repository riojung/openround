import Link from "next/link";
import type { WorkspaceProductFeatures } from "@openround/contracts";

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

type CreatorNavigationFeatures = Pick<WorkspaceProductFeatures, "workspaceShell">;

export function creatorLandingHref(
  productFeatures: CreatorNavigationFeatures | null | undefined,
): "/home" | "/dashboard" {
  return productFeatures?.workspaceShell === true ? "/home" : "/dashboard";
}

interface CreatorBrandProps extends Omit<BrandProps, "href"> {
  productFeatures?: CreatorNavigationFeatures | null;
}

export function CreatorBrand({ productFeatures, ...props }: CreatorBrandProps) {
  return <Brand {...props} href={creatorLandingHref(productFeatures)} />;
}
