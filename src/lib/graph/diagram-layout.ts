/**
 * Layout options per diagram size. Lives outside the "use client" SystemDiagram module so server
 * components can import the real values (from a server component, an export of a client module is
 * only a client reference, and its fields read as undefined).
 */
export const DIAGRAM_LAYOUT = {
  mini: { colGap: 40, rowGap: 12, nodeHeight: 30, minWidth: 74, maxWidth: 150, charWidth: 6.6, padding: 6 },
  full: { colGap: 84, rowGap: 22 },
} as const;
