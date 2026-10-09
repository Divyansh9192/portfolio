/**
 * Server-only access to the shared, cached health checks.
 *
 * Caching follows the bundled Next 16 guide for apps without Cache Components
 * (node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md,
 * "unstable_cache for non-fetch functions" and "Time-based revalidation"):
 * the whole check result (status, latency, checkedAt) is cached for 60 s. Caching the
 * probe's `fetch` itself with `next.revalidate` would replay a stored response and
 * report a near-zero latency, which would be a lie. Inside `unstable_cache` Next treats
 * fetches as no-store, so every cache miss is a real request with a real timing.
 *
 * Both GET /api/health and the /status page read through this one function, so they
 * always show the same check.
 */
import { unstable_cache } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { projects } from "@/content";
import { HEALTH_POLICY, healthTargets, runHealthChecks, unknownService, type ServiceChecks } from "./health";

const targets = healthTargets(projects);

const cachedChecks = unstable_cache(() => runHealthChecks(targets), ["health-checks", "v1", ...targets.map((t) => `${t.id}=${t.url}`)], {
  revalidate: HEALTH_POLICY.cacheSeconds,
  tags: ["health"],
});

/** Latest health of every live app, at most `HEALTH_POLICY.cacheSeconds` old. Only Next.js control-flow errors escape. */
export async function getServiceHealth(): Promise<ServiceChecks> {
  try {
    return await cachedChecks();
  } catch (error) {
    // Let Next's own control-flow errors through; report anything else as "could not run".
    unstable_rethrow(error);
    // The cache layer itself failed (not the probe: checkService never throws).
    const reason = error instanceof Error ? error.message : String(error);
    return { checkedAt: new Date().toISOString(), services: targets.map((t) => unknownService(t, reason)) };
  }
}
