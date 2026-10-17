import { LocaleProvider } from "@/app/_components/locale-provider";
import { localeTags } from "@/lib/i18n/config";
import { getRequestLocale } from "@/lib/i18n/server";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnSITE | Staff timekeeping",
  description: "Clock in, review shifts, and manage outlet timekeeping.",
  icons: {
    icon: "/onsite%20logo.png",
    apple: "/onsite%20logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#635bff",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getRequestLocale();
  return (
    <html lang={localeTags[locale]} className="h-full antialiased">
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
