import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Assign Recovery Pack practice" };

export default function PackPracticeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
