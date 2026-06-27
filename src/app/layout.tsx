import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Hanken_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

// §3.1 Type families. JetBrains Mono is loaded in both themes (Source view).
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", weight: ["600", "700"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "agent.branch",
  description: "Craft, test, and export agent skills you can trust.",
};

// Clerk requires a publishable key to mount its provider. Until one is set,
// render the app without it so the shell still boots (ARCHITECTURE §4).
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontVars = `${hanken.variable} ${inter.variable} ${jetbrains.variable}`;
  const tree = (
    <html lang="en" data-theme="light" className={fontVars}>
      <body>{children}</body>
    </html>
  );

  return clerkEnabled ? <ClerkProvider>{tree}</ClerkProvider> : tree;
}
