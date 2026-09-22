import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ColorModeSync } from "../components/color-mode-sync";
import { COLOR_MODE_BOOTSTRAP_SCRIPT } from "../lib/color-mode";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpenRound", template: "%s · OpenRound" },
  description:
    "Privacy-preserving comprehension recovery: ask, diagnose, intervene, recheck, and prove.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      data-color-mode="light"
      data-color-mode-preference="system"
      data-scroll-behavior="smooth"
      lang="en-CA"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOTSTRAP_SCRIPT }} nonce={nonce} />
      </head>
      <body>
        <ColorModeSync />
        {children}
      </body>
    </html>
  );
}
