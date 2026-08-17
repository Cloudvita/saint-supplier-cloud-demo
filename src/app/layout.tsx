import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAINT — Supplier Management",
  description: "Cognitive Source-to-Procure platform — supplier master data, W-9 intake and market risk monitoring",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-saint-600 text-sm font-bold text-white">
                S
              </div>
              <div>
                <div className="text-base font-bold leading-tight">SAINT</div>
                <div className="text-xs text-slate-500">Supplier Management Module</div>
              </div>
            </div>
            <nav className="text-sm text-slate-500">Source-to-Procure · v0.1</nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
