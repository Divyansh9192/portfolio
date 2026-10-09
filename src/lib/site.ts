/**
 * Canonical site origin.
 * Set NEXT_PUBLIC_SITE_URL in the deployment (e.g. https://your-domain.com).
 * On Vercel, VERCEL_PROJECT_PRODUCTION_URL is used as a fallback.
 * Never hard-code a domain elsewhere: import SITE_URL or use the request host.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

/** Short commit SHA of the running build, when the platform provides one. */
export const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_SHA ?? "").slice(0, 7);

/** Window CustomEvent names shared by the operator layer and page components. */
export const OPERATOR_EVENTS = {
  /** Open the ⌘K command palette / shell. detail?: { command?: string } */
  open: "operator:open",
  /** Toggle the architecture overlay (also bound to the "?" key). */
  overlay: "operator:overlay",
  /** Start or stop incident mode. detail?: { on?: boolean } */
  incident: "operator:incident",
  /** Open the ask-the-agent panel. detail?: { question?: string } */
  ask: "operator:ask",
} as const;
