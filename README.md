# Divyansh Deep — Portfolio

A Next.js + Tailwind + Framer Motion portfolio site, styled after the layout and
motion language of imkarthik.in: pure black background, neon green accent, a
gradient-animated tagline, a floating pill nav that tracks scroll position, and
sticky per-project headers in an alternating-row "Selected Work" section. Custom
cursor, scroll-triggered architecture diagrams that draw themselves in, in-page
animated case studies, and self-hosted fonts (JetBrains Mono, Inter, Montserrat,
Caveat).

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Project structure

- `src/data/projects.ts` — all project + case study content. Edit this file to
  update text, stack tags, links, or diagram layouts. Nothing else needs to change
  for a content update.
- `src/components/WorkSection.tsx` — the "Selected Work" section: sticky project
  name header per block, diagram-left/headline-right alternating row, matching the
  imkarthik.in case-row pattern but built around architecture diagrams instead of
  screenshots.
- `src/components/ArchitectureDiagram.tsx` — renders the system diagrams (both the
  small in-row versions and the full case-study versions) from the node/edge data
  in `projects.ts`, with a scroll-triggered draw-on animation.
- `src/components/CaseStudyOverlay.tsx` — the full-screen animated panel that opens
  when you click "Read the full case study." Not a separate route — it's an
  overlay so the page never reloads.
- `src/components/FloatingNav.tsx` — the fixed bottom pill nav with a sliding
  active-state pill that tracks scroll position (About / Work / Experience /
  Contact), styled after imkarthik.in's bottom nav.
- `src/components/CustomCursor.tsx` — the dot + ring cursor that replaces the
  system cursor on desktop (hidden automatically on touch devices).
- `src/components/SplitHeading.tsx` — character-by-character reveal animation,
  used for the "Hands-on Experience" heading.
- `public/fonts/` — self-hosted variable font files. These are loaded via
  `@font-face` in `globals.css` rather than `next/font/google`, since the build
  sandbox this was built in couldn't reach `fonts.googleapis.com`. If you deploy
  somewhere with normal internet access, this still works fine as-is — no change
  needed.

## Design notes

- Palette: pure black (`#000000`) background, neon green (`#25D467`) primary
  accent, amber→coral gradient (`#FBBA27` → `#FB7481`) for emphasis text via the
  `.gradient-text` CSS class. JetBrains Mono carries the engineering identity
  (nav, tags, data); Montserrat is the display font for the name; Caveat is used
  sparingly for the gradient tagline and the handwritten margin-note annotations
  near the diagrams.
- Motion: scroll-linked hero parallax, orchestrated page-load stagger, a custom
  cursor with a magnetic ring, a scroll progress bar, and architecture diagrams
  that draw themselves on (boxes stroke in, then edges, then labels) the first
  time they scroll into view.
- A note on Framer Motion viewport detection: components that fade/slide in on
  scroll use `viewport={{ once: true, amount: 0.1 }}` rather than large negative
  `margin` values. Negative margins shrink the effective viewport on all sides,
  and on a tall element (like a full project block with title + tags + diagram)
  that can mean the intersection threshold is never satisfied — the element stays
  at `opacity: 0` forever. If you add new scroll-reveal sections, prefer `amount`
  over `margin` for anything taller than ~400px.

## Filling in real links

Search for `"#"` in `src/data/projects.ts` — those are placeholders for:
- Resume link (in `Hero.tsx`, hardcoded — search for `href="#"` near "Resume")
- Repo URLs for Orchrez, LinkedIn Clone, Semages
- Live URL for NeonStays

## Deploying

This is a standard Next.js app — [Vercel](https://vercel.com/new) is the path of
least resistance (it's built by the same team and has zero-config Next.js support).
Push to a GitHub repo and import it on Vercel, or run `vercel` from this directory
if you have the CLI installed.

## Editing content

To change project copy, stack tags, decisions, or stats: edit `src/data/projects.ts`.
Every project follows the same shape (`Project` type at the top of that file), so
adding a 5th project means copying one of the existing objects in the `projects`
array and changing the content — the work section and case study overlay both
read from this array automatically.

