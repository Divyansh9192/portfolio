import { HEALTH_POLICY, resolveRegion, type HealthReport } from "@/lib/health";
import { getServiceHealth } from "@/lib/health-cache";
import { BUILD_SHA } from "@/lib/site";

/**
 * GET /api/health — contract in docs/ARCHITECTURE.md ("Health API").
 *
 * The handler runs per request (it reads x-vercel-id to report the serving region),
 * while the expensive part, the outbound probe, is cached for 60 s with unstable_cache
 * in src/lib/health-cache.ts. See that file for why the probe's fetch is not cached.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { checkedAt, services } = await getServiceHealth();
  const body: HealthReport = {
    checkedAt,
    services,
    site: {
      buildSha: BUILD_SHA || "unknown",
      region: resolveRegion(request.headers.get("x-vercel-id"), process.env.VERCEL_REGION),
    },
    policy: { ...HEALTH_POLICY },
  };
  return Response.json(body, {
    headers: {
      // The data is already cached server-side; don't let a CDN stack a second TTL on top.
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
