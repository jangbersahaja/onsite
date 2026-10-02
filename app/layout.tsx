import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shiftline | Staff timekeeping",
  description: "Clock in, review shifts, and manage outlet timekeeping.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
