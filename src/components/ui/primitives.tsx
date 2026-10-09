import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

/** Small uppercase mono label used for eyebrows, panel headers, axis-like captions. */
export function MonoLabel({ className, children, as: Tag = "span" }: { className?: string; children: ReactNode; as?: "span" | "p" | "div" | "dt" }) {
  return (
    <Tag className={cn("font-mono text-2xs uppercase tracking-[0.12em] text-text-3", className)}>
      {children}
    </Tag>
  );
}

/** Section heading block: mono eyebrow + display title + optional lede. */
export function SectionHeader({
  eyebrow,
  title,
  lede,
  id,
  className,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  id?: string;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {eyebrow ? <MonoLabel as="p">{eyebrow}</MonoLabel> : null}
      <Tag
        id={id}
        className="font-display text-[clamp(1.75rem,3.6vw,2.6rem)] font-extrabold leading-[1.05] tracking-[-0.015em] text-text [font-stretch:112%]"
      >
        {title}
      </Tag>
      {lede ? <p className="max-w-[62ch] text-[1.0625rem] leading-relaxed text-text-2">{lede}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type Health = "ok" | "warn" | "crit" | "unknown";

const healthColor: Record<Health, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  unknown: "text-text-3",
};

const healthWord: Record<Health, string> = {
  ok: "Healthy",
  warn: "Degraded",
  crit: "Down",
  unknown: "Unknown",
};

/** Health LED + text label. Colour is never the only signal: the label always renders. */
export function StatusPill({
  health,
  label,
  pulse = false,
  className,
}: {
  health: Health;
  label?: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[11.5px] text-text-2",
        className,
      )}
    >
      <span className={cn("led", healthColor[health])} data-pulse={pulse && health === "ok" ? "true" : "false"} aria-hidden />
      <span>{label ?? healthWord[health]}</span>
    </span>
  );
}

/** Neutral tag for stacks, tech, metadata. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-text-2", className)}>
      {children}
    </span>
  );
}

/** Keyboard key. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.4em] items-center justify-center rounded border border-line-strong bg-surface-2 px-1.5 font-mono text-[11px] leading-[1.6] text-text-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** Bordered surface with an optional mono header row (title left, meta right). */
export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName,
  ...rest
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
} & Omit<ComponentProps<"section">, "title">) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow)]", className)} {...rest}>
      {title || meta ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="truncate font-mono text-[11.5px] uppercase tracking-[0.1em] text-text-3">{title}</span>
          {meta ? <span className="shrink-0 font-mono text-[11.5px] text-text-3">{meta}</span> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50";

const buttonVariant: Record<ButtonVariant, string> = {
  primary: "bg-text text-bg hover:bg-text/90",
  secondary: "border border-line-strong bg-surface text-text hover:border-text-3 hover:bg-surface-2",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
};

export function buttonClass(variant: ButtonVariant = "secondary", className?: string) {
  return cn(buttonBase, buttonVariant[variant], className);
}

/** Internal or external link styled as a button. External links open in a new tab. */
export function ButtonLink({
  href,
  variant = "secondary",
  className,
  children,
  external,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: ReactNode;
  external?: boolean;
} & Omit<ComponentProps<"a">, "href" | "className" | "children">) {
  const isExternal = external ?? /^(https?:|mailto:)/.test(href);
  if (isExternal) {
    return (
      <a
        href={href}
        className={buttonClass(variant, className)}
        {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...rest}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, className)} {...rest}>
      {children}
    </Link>
  );
}

/** Inline text link with the site's link colour and a visible underline on hover. */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const cls = cn("text-link underline decoration-link/30 underline-offset-[3px] hover:decoration-link", className);
  if (/^(https?:|mailto:)/.test(href)) {
    return (
      <a href={href} className={cls} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Page-width container with the site gutter. */
export function Container({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-5 sm:px-6", wide ? "max-w-[1240px]" : "max-w-[1080px]", className)}>{children}</div>;
}
