import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cpu } from "lucide-react";
import { evidenceUrl, getProject, profile } from "@/content";
import { Container, MonoLabel, SectionHeader, Tag, TextLink } from "@/components/ui/primitives";
import { SemanticSearchLab } from "@/components/labs/semantic-search/SemanticSearchLab";

const project = getProject("semages");
const title = project?.lab.title ?? "Semantic search in your browser";
const description =
  "Real CLIP ViT-B/32 embeddings computed in your browser: load the model, add your own photos, and search them in plain English. The same normalise-and-cosine pipeline as Semages, with nothing uploaded.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/labs/semantic-search" },
  openGraph: { type: "website", siteName: profile.name, title: `${title} · ${profile.name}`, description, url: "/labs/semantic-search" },
  twitter: { card: "summary_large_image", title: `${title} · ${profile.name}`, description },
};

/** Each step of the lab next to the Semages code that does the same thing (path:line in the repo). */
const MAPPING: { step: string; here: string; semages: string; evidence: string[] }[] = [
  {
    step: "Model",
    here: "CLIP ViT-B/32 with OpenAI's weights (Xenova/clip-vit-base-patch32), 8-bit ONNX, run by transformers.js on WebGPU or WebAssembly.",
    semages: "OpenCLIP ViT-B-32 with the laion2b_s34b_b79k weights, PyTorch on the CPU.",
    evidence: ["src/load_model.py:6-11"],
  },
  {
    step: "Encode images",
    here: "Your browser scales each image to 224 px on the short side; CLIP's processor centre-crops it. One image per encode call.",
    semages: "preprocess(Image.open(path)).unsqueeze(0), then model.encode_image. One image per call.",
    evidence: ["src/indexer.py:32-33"],
  },
  {
    step: "Normalise",
    here: "v / ‖v‖ in JavaScript, for images and the query.",
    semages: "embedding /= embedding.norm(dim=-1, keepdim=True), for images and the query.",
    evidence: ["src/indexer.py:35-36", "src/search.py:25-28"],
  },
  {
    step: "Store",
    here: "An in-memory index in this tab, keyed by the file's SHA-256, so adding a photo twice stores it once.",
    semages: "Qdrant collection image_search (512 dimensions, cosine), one point per upsert with a random uuid4 id and the file path as payload.",
    evidence: ["src/indexer.py:17-24", "src/indexer.py:39-48"],
  },
  {
    step: "Encode the query",
    here: "CLIP's text encoder, then the same normalisation.",
    semages: "tokenizer([query]), model.encode_text, then normalise.",
    evidence: ["src/search.py:21-28"],
  },
  {
    step: "Search",
    here: "Dot product of unit vectors against every image, top-k from a slider (1 to 12), no score threshold.",
    semages: "client.query_points(collection_name, query=vector, limit=2), no score threshold.",
    evidence: ["src/search.py:20", "src/search.py:29-33"],
  },
  {
    step: "Show",
    here: "Score: x.xxxx under each result.",
    semages: "st.image(path, caption=f\"Score: {score:.4f}\").",
    evidence: ["app.py:24"],
  },
];

export default function SemanticSearchLabPage() {
  if (!project) notFound();
  const repo = project.links.repo;
  const branch = project.repoBranch;

  return (
    <Container wide className="py-10 sm:py-14">
      <header data-arch="LabIntro" data-arch-kind="server" className="max-w-[780px]">
        <Link href="/labs" className="inline-flex min-h-10 items-center gap-1.5 font-mono text-[12.5px] text-text-2 hover:text-text">
          <ArrowLeft className="size-3.5" aria-hidden />
          All labs
        </Link>
        <SectionHeader
          as="h1"
          className="mt-3"
          eyebrow={`Lab · from ${project.name}`}
          title={title}
          lede="This is not a simulation. When you press Load, your browser downloads a CLIP model and runs it on your own device. It turns every image, and then your sentence, into 512 numbers, and ranks the images by how closely their numbers point the same way as yours."
        />
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Tag className="gap-1.5">
            <Cpu className="size-3.5" aria-hidden />
            In your browser
          </Tag>
          <span className="text-[14px] text-text-2">Real computation on your device. Nothing you add is uploaded.</span>
        </div>
        <p className="mt-5 max-w-[68ch] text-[15.5px] leading-relaxed text-text-2">
          I built {project.name} to find photos by describing them. It runs these steps in Python with Qdrant as the index. Here they run in your
          browser, with a few dozen vectors held in memory instead of a database. Start with the sample images, then drop in your own.
        </p>
      </header>

      <section aria-labelledby="lab-title" className="mt-10">
        <h2 id="lab-title" className="sr-only">
          Interactive lab
        </h2>
        <SemanticSearchLab />
      </section>

      <section aria-labelledby="mapping-title" className="mt-16 max-w-[1080px]" data-arch="SemagesMapping" data-arch-kind="server">
        <SectionHeader
          id="mapping-title"
          eyebrow="Evidence"
          title={`How this maps to ${project.name}`}
          lede={`Every step above has a counterpart in the ${project.name} repository. The links go to the exact lines.`}
        />
        <div className="mt-6 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
            <thead className="bg-surface">
              <tr className="border-b border-line">
                <th scope="col" className="w-[14%] px-4 py-3 font-mono text-[11.5px] font-normal uppercase tracking-[0.1em] text-text-3">
                  Step
                </th>
                <th scope="col" className="w-[36%] px-4 py-3 font-mono text-[11.5px] font-normal uppercase tracking-[0.1em] text-text-3">
                  In this lab
                </th>
                <th scope="col" className="w-[36%] px-4 py-3 font-mono text-[11.5px] font-normal uppercase tracking-[0.1em] text-text-3">
                  In {project.name}
                </th>
                <th scope="col" className="w-[14%] px-4 py-3 font-mono text-[11.5px] font-normal uppercase tracking-[0.1em] text-text-3">
                  Code
                </th>
              </tr>
            </thead>
            <tbody>
              {MAPPING.map((row) => (
                <tr key={row.step} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="px-4 py-3 font-medium text-text">
                    {row.step}
                  </th>
                  <td className="px-4 py-3 text-text-2">{row.here}</td>
                  <td className="px-4 py-3 text-text-2">{row.semages}</td>
                  <td className="px-4 py-3">
                    <ul className="flex flex-col gap-1">
                      {row.evidence.map((ev) => (
                        <li key={ev}>
                          <a
                            href={evidenceUrl(repo, branch, ev)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link"
                          >
                            {ev}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <MonoLabel as="p">What differs</MonoLabel>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-text-2 marker:text-text-3">
              <li>
                The weights. {project.name} uses OpenCLIP&apos;s LAION-2B checkpoint; this lab uses the OpenAI weights that transformers.js can
                load. Same architecture and the same pipeline, but the scores differ slightly.
              </li>
              <li>
                The index. With a few dozen vectors, scoring every one in JavaScript is fast. {project.name} moved from an in-memory matrix
                product like this to Qdrant so the index lives outside the app process.
              </li>
              <li>
                The ids. {project.name} gives each point a random uuid4, so indexing a folder twice stores every image twice. Here ids come from
                a content hash, so a repeat is a no-op.{" "}
                <a
                  href={evidenceUrl(repo, branch, "src/indexer.py:43")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[12px] text-link underline decoration-link/30 underline-offset-[3px]"
                >
                  src/indexer.py:43
                </a>
              </li>
              <li>The top-k. {project.name}&apos;s UI always shows 2 results; here you can pick 1 to 12 and see every score below the cut.</li>
            </ul>
          </div>
          <div>
            <MonoLabel as="p">What stays the same</MonoLabel>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-text-2 marker:text-text-3">
              <li>One shared 512-dimensional space for pictures and sentences.</li>
              <li>L2 normalisation on both sides, so cosine similarity is a dot product.</li>
              <li>No score threshold: a nonsense query still returns k images, ranked.</li>
              <li>Scores printed to 4 decimals.</li>
            </ul>
            <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
              <TextLink href={`/work/${project.slug}`}>Read the {project.name} case study</TextLink>
              <TextLink href={repo}>Source on GitHub</TextLink>
            </p>
          </div>
        </div>
      </section>
    </Container>
  );
}
