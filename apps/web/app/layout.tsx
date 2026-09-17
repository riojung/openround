import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpenRound", template: "%s · OpenRound" },
  description:
    "Privacy-preserving comprehension recovery: ask, diagnose, intervene, recheck, and prove.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return (
    <html data-scroll-behavior="smooth" lang="en-CA">
      <body>{children}</body>
    </html>
  );
}
