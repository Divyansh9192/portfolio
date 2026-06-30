"use client";

import { motion } from "framer-motion";
import { profile } from "@/data/projects";

export default function Footer() {
  return (
    <footer id="contact" className="w-full pb-20">
      <hr className="border-hairline max-w-[980px] mx-auto" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.6 }}
        className="mx-auto mt-12 flex max-w-[980px] flex-col items-center gap-6 px-6"
      >
        <p className="font-display text-[28px] md:text-[36px] leading-normal text-center">
          <span className="font-normal text-white">Let&apos;s build </span>
          <span className="gradient-text font-semibold" style={{ fontFamily: "var(--font-hand)" }}>something real </span>
          <span className="font-normal text-white"> :)</span>
        </p>

        <p className="text-text-dim max-w-[480px] text-center">
          I&apos;m looking for backend, full-stack, or AI/agent engineering internships.
          If you&apos;re hiring, or just want to talk systems, my inbox is open.
        </p>

        <motion.a
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          href={`mailto:${profile.email}`}
          className="flex items-center rounded-full mt-2"
          style={{ backgroundColor: "#2563EB" }}
        >
          <span className="flex items-center gap-2 px-5 py-3 font-semibold text-white">
            {profile.email}
          </span>
        </motion.a>

        <div className="flex flex-wrap gap-3 mt-1">
          <motion.a
            whileHover={{ scale: 1.04, borderColor: "#25D467" }}
            whileTap={{ scale: 0.96 }}
            href={`tel:${profile.phone.replace(/\s/g, "")}`}
            className="px-4 py-2.5 rounded-full font-mono text-[13px] border border-hairline bg-surface text-text"
          >
            {profile.phone}
          </motion.a>
          <motion.a
            whileHover={{ scale: 1.04, borderColor: "#25D467" }}
            whileTap={{ scale: 0.96 }}
            href={profile.github}
            target="_blank"
            rel="noopener"
            className="px-4 py-2.5 rounded-full font-mono text-[13px] border border-hairline bg-surface text-text"
          >
            GitHub ↗
          </motion.a>
          <motion.a
            whileHover={{ scale: 1.04, borderColor: "#25D467" }}
            whileTap={{ scale: 0.96 }}
            href={profile.linkedin}
            target="_blank"
            rel="noopener"
            className="px-4 py-2.5 rounded-full font-mono text-[13px] border border-hairline bg-surface text-text"
          >
            LinkedIn ↗
          </motion.a>
        </div>

        <div className="mt-10 font-mono text-xs text-text-faint">
          © 2026 {profile.name}
        </div>
      </motion.div>
    </footer>
  );
}
