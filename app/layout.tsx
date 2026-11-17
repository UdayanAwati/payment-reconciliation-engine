import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Payment Reconciliation Engine",
  description: "Reconcile platform transactions against bank settlements and explain every variance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
