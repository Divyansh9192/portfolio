/**
 * Suggested questions shown as chips in the ask panel (and usable by the ⌘K shell).
 * pipeline.test.ts runs each one against the real corpus and fails if any of them
 * stops being answerable from the site's content.
 */
export const SUGGESTED_QUESTIONS = [
  "How does Orchrez resume a workflow after a crash?",
  "What did he build with Kafka?",
  "Is he available for an internship?",
  "What's his strongest backend project?",
] as const;
