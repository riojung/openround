import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Manage practice",
};

export default function PracticeManagementLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
