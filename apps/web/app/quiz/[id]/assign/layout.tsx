import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Assign practice",
};

export default function AssignPracticeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
