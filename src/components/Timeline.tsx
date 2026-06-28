"use client";

import { motion } from "framer-motion";
import { timeline } from "@/data/projects";
import SplitHeading from "./SplitHeading";

export default function Timeline() {
  return (
    <section id="experience" className="mx-auto w-full max-w-[980px] px-6 flex flex-col items-center gap-7">
      <SplitHeading
        text="Hands-on Experience"
        className="text-center font-display text-3xl md:text-4xl font-semibold text-white"
      />

      <div role="list" className="flex w-full flex-col gap-3 mt-6">
        {timeline.map((entry, i) => (
          <motion.div
            key={entry.title}
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.15 }}
            transition={{ duration: 0.6, delay: i * 0.08 }}
            className="border-b border-hairline"
          >
            <div className="group flex w-full flex-wrap items-center gap-2.5 rounded-md px-3 py-4 transition-colors hover:bg-white/5">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-text-faint uppercase tracking-wide">{entry.date}</span>
                </div>
                <span className="text-lg font-semibold text-white">{entry.title}</span>
                <p className="text-text-dim text-sm font-light max-w-xl">{entry.body}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
