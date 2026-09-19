import type { ReactNode } from "react";

export function BetaDisclosure({
  enabled,
  className,
  id,
  summary,
  children,
}: {
  enabled: boolean;
  className?: string;
  id?: string;
  summary: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <details className={className} id={id}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
