"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { profile } from "@/data/projects";

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
    <header id="about" ref={ref} className="relative pt-32 md:pt-40 pb-16 px-6 max-w-[980px] mx-auto overflow-hidden">
      <motion.div style={{ y, opacity }}>
        <motion.div variants={container} initial="hidden" animate="show">
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

          <motion.div
            variants={item}
            className="inline-flex items-center gap-2 font-mono text-[13px] text-green mb-7 uppercase tracking-wide"
          >
            <span className="w-[7px] h-[7px] rounded-full bg-amber status-dot" />
            Open to internship opportunities
          </motion.div>

          <motion.p variants={item} className="text-lg text-text-dim max-w-[620px] mb-8 block">
            4th-year CSE student building backend and full-stack systems: multi-tenant
            AI platforms, distributed microservices, semantic search, payment infrastructure.
            I care about what happens after the request leaves the browser.
          </motion.p>

          <motion.div variants={item} className="flex flex-wrap items-center gap-3">
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href={`mailto:${profile.email}`}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold text-white"
              style={{ backgroundColor: "#25D467" }}
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
              LinkedIn ↗
            </motion.a>
            <motion.a
              whileHover={{ scale: 1.03, borderColor: "#25D467" }}
              whileTap={{ scale: 0.97 }}
              href="#"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2.5 font-mono text-[13px] font-semibold text-text"
            >
              Resume ↗
            </motion.a>
          </motion.div>
        </motion.div>
      </motion.div>
    </header>
  );
}
