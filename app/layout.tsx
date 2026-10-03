import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnSITE | Staff timekeeping",
  description: "Clock in, review shifts, and manage outlet timekeeping.",
  icons: {
    icon: "/onsite%20logo.png",
    apple: "/onsite%20logo.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
