"use client";

import { motion } from "framer-motion";
import type { Project } from "@/data/projects";
import ArchitectureDiagram from "./ArchitectureDiagram";
import MarginNote from "./MarginNote";

function ProjectBlock({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (slug: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.1, ease: "easeOut" }}
      className="flex flex-col gap-5"
    >
      {/* Sticky project header, mirrors the sticky company logo bar */}
      <div className="sticky top-0 z-10 -mx-6 flex items-center gap-3 bg-bg/95 px-6 py-3 backdrop-blur-sm border-b border-hairline md:border-none">
        <span className="font-mono text-sm font-bold text-white">{project.name}</span>
        <span className="rounded-full border border-hairline bg-card bg-surface px-3 py-1 font-mono text-[11px] text-text-dim">
          {project.status}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[1.125rem] font-semibold text-white md:text-[1.25rem]">{project.tagline}</p>
        <p className="text-text-dim text-base max-w-[640px]">{project.description}</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {project.stack.map((tech) => (
            <span
              key={tech}
              className="font-mono text-[11.5px] text-text-dim border border-hairline rounded-full px-3 py-1"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex flex-col gap-6 mt-2">
        <p className="text-base font-semibold text-text-dim">
          The architecture, in one picture
        </p>

        <button
          onClick={() => onOpen(project.slug)}
          className="group block w-full text-left cursor-none"
        >
          <div className="flex flex-col gap-6 md:items-center md:gap-12 md:flex-row">
            <div className="relative -mx-6 w-[calc(100%+3rem)] shrink-0 overflow-hidden border-0 md:mx-0 md:w-1/2 md:rounded-2xl md:border md:border-hairline bg-surface aspect-[4/3] p-6 transition-colors group-hover:border-green/40">
              <ArchitectureDiagram diagram={project.cardDiagram} size="card" />
            </div>
            <div className="flex w-full flex-col gap-4 md:w-1/2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-light text-text">
                  {project.flag ? "Hardest engineering problem" : "Case study"}
                </span>
                {project.flag && (
                  <MarginNote direction="down" className="text-base">
                    {project.flag}
                  </MarginNote>
                )}
              </div>
              <h3 className="text-3xl leading-[1.1] font-semibold tracking-tight text-white md:text-4xl group-hover:text-green transition-colors">
                {project.caseStudy.problem.heading}
              </h3>
              <p className="text-text-dim font-light max-w-md">
                {project.caseStudy.intro}
              </p>
              <span className="font-mono text-[13px] text-green group-hover:underline underline-offset-4">
                Read the full case study →
              </span>
            </div>
          </div>
        </button>
      </div>
    </motion.div>
  );
}

export default function WorkSection({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (slug: string) => void;
}) {
  return (
    <section id="work" className="mx-auto w-full max-w-[980px] flex flex-col gap-16 px-6 pt-8">
      <div className="flex flex-col gap-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="relative w-fit"
        >
          <h2 className="text-left font-display text-4xl md:text-5xl font-semibold text-white">
            Selected Work
          </h2>
        </motion.div>

        <div className="flex flex-col gap-24">
          {projects.map((project) => (
            <ProjectBlock key={project.slug} project={project} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </section>
  );
}
