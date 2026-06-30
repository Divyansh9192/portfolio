"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const links = [
  { id: "about", label: "About" },
  { id: "work", label: "Work" },
  { id: "contact", label: "Contact" },
];

export default function FloatingNav() {
  const [active, setActive] = useState("about");

  useEffect(() => {
    const sectionIds = links.map((l) => l.id);
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const viewportMid = scrollY + window.innerHeight * 0.3;

      let current = sectionIds[0];
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.offsetTop;
        if (viewportMid >= top) {
          current = id;
        }
      }
      setActive(current);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    if (id === "about") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <motion.nav
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] as const }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      aria-label="Main navigation"
    >
      <div className="flex items-center rounded-full border border-hairline bg-bg/95 backdrop-blur-md px-2 py-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.6)]">
        {links.map((link) => (
          <button
            key={link.id}
            onClick={() => scrollTo(link.id)}
            className={`relative rounded-full px-3.5 py-1.5 font-mono text-[13px] font-medium transition-colors duration-200 ${
              active === link.id ? "text-bg" : "text-text-dim hover:text-text"
            }`}
          >
            {active === link.id && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 rounded-full bg-green"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10">{link.label}</span>
          </button>
        ))}
      </div>
    </motion.nav>
  );
}
