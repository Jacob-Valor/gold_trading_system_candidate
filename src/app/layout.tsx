import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gold Trading System API",
  description:
    "RESTful backend for a Gold Trading System — wallets, gold trading, admin panel.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}