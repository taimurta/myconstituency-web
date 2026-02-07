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
          <header className="border-b">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
              <div className="font-semibold">myconstituency.ca</div>
              <nav className="text-sm text-zinc-600">
                <a className="hover:text-zinc-900" href="/">Lookup</a>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
          <footer className="border-t">
            <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-zinc-500">
              Data sources: Represent (Open North), Parliament of Canada (LEGISinfo), City of Calgary Newsroom, Legislative Assembly of Alberta.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
