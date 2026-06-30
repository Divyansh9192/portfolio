"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, lazy, Suspense } from "react";
import { profile } from "@/data/projects";

const TechConstellation = lazy(() => import("./TechConstellation"));

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const item = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  const y = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <header id="about" ref={ref} className="relative pt-32 md:pt-40 pb-16 overflow-hidden">
      {/* Original text content — same max-w / indentation as rest of page */}
      <motion.div style={{ y, opacity }}>
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="px-6 max-w-[980px] mx-auto relative z-10"
        >
          <motion.h1
            variants={item}
            className="font-display font-extrabold text-[clamp(32px,5.5vw,52px)] leading-[1.15] text-white mb-3 tracking-tight text-balance"
          >
            {profile.name}
          </motion.h1>

          <motion.p
            variants={item}
            className="font-hand gradient-text text-3xl md:text-4xl font-semibold mb-7"
            style={{ fontFamily: "var(--font-hand)" }}
          >
            I build the systems behind the interface.
          </motion.p>

          {/* <motion.div
            variants={item}
            className="inline-flex items-center gap-2 font-mono text-[13px] text-green mb-7 uppercase tracking-wide"
          >
            <span className="w-[7px] h-[7px] rounded-full bg-amber status-dot" />
            Open to internship opportunities
          </motion.div> */}

          <motion.p variants={item} className="text-lg text-white max-w-[620px] mb-8 block">
            I enjoy turning ideas into production-ready software by building resilient backend services, distributed architectures, and AI-driven applications. I care about scalability, clean system design, and everything that happens beyond the frontend.
          </motion.p>

          <motion.div variants={item} className="flex flex-wrap items-center gap-3">
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href={`mailto:${profile.email}`}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold text-white"
              style={{ backgroundColor: "#2563EB" }}
            >
              Email me
            </motion.a>
            <motion.a
              whileHover={{ scale: 1.03, borderColor: "#25D467" }}
              whileTap={{ scale: 0.97 }}
              href={profile.github}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2.5 font-mono text-[13px] font-semibold text-text"
            >
              <img src="/icons/github.svg" alt="GitHub" className="w-[14px] h-[14px] opacity-90 invert" />
              GitHub ↗
            </motion.a>
            <motion.a
              whileHover={{ scale: 1.03, borderColor: "#25D467" }}
              whileTap={{ scale: 0.97 }}
              href={profile.linkedin}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2.5 font-mono text-[13px] font-semibold text-text"
            >
              <img src="/icons/linkedin.svg" alt="LinkedIn" className="w-[14px] h-[14px] opacity-90" />
              LinkedIn ↗
            </motion.a>
            <motion.a
              whileHover={{ scale: 1.03, borderColor: "#25D467" }}
              whileTap={{ scale: 0.97 }}
              href="/resume.pdf"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2.5 font-mono text-[13px] font-semibold text-text"
            >
              Resume ↗
            </motion.a>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* 3D Tech Constellation — fills right side of viewport */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5, delay: 0.8 }}
        className="absolute top-0 right-0 bottom-0 w-[50vw] hidden lg:block pointer-events-none"
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(251,186,39,0.04) 0%, transparent 70%)",
          }}
        />
        <Suspense fallback={null}>
          <TechConstellation />
        </Suspense>
      </motion.div>
    </header>
  );
}
