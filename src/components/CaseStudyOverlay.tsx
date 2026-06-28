"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect } from "react";
import type { Project } from "@/data/projects";
import ArchitectureDiagram from "./ArchitectureDiagram";
import { projects } from "@/data/projects";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export default function CaseStudyOverlay({
  project,
  onClose,
  onNavigate,
}: {
  project: Project | null;
  onClose: () => void;
  onNavigate: (slug: string) => void;
}) {
  useEffect(() => {
    if (project) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [project]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const currentIdx = project ? projects.findIndex((p) => p.slug === project.slug) : -1;
  const prevProject = currentIdx > 0 ? projects[currentIdx - 1] : null;
  const nextProject = currentIdx >= 0 && currentIdx < projects.length - 1 ? projects[currentIdx + 1] : null;

  return (
    <AnimatePresence>
      {project && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] bg-bg overflow-y-auto"
        >
          {/* Top bar */}
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="sticky top-0 z-10 backdrop-blur-md bg-bg/85 border-b border-hairline"
          >
            <div className="max-w-[980px] mx-auto px-6 py-4 flex items-center justify-between">
              <button
                onClick={onClose}
                className="font-mono text-[13px] text-text-dim hover:text-green transition-colors flex items-center gap-2"
              >
                ← Back to work
              </button>
              {project.links.repo && (
                <a
                  href={project.links.repo}
                  target="_blank"
                  rel="noopener"
                  className="font-mono text-[13px] text-text-dim hover:text-green transition-colors"
                >
                  Repo ↗
                </a>
              )}
              {project.links.live && (
                <a
                  href={project.links.live}
                  target="_blank"
                  rel="noopener"
                  className="font-mono text-[13px] text-text-dim hover:text-green transition-colors"
                >
                  Live ↗
                </a>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
          >
            {/* Hero */}
            <header className="pt-12 pb-10 px-6 max-w-[980px] mx-auto border-b border-hairline">
              <div className="font-mono text-xs text-green uppercase tracking-wider mb-4">
                Case study {String(project.caseStudy.index).padStart(2, "0")}
              </div>
              <h1 className="font-mono font-bold text-[clamp(28px,4.5vw,44px)] text-white mb-4">
                {project.name}
              </h1>
              <p className="text-text-dim text-[17px] max-w-[640px]">{project.caseStudy.intro}</p>
              <div className="flex flex-wrap gap-6 mt-7 font-mono text-[13px]">
                <div>
                  <span className="block text-[11px] uppercase tracking-wide text-text-faint mb-1">Role</span>
                  <span className="text-text">Solo builder</span>
                </div>
                <div>
                  <span className="block text-[11px] uppercase tracking-wide text-text-faint mb-1">Stack</span>
                  <span className="text-text">{project.stack.slice(0, 4).join(" · ")}</span>
                </div>
                <div>
                  <span className="block text-[11px] uppercase tracking-wide text-text-faint mb-1">Status</span>
                  <span className="text-text">{project.status}</span>
                </div>
              </div>
            </header>

            <main className="max-w-[980px] mx-auto px-6">
              {/* Problem */}
              <motion.section
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="py-12 border-b border-hairline"
              >
                <div className="font-mono text-xs text-green uppercase tracking-wider mb-4">Problem</div>
                <h2 className="font-mono text-[26px] font-semibold text-white mb-5">
                  {project.caseStudy.problem.heading}
                </h2>
                {project.caseStudy.problem.body.map((p, i) => (
                  <p key={i} className="text-text-dim text-[15.5px] max-w-[680px] mb-4">
                    {p}
                  </p>
                ))}
              </motion.section>

              {/* Constraints */}
              <motion.section
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="py-12 border-b border-hairline"
              >
                <div className="font-mono text-xs text-green uppercase tracking-wider mb-4">Constraints</div>
                <h2 className="font-mono text-[26px] font-semibold text-white mb-5">
                  {project.caseStudy.constraints.heading}
                </h2>
                <ul className="space-y-3 max-w-[680px]">
                  {project.caseStudy.constraints.items.map((c, i) => {
                    const [bold, ...rest] = c.split(". ");
                    return (
                      <motion.li
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.08 }}
                        className="text-text-dim text-[15px] pl-5 relative"
                      >
                        <span className="absolute left-0 text-green">—</span>
                        <strong className="text-text">{bold}.</strong> {rest.join(". ")}
                      </motion.li>
                    );
                  })}
                </ul>
              </motion.section>

              {/* Architecture */}
              <motion.section
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="py-12 border-b border-hairline"
              >
                <div className="font-mono text-xs text-green uppercase tracking-wider mb-4">Architecture</div>
                <h2 className="font-mono text-[26px] font-semibold text-white mb-5">
                  {project.caseStudy.architecture.heading}
                </h2>
                <p className="text-text-dim text-[15.5px] max-w-[680px] mb-6">
                  {project.caseStudy.architecture.body}
                </p>

                <div className="bg-surface border border-hairline rounded-[10px] p-6 md:p-8 my-6 relative">
                  <div className="aspect-[760/280]">
                    <ArchitectureDiagram
                      diagram={project.caseStudy.architecture.diagram}
                      size="full"
                      annotation={project.caseStudy.architecture.annotation}
                    />
                  </div>
                </div>
                <p className="font-mono text-[13px] text-text-faint">{project.caseStudy.architecture.caption}</p>
              </motion.section>

              {/* Decisions */}
              <motion.section
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="py-12 border-b border-hairline"
              >
                <div className="font-mono text-xs text-green uppercase tracking-wider mb-4">Decisions & tradeoffs</div>
                <h2 className="font-mono text-[26px] font-semibold text-white mb-5">
                  {project.caseStudy.decisions.heading}
                </h2>
                <div className="grid gap-4 mt-6">
                  {project.caseStudy.decisions.items.map((d, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 12 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: i * 0.06 }}
                      className="bg-surface border border-hairline rounded-lg px-5 py-4"
                    >
                      <div
                        className={`font-mono text-[11px] uppercase tracking-wider mb-2 ${
                          d.type === "choice" ? "text-green" : "text-amber"
                        }`}
                      >
                        {d.type === "choice" ? "Choice" : "Tradeoff"}
                      </div>
                      <p className="text-text-dim text-[14.5px]">{d.text}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.section>

              {/* Result */}
              <motion.section
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
                variants={fadeUp}
                transition={{ duration: 0.5 }}
                className="py-12"
              >
                <div className="font-mono text-xs text-green uppercase tracking-wider mb-4">Result</div>
                <h2 className="font-mono text-[26px] font-semibold text-white mb-5">
                  {project.caseStudy.result.heading}
                </h2>
                <p className="text-text-dim text-[15.5px] max-w-[680px] mb-6">{project.caseStudy.result.body}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {project.caseStudy.result.stats.map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0.92 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: i * 0.1 }}
                      className="border border-hairline rounded-lg p-5 bg-surface"
                    >
                      <span className="font-mono text-[26px] font-bold text-green block mb-1">{s.value}</span>
                      <span className="text-[13px] text-text-dim">{s.label}</span>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            </main>

            {/* Footer nav */}
            <div className="max-w-[980px] mx-auto px-6 flex justify-between py-10 font-mono text-[13px] border-t border-hairline">
              {prevProject ? (
                <button
                  onClick={() => onNavigate(prevProject.slug)}
                  className="text-text-dim hover:text-green transition-colors"
                >
                  ← Previous: {prevProject.name}
                </button>
              ) : (
                <span />
              )}
              {nextProject ? (
                <button
                  onClick={() => onNavigate(nextProject.slug)}
                  className="text-text-dim hover:text-green transition-colors"
                >
                  Next: {nextProject.name} →
                </button>
              ) : (
                <button onClick={onClose} className="text-text-dim hover:text-green transition-colors">
                  Back to all work →
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
