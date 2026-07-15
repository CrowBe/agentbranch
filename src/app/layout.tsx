import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Hanken_Grotesk, Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { THEME_COOKIE, THEME_SETS } from "./themes/registry";
import "./globals.css";
// Custom theme sets are their own stylesheets, loaded after the token layer
// so their [data-theme] blocks win the equal-specificity contest with :root.
import "./themes/tuxedo.css";
import "./themes/cardigan.css";
import "./themes/terminal.css";

// §3.1 Type families. JetBrains Mono is loaded in both themes (Source view);
// Playfair Display and Fraunces are custom-set display faces (DESIGN §4.3–4.4;
// the Terminal set reuses JetBrains Mono for display).
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", weight: ["600", "700"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"] });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair", weight: ["600", "700"] });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "agent.branch",
  description: "Craft, test, and export agent skills you can trust.",
};

// Clerk requires a publishable key to mount its provider. Until one is set,
// render the app without it so the shell still boots (ARCHITECTURE §4).
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// Pre-paint theme resolution (ARCHITECTURE §7): a chosen theme set persists
// browser-level in a cookie; without one the system pair follows
// prefers-color-scheme. Runs synchronously before first paint so there is no
// flash, and keeps the layout static (no per-request cookie read).
const themeInit = `(function () {
  try {
    var match = document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
    var theme = match ? decodeURIComponent(match[1]) : null;
    var known = ${JSON.stringify(THEME_SETS.map((theme) => theme.id))};
    if (!theme || known.indexOf(theme) < 0) {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontVars = `${hanken.variable} ${inter.variable} ${jetbrains.variable} ${playfair.variable} ${fraunces.variable}`;
  const tree = (
    // suppressHydrationWarning: the pre-paint script legitimately rewrites
    // data-theme before React hydrates.
    <html lang="en" data-theme="light" className={fontVars} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );

  return clerkEnabled ? <ClerkProvider>{tree}</ClerkProvider> : tree;
}
