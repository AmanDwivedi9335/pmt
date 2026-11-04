import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fieldwork — Project Operations",
  description:
    "Project delivery, materials and financial operations in one place.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
