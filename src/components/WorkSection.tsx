"use client";

import { motion } from "framer-motion";
import type { Project } from "@/data/projects";
import ArchitectureDiagram from "./ArchitectureDiagram";
import Image from "next/image";

function RichParagraph({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className="text-text-dim text-base leading-relaxed max-w-[640px]">
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="text-white font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}

function ProjectBlock({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (slug: string) => void;
}) {
  const isEven = project.id % 2 === 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 1.1, ease: "easeOut" }}
      className="flex flex-col gap-6"
    >
      {/* Company / project header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-semibold text-white  text-3xl md:text-4xl">
          {project.name}
        </span>
        <span className="rounded-full border border-hairline bg-surface px-3 py-1 font-mono text-[11px] text-text-dim">
          {project.dates}
        </span>
      </div>

      {/* Tagline + rich description */}
      <div className="flex flex-col gap-3">
        <h3 className="text-[1.125rem] md:text-[1.25rem] font-semibold text-white">
          {project.tagline}
        </h3>
        <RichParagraph text={project.richDescription} />
      </div>

      {/* Handwritten annotation */}
      {/* <motion.div
        initial={{ opacity: 0, x: -8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex items-center gap-1.5"
        style={{ fontFamily: "var(--font-hand)" }}
      >
        <span className="text-amber text-[1.15rem]">
          My key recipes at {project.name}
        </span>
        <span className="text-amber text-xl leading-none" style={{ transform: "rotate(15deg) translateY(2px)", display: "inline-block" }}>↓</span>
      </motion.div> */}

      {/* Impact card */}
      <motion.button
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.25 }}
        onClick={() => onOpen(project.slug)}
        className="group block w-full text-left cursor-pointer"
      >
        <div className="rounded-2xl border border-hairline bg-surface overflow-hidden flex flex-col md:flex-row transition-colors duration-300 group-hover:border-green/25">
          {project.id % 2 === 0 ? (
            <>
              {/* Right: impact metric */}
              <div className="flex flex-col justify-center gap-4 p-6 md:p-8 md:w-[45%]">
                <span className="inline-flex w-fit rounded-full bg-surface-2 border border-hairline px-3 py-1.5 font-mono text-[11px] text-text-dim">
                  {project.highlight.badge}
                </span>

                <h3 className="text-[2rem] md:text-[2.4rem] font-extrabold text-white leading-[1.08] tracking-tight group-hover:text-green transition-colors duration-300">
                  {project.highlight.headline}
                </h3>

                <p className="text-text-dim text-sm font-light max-w-[280px] leading-relaxed">
                  {project.highlight.body}
                </p>
              </div>

              {/* Left: image */}
              <div className="relative md:w-[55%] shrink-0 bg-surface-2 border-b border-hairline md:border-b-0 md:border-r aspect-[16/10] md:aspect-auto md:min-h-[260px] flex items-center justify-center p-6 overflow-hidden">
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(var(--hairline) 1px, transparent 1px), linear-gradient(90deg, var(--hairline) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                  }}
                />
                <div className="relative w-full h-full">
                  <Image
                    src={project.image}
                    alt={project.name}
                    fill
                    loading="eager"
                    sizes="(max-width: 768px) 100vw, 55vw"
                    className="object-cover"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Left: image */}
              <div className="relative md:w-[55%] shrink-0 bg-surface-2 border-b border-hairline md:border-b-0 md:border-r aspect-[16/10] md:aspect-auto md:min-h-[260px] flex items-center justify-center p-6 overflow-hidden">
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(var(--hairline) 1px, transparent 1px), linear-gradient(90deg, var(--hairline) 1px, transparent 1px)",
                    backgroundSize: "28px 28px",
                  }}
                />
                <div className="relative w-full h-full">
                  <Image
                    src={project.image}
                    alt={project.name}
                    fill
                    loading="eager"
                    sizes="(max-width: 768px) 100vw, 55vw"
                    className="object-cover"
                  />
                </div>
              </div>

              {/* Right: impact metric */}
              <div className="flex flex-col justify-center gap-4 p-6 md:p-8 md:w-[45%]">
                <span className="inline-flex w-fit rounded-full bg-surface-2 border border-hairline px-3 py-1.5 font-mono text-[11px] text-text-dim">
                  {project.highlight.badge}
                </span>

                <h3 className="text-[2rem] md:text-[2.4rem] font-extrabold text-white leading-[1.08] tracking-tight group-hover:text-green transition-colors duration-300">
                  {project.highlight.headline}
                </h3>

                <p className="text-text-dim text-sm font-light max-w-[280px] leading-relaxed">
                  {project.highlight.body}
                </p>
              </div>
            </>
          )}
        </div>
      </motion.button>
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
    <section
      id="work"
      className="mx-auto w-full max-w-[980px] flex flex-col px-6 pt-8"
    >
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-5xl md:text-6xl text-white mb-14"
        style={{ fontFamily: "var(--font-hand)" }}
      >
        Selected Work
      </motion.h2>

      <div className="flex flex-col gap-20">
        {projects.map((project) => (
          <ProjectBlock key={project.id} project={project} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
