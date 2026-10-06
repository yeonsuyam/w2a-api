import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Wake2Adapt · ASR comparison",
  description: "Compare zero-shot, English-reference and Korean-reference ASR retrieval results.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
