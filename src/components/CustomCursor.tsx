"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

export default function CustomCursor() {
  const [isVisible, setIsVisible] = useState(false);
  const [isPointer, setIsPointer] = useState(false);
  const [isTouch, setIsTouch] = useState(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  });

  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);

  const springConfig = { damping: 28, stiffness: 320, mass: 0.4 };
  const x = useSpring(cursorX, springConfig);
  const y = useSpring(cursorY, springConfig);

  // Slower-trailing ring for a layered, deliberate feel
  const ringSpring = { damping: 30, stiffness: 140, mass: 0.6 };
  const ringX = useSpring(cursorX, ringSpring);
  const ringY = useSpring(cursorY, ringSpring);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateTouch = () => setIsTouch(!mq.matches);
    mq.addEventListener("change", updateTouch);

    if (!mq.matches) {
      return () => mq.removeEventListener("change", updateTouch);
    }

    const handleMove = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      if (!isVisible) setIsVisible(true);

      const target = e.target as HTMLElement;
      setIsPointer(!!target.closest("a, button, [role='button'], input, textarea"));
    };

    const handleLeave = () => setIsVisible(false);

    window.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseleave", handleLeave);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseleave", handleLeave);
      mq.removeEventListener("change", updateTouch);
    };
  }, [cursorX, cursorY, isVisible]);

  if (isTouch) return null;

  return (
    <>
      {/* Core dot */}
      <motion.div
        className="fixed top-0 left-0 z-[200] pointer-events-none rounded-full"
        style={{
          x,
          y,
          translateX: "-50%",
          translateY: "-50%",
          width: isPointer ? 10 : 7,
          height: isPointer ? 10 : 7,
          backgroundColor: "#25D467",
          opacity: isVisible ? 1 : 0,
        }}
        transition={{ width: { duration: 0.2 }, height: { duration: 0.2 }, opacity: { duration: 0.2 } }}
      />
      {/* Trailing ring */}
      <motion.div
        className="fixed top-0 left-0 z-[200] pointer-events-none rounded-full border"
        style={{
          x: ringX,
          y: ringY,
          translateX: "-50%",
          translateY: "-50%",
          width: isPointer ? 44 : 28,
          height: isPointer ? 44 : 28,
          borderColor: isPointer ? "#25D467" : "#212121",
          opacity: isVisible ? (isPointer ? 0.5 : 0.35) : 0,
        }}
        transition={{ width: { duration: 0.25 }, height: { duration: 0.25 }, borderColor: { duration: 0.2 } }}
      />
    </>
  );
}
