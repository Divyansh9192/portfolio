import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { SystemSection } from "@/components/home/SystemSection";
import { WorkIndex } from "@/components/home/WorkIndex";
import { LabsIndex } from "@/components/home/LabsIndex";
import { About } from "@/components/home/About";
import { TalkToSite } from "@/components/home/TalkToSite";
import { Contact } from "@/components/home/Contact";

// Title and description come from the root layout's defaults.
export const metadata: Metadata = {
  alternates: { canonical: "/", types: { "text/markdown": "/index.md" } },
  openGraph: { url: "/" },
};

export default function Home() {
  return (
    <>
      <Hero />
      <SystemSection />
      <WorkIndex />
      <LabsIndex />
      <About />
      <TalkToSite />
      <Contact />
    </>
  );
}
