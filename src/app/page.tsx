"use client";

import { useState, useCallback } from "react";
import FloatingNav from "@/components/FloatingNav";
import Hero from "@/components/Hero";
import WorkSection from "@/components/WorkSection";
// import Timeline from "@/components/Timeline";
import Footer from "@/components/Footer";
import CaseStudyOverlay from "@/components/CaseStudyOverlay";
import ScrollProgress from "@/components/ScrollProgress";
import { projects } from "@/data/projects";

export default function Home() {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const openProject = useCallback((slug: string) => {
    setActiveSlug(slug);
  }, []);

  const closeProject = useCallback(() => {
    setActiveSlug(null);
  }, []);

  const activeProject = projects.find((p) => p.slug === activeSlug) ?? null;

  return (
    <>
      <ScrollProgress />
      <Hero />

      <div className="flex flex-col gap-22 pb-32">
        <WorkSection projects={projects} onOpen={openProject} />
        {/* <Timeline /> */}
        <Footer />
      </div>

      <FloatingNav />

      <CaseStudyOverlay project={activeProject} onClose={closeProject} onNavigate={openProject} />
    </>
  );
}
