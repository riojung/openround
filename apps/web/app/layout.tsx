import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpenRound", template: "%s · OpenRound" },
  description: "Dependable live comprehension checks for classrooms and teams.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en-CA">
      <body>{children}</body>
    </html>
  );
}
