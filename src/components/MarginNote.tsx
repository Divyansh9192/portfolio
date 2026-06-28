"use client";

import { motion } from "framer-motion";

export default function MarginNote({
  children,
  direction = "up",
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  direction?: "up" | "down";
  className?: string;
  delay?: number;
}) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
      className={`hidden md:inline-block relative font-hand text-amber text-xl select-none ${
        direction === "up" ? "-rotate-3" : "rotate-2"
      } ${className}`}
      style={{ fontFamily: "var(--font-hand)" }}
    >
      {children}
      <span
        className={`absolute text-2xl ${
          direction === "up" ? "-top-7 -left-1" : "-bottom-6 right-1"
        }`}
      >
        {direction === "up" ? "↖" : "↘"}
      </span>
    </motion.span>
  );
}
