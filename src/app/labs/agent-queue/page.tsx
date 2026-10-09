import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { evidenceUrl, getProject, profile } from "@/content";
import { CITE } from "@/lib/sim/agent-queue/spec";
import { Container, TextLink } from "@/components/ui/primitives";
import { AgentQueueLab } from "@/components/labs/agent-queue/AgentQueueLab";
import { LabHeader } from "@/components/labs/LabHeader";

const project = getProject("orchrez");
const title = project?.lab.title ?? "Agent queue and checkpoint lab";
const description =
  "A simulation of an Orchrez agent run: RabbitMQ, a Celery worker with acks_late, the LangGraph metagraph with Postgres checkpoints, the approval interrupt, SSE with Last-Event-ID and the credit ledger. Crash it and watch it resume.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/labs/agent-queue" },
  openGraph: { type: "website", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/labs/agent-queue" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

const TRY = [
  "Queue: press Burst ×10 with two workers and watch default fill up. Raise the concurrency and watch it drain.",
  "Graph: hit Crash worker now while research runs. The message comes back with redelivered=true and load_run_context is skipped from its checkpoint.",
  "Approve the assets, then press submit again. The second request gets 409 from the compare-and-set.",
  "Drop the SSE connection, let the run keep going, then reconnect. The table fills in from Last-Event-ID and nothing is missing.",
  "Stall a run, then jump ahead. The hard time limit kills its task, Celery acks it, and the run sits in running until the first dlq_reaper pass more than two hours after it started.",
];

const REAL: { claim: string; evidence: string }[] = [
  {
    claim: "Starting a run inserts a workflow_runs row in queued, holds the workflow's credits (10, 3 or 6) and publishes conductor_task to the default queue.",
    evidence: CITE.startRun,
  },
  {
    claim: "Celery acks a task only after it returns (acks_late) and requeues it if the worker process dies (reject_on_worker_lost), with a prefetch multiplier of 1.",
    evidence: CITE.reliability,
  },
  {
    claim: "One conductor_task drives a run until the approval interrupt or END. The hand-off to the research and content queues is coded but not reached, because nothing stops graph.invoke at a phase boundary.",
    evidence: CITE.reenqueue,
  },
  { claim: "The LangGraph thread_id is the run's id, so every checkpoint for a run lives under that id in PostgresSaver.", evidence: CITE.threadId },
  {
    claim: "Research and execution run as wrapper nodes that call an inner graph compiled without its own checkpointer. The parent checkpoints after each metagraph node.",
    evidence: CITE.researchNoCheckpointer,
  },
  { claim: "approval_gate pauses the run with interrupt() and a content_approval payload; the conductor resumes it with Command(resume=…).", evidence: CITE.approvalGate },
  { claim: "POST /approve moves awaiting_approval to resuming with one conditional UPDATE. A duplicate request matches no row and gets 409.", evidence: CITE.approveCas },
  { claim: "The conductor catches every exception from graph.invoke and marks the run failed, so Celery's retry only sees errors outside the graph.", evidence: CITE.invokeCatch },
  { claim: "Every 15 minutes dlq_reaper fails runs that have been running for over 2 hours, writes dead_lettered and releases their credits.", evidence: CITE.dlqReaper },
  { claim: "The SSE endpoint re-reads run_events after the Last-Event-ID cursor, 50 rows at a time, every half second; Redis pub/sub only wakes it up.", evidence: CITE.sseLoop },
];

const EDGES: { claim: string; evidence: string }[] = [
  {
    claim: "started_at is set on the first start only, so a run resumed after a long approval wait counts its 2 hours from the original start and can be reaped while it works.",
    evidence: CITE.startedAtOnce,
  },
  { claim: "release_credits leaves the HOLD row in place, so a run that fails, is resumed and fails again releases twice.", evidence: CITE.releaseCredits },
  { claim: "hold_credits reads the balance and then inserts without a lock, so concurrent starts in one workspace can overdraw it (Burst ×10).", evidence: CITE.holdCredits },
  { claim: "POST /cancel releases the credits but does not revoke a running task, which can later overwrite the cancelled state in persist_results.", evidence: CITE.cancel },
];

export default function AgentQueueLabPage() {
  if (!project) notFound();
  const href = (e: string) => evidenceUrl(project.links.repo, project.repoBranch, e);
  return (
    <Container wide className="py-10 sm:py-14">
      <LabHeader
        project={project}
        kind={project.lab.kind}
        title={title}
        arch="AgentQueueLabIntro"
        lede="An Orchrez run is a long LangGraph job behind a queue. It has to survive dead workers, flaky model providers and a human who approves hours later. This lab replays that path with the real names and settings from the code, and lets you break it."
        tries={TRY}
      />

      <section aria-labelledby="lab-title" className="mt-10">
        <h2 id="lab-title" className="sr-only">
          Interactive lab
        </h2>
        <AgentQueueLab sourceBase={`${project.links.repo}/blob/${project.repoBranch}`} />
      </section>

      <section aria-labelledby="real-here" className="mt-14 grid gap-10 lg:grid-cols-2" data-arch="AgentQueueEvidence" data-arch-kind="server">
        <div>
          <h2 id="real-here" className="font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-extrabold leading-tight text-text [font-stretch:112%]">
            What&apos;s real here
          </h2>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-text-2">
            The simulation is a model of the code, not a recording of production. These are the behaviours it copies, each linked to the lines it comes from.
          </p>
          <ul className="mt-5 flex flex-col gap-3.5 border-l-2 border-line-strong pl-4">
            {REAL.map((r) => (
              <li key={r.claim} className="text-[14.5px] leading-snug text-text-2">
                {r.claim}{" "}
                <a href={href(r.evidence)} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link">
                  {r.evidence.replace(/^backend\//, "")}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-[clamp(1.4rem,2.6vw,1.9rem)] font-extrabold leading-tight text-text [font-stretch:112%]">Sharp edges it reproduces</h2>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-text-2">
            Modelling the code faithfully also models its gaps. These are open issues in the current code, and the lab lets you trigger each one.
          </p>
          <ul className="mt-5 flex flex-col gap-3.5 border-l-2 border-line-strong pl-4">
            {EDGES.map((r) => (
              <li key={r.claim} className="text-[14.5px] leading-snug text-text-2">
                {r.claim}{" "}
                <a href={href(r.evidence)} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link">
                  {r.evidence.replace(/^backend\//, "")}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14.5px] text-text-2">
            The full story is in the <TextLink href={`/work/${project.slug}`}>{project.name} case study</TextLink>, and the code is on{" "}
            <TextLink href={project.links.repo}>GitHub</TextLink>.
          </p>
        </div>
      </section>
    </Container>
  );
}
