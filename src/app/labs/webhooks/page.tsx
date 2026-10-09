import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { evidenceUrl, getProject, profile } from "@/content";
import { CODE, codeEvidence, type CodeRefId } from "@/lib/sim/booking/code";
import { ButtonLink, Container, MonoLabel } from "@/components/ui/primitives";
import { WebhooksLab } from "@/components/labs/webhooks/WebhooksLab";

const project = getProject("neonstays")!;
const title = project.lab.title;
const description =
  "Race two guests for the last hotel room under a real row lock, replay Stripe webhooks against NeonStays' real booking states, and price a stay with its decorator chain. A simulation built from the Spring Boot code.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/labs/webhooks" },
  openGraph: { type: "website", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/labs/webhooks" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

/** What the lab takes from the code, each with the lines it comes from. */
const REAL: { claim: string; refs: CodeRefId[] }[] = [
  {
    claim:
      "Starting a booking locks the stay's inventory rows with PESSIMISTIC_WRITE and needs every one of them to have space. The code counts DAYS.between(checkIn, checkOut) + 1 rows, so the checkout date is a row too.",
    refs: ["findAndLockAvailable", "daysCountCheck"],
  },
  { claim: "The hold is the initBooking UPDATE, reservedCount + roomsCount, in the same transaction as the lock.", refs: ["initBookingQuery"] },
  {
    claim:
      "Expiry is checked only when the guest calls addGuests or payments. No job gives reservedCount back, and EXPIRE is declared but never assigned, so an abandoned hold keeps its rooms.",
    refs: ["hasBookingExpired", "bookingStatus"],
  },
  {
    claim:
      "The webhook verifies the Stripe-Signature header, handles only checkout.session.completed and answers 204. A bad signature becomes a 500 through the catch-all exception handler.",
    refs: ["webhookController", "exceptionHandler"],
  },
  {
    claim:
      "There is no event-id dedupe and no status check before CONFIRMED. A redelivery re-runs confirmBooking: harmless when reservedCount is 0, but it moves another guest's unpaid hold into bookedCount when one exists, and it flips a cancelled booking back to CONFIRMED.",
    refs: ["capturePayment", "confirmBookingQuery"],
  },
  {
    claim:
      "Every POST /payments creates a new Stripe Customer and Checkout Session and overwrites paymentSessionId. If the guest pays an older session, the card is charged and the webhook answers 404 on every retry.",
    refs: ["checkoutSession", "initiatePayments"],
  },
  {
    claim:
      "Cancelling decrements bookedCount only WHERE totalCount - bookedCount >= roomsCount. On a sold-out night that is false, so the cancelled room stays booked.",
    refs: ["cancelBookingQuery", "cancelBooking"],
  },
  {
    claim:
      "Prices run Base → Surge → Occupancy (×1.2 above 80% booked) → Urgency (×1.25 within 7 days) → Holiday (×1.4, hard-coded on), with exact BigDecimal multiplication.",
    refs: ["pricingService", "occupancyPricing", "urgencyPricing", "holidayPricing"],
  },
  {
    claim:
      "Booking init prices live. Search and the room price endpoint read prices the hourly job stored, so the two can disagree for up to an hour after a change.",
    refs: ["pricingCron", "searchQuery", "roomPrice"],
  },
];

function refLink(id: CodeRefId) {
  const c = CODE[id];
  const file = c.path.split("/").pop();
  return { href: evidenceUrl(project.links.repo, project.repoBranch, codeEvidence(id)), text: `${file}:${c.lines}` };
}

export default function WebhooksLabPage() {
  return (
    <>
      <Container wide className="pt-10 sm:pt-14">
        <header data-arch="LabHeader" data-arch-kind="server" className="max-w-[780px]">
          <nav aria-label="Breadcrumb" className="mb-5">
            <Link href="/labs" className="inline-flex min-h-10 items-center gap-1.5 font-mono text-[12px] text-text-3 hover:text-text">
              <ArrowLeft className="size-3.5" aria-hidden />
              All labs
            </Link>
          </nav>
          <MonoLabel as="p">Lab · {project.name} · Simulation</MonoLabel>
          <h1 className="mt-3 font-display text-[clamp(1.9rem,4.4vw,3rem)] font-extrabold leading-[1.04] tracking-[-0.015em] text-text [font-stretch:112%]">
            {title}
          </h1>
          <p className="mt-4 max-w-[64ch] text-[1.0625rem] leading-relaxed text-text-2">
            NeonStays is my hotel booking backend: one Spring Boot app with PostgreSQL and Stripe Checkout. This lab runs three of its mechanisms in your
            browser, using the names from the code. You can race two guests for the last room, replay the Stripe webhook that confirms a payment, and price
            a night with the decorator chain. It also shows the gaps I found in my own code, and what the fix changes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={`/work/${project.slug}`} variant="secondary">
              Read the case study
            </ButtonLink>
            <ButtonLink href={project.links.repo} variant="ghost">
              Source on GitHub
              <ExternalLink className="size-3.5" aria-hidden />
            </ButtonLink>
          </div>
        </header>
      </Container>

      <div className="mx-auto mt-10 w-full max-w-[1480px] px-5 sm:px-6">
        <WebhooksLab sourceBase={`${project.links.repo}/blob/${project.repoBranch}`} />
      </div>

      <Container wide className="pb-16 pt-14 sm:pb-20">
        <section aria-labelledby="real-title" data-arch="LabEvidence" data-arch-kind="server" className="max-w-[860px]">
          <h2 id="real-title" className="font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-extrabold leading-tight text-text [font-stretch:112%]">
            What&apos;s real here
          </h2>
          <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-text-2">
            Every behaviour in the lab comes from these lines of the repository. The lab adds only the parts marked as simulated above.
          </p>
          <ol className="mt-6 flex flex-col border-t border-line">
            {REAL.map((r, i) => (
              <li key={i} className="grid gap-x-4 gap-y-1.5 border-b border-line py-4 sm:grid-cols-[2rem_1fr]">
                <span className="font-mono text-[12px] text-text-3 tnum">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <p className="text-[15px] leading-relaxed text-text">{r.claim}</p>
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {r.refs.map((id) => {
                      const l = refLink(id);
                      return (
                        <a
                          key={id}
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
                        >
                          {l.text}
                        </a>
                      );
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <h3 className="mt-10 font-display text-[1.2rem] font-bold text-text [font-stretch:112%]">What I would fix next</h3>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-text-2 marker:text-text-3">
            {project.caseStudy.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      </Container>
    </>
  );
}
