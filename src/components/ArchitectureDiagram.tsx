"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import type { Diagram } from "@/data/projects";

const variantColor = {
  teal: "#25D467",
  amber: "#FBBA27",
  neutral: "#525252",
} as const;

// Computes a clipped line between two node edges (not centers) so arrows
// terminate at the box boundary rather than visually overlapping the label.
function getEdgePoints(diagram: Diagram, fromId: string, toId: string) {
  const from = diagram.nodes.find((n) => n.id === fromId);
  const to = diagram.nodes.find((n) => n.id === toId);
  if (!from || !to) return { x1: 0, y1: 0, x2: 0, y2: 0 };

  const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 };

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  const clip = (node: typeof from, dirX: number, dirY: number) => {
    const hw = node.w / 2;
    const hh = node.h / 2;
    if (dirX === 0 && dirY === 0) return { x: node.x + hw, y: node.y + hh };
    const scaleX = dirX !== 0 ? hw / Math.abs(dirX) : Infinity;
    const scaleY = dirY !== 0 ? hh / Math.abs(dirY) : Infinity;
    const scale = Math.min(scaleX, scaleY);
    return {
      x: node.x + hw + dirX * scale,
      y: node.y + hh + dirY * scale,
    };
  };

  const start = clip(from, dx, dy);
  const end = clip(to, -dx, -dy);

  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

export default function ArchitectureDiagram({
  diagram,
  size = "card",
  annotation,
}: {
  diagram: Diagram;
  size?: "card" | "full";
  annotation?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.2 });

  const fontSize = size === "card" ? { label: 9, sub: 7.5 } : { label: 12, sub: 9.5 };

  return (
    <div ref={ref} className="relative w-full h-full">
      {annotation && (
        <motion.span
          initial={{ opacity: 0, y: -6 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 1.1, duration: 0.5 }}
          className="absolute -top-2 right-4 z-10 font-hand text-amber text-xl rotate-[-2deg] pointer-events-none"
          style={{ fontFamily: "var(--font-hand)" }}
        >
          {annotation}
          <span className="absolute -bottom-5 right-2 text-2xl">↘</span>
        </motion.span>
      )}
      <svg
        viewBox={diagram.viewBox}
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Edges drawn first, animated as a line-draw */}
        {diagram.edges.map((edge, i) => {
          const { x1, y1, x2, y2 } = getEdgePoints(diagram, edge.from, edge.to);
          return (
            <motion.line
              key={`edge-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#525252"
              strokeWidth={size === "card" ? 1.2 : 1.4}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
              transition={{ duration: 0.5, delay: 0.05 * i, ease: "easeInOut" }}
            />
          );
        })}

        {/* Nodes drawn after edges start, each box stroke-draws in */}
        {diagram.nodes.map((node, i) => (
          <g key={node.id}>
            <motion.rect
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              rx={size === "card" ? 5 : 8}
              fill="none"
              stroke={variantColor[node.variant]}
              strokeWidth={1.5}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
              transition={{ duration: 0.6, delay: 0.3 + 0.08 * i, ease: "easeInOut" }}
            />
            <motion.text
              x={node.x + node.w / 2}
              y={node.sublabel ? node.y + node.h / 2 - 2 : node.y + node.h / 2 + 3}
              fill="#E8E8E8"
              fontFamily="var(--font-mono)"
              fontSize={fontSize.label}
              textAnchor="middle"
              initial={{ opacity: 0 }}
              animate={isInView ? { opacity: 1 } : {}}
              transition={{ duration: 0.4, delay: 0.5 + 0.08 * i }}
            >
              {node.label}
            </motion.text>
            {node.sublabel && (
              <motion.text
                x={node.x + node.w / 2}
                y={node.y + node.h / 2 + 11}
                fill="#8A8A8A"
                fontFamily="var(--font-mono)"
                fontSize={fontSize.sub}
                textAnchor="middle"
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ duration: 0.4, delay: 0.55 + 0.08 * i }}
              >
                {node.sublabel}
              </motion.text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
