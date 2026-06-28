import type { Metadata } from "next";
import "./globals.css";
// import CustomCursor from "@/components/CustomCursor";

export const metadata: Metadata = {
  title: "Divyansh Deep — Backend & Full-Stack Engineer",
  description:
    "Divyansh Deep — backend & full-stack engineer. Building distributed systems, AI agent pipelines, and multi-tenant platforms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* <CustomCursor /> */}
        {children}
      </body>
    </html>
  );
}
