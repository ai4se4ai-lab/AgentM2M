import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/nav/sidebar";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-provider";

export const metadata: Metadata = {
  title: "AgentM2M Dashboard",
  description: "Hierarchical multi-agent software engineering team control plane.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <Providers>
          <Sidebar />
          <main className="ml-56 min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
