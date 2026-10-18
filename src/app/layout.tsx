import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luma — Talk to someone new",
  description:
    "A calm, anonymous place for one-to-one text conversations with strangers or friends by private invite.",
  applicationName: "Luma",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22><rect width=%2264%22 height=%2264%22 rx=%2218%22 fill=%22%23ff6747%22/><path d=%22M18 20h28v19H31l-9 7v-7h-4z%22 fill=%22white%22/></svg>",
  },
};

export const viewport: Viewport = {
  themeColor: "#f8f6f0",
  colorScheme: "light",
};

/**
 * Deliberately static: no request-time APIs are read here, so both the home
 * shell and the invite shell are prerendered at build time and served as
 * cacheable HTML. All dynamic behaviour (identity, rooms, live relay) happens
 * in the browser against same-origin `/api` routes only.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
