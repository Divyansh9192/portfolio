import Link from "next/link";
import { profile } from "@/content";
import { BUILD_SHA } from "@/lib/site";
import { Container, MonoLabel } from "@/components/ui/primitives";
import { MotionToggle } from "./MotionToggle";

export function SiteFooter() {
  return (
    <footer data-arch="SiteFooter" data-arch-kind="server" className="mt-24 border-t border-line" data-print="hide">
      <Container wide className="grid gap-10 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <MonoLabel as="p">Contact</MonoLabel>
          <p className="max-w-[44ch] text-text-2">{profile.availability}</p>
          <a href={`mailto:${profile.email}`} className="w-fit font-mono text-[14px] text-text underline decoration-line-strong underline-offset-4 hover:decoration-text">
            {profile.email}
          </a>
        </div>
        <div className="flex flex-col gap-2 text-[14px]">
          <MonoLabel as="p">Elsewhere</MonoLabel>
          <a className="w-fit text-text-2 hover:text-text" href={profile.links.github} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a className="w-fit text-text-2 hover:text-text" href={profile.links.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>
          <a className="w-fit text-text-2 hover:text-text" href={profile.resumePdf} target="_blank" rel="noopener noreferrer">Resume (PDF)</a>
        </div>
        <div className="flex flex-col gap-2 text-[14px]">
          <MonoLabel as="p">This site</MonoLabel>
          <Link className="w-fit text-text-2 hover:text-text" href="/colophon">How it&apos;s built</Link>
          <Link className="w-fit text-text-2 hover:text-text" href="/status">System status</Link>
          <a className="w-fit text-text-2 hover:text-text" href="/llms.txt">llms.txt</a>
          <MotionToggle />
        </div>
      </Container>
      <Container wide className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-5 font-mono text-[12px] text-text-3">
        <span>© {new Date().getFullYear()} {profile.name}</span>
        <span>
          Try <code className="text-text-2">curl</code> on this domain{BUILD_SHA ? <> · build <span className="text-text-2">{BUILD_SHA}</span></> : null}
        </span>
      </Container>
    </footer>
  );
}
