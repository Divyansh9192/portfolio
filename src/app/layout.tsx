import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { profile, projects } from "@/content";
import { SITE_URL } from "@/lib/site";
import { ThemeScript } from "@/components/chrome/ThemeScript";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { OperatorLayer } from "@/components/operator/OperatorLayer";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const description = `${profile.name}: ${profile.role.toLowerCase()}. ${profile.pitch}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${profile.name} · ${profile.role}`,
    template: `%s · ${profile.name}`,
  },
  description,
  applicationName: profile.name,
  authors: [{ name: profile.name, url: profile.links.github }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: profile.name,
    title: `${profile.name} · ${profile.role}`,
    description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: `${profile.name} · ${profile.role}`, description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0c0f" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
  ],
  colorScheme: "dark light",
};

function personJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name,
    jobTitle: profile.role,
    description: profile.pitch,
    email: `mailto:${profile.email}`,
    url: SITE_URL,
    sameAs: [profile.links.github, profile.links.linkedin],
    address: { "@type": "PostalAddress", addressLocality: "Noida", addressCountry: "IN" },
    alumniOf: { "@type": "CollegeOrUniversity", name: "JSS Academy of Technical Education" },
    knowsAbout: Array.from(new Set(projects.flatMap((p) => p.stack))).slice(0, 24),
  };
  // Escape "<" so content can never close the script tag (per Next.js JSON-LD guidance).
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${archivo.variable} ${plex.variable} ${jetbrains.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-text focus:px-3 focus:py-2 focus:text-bg"
        >
          Skip to content
        </a>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: personJsonLd() }} />
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <OperatorLayer />
      </body>
    </html>
  );
}
