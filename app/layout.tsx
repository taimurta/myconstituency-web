import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MyConstituency",
  description: "Find your municipal, provincial, and federal representatives in Calgary.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen">
          <header>
            <div className="mx-auto flex max-w-5xl items-center justify-between px-16 py-4">
              <div className="text-lg font-bold tracking-tight text-zinc-900">
                  myconstituency
                  </div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
