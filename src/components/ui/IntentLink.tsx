"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A Link that prefetches on intent (hover, focus or touch) instead of on entering the viewport.
 * For links to heavy routes, such as the labs, that a scroll past shouldn't download.
 */
export function IntentLink(props: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [active, setActive] = useState(false);
  const on = () => setActive(true);
  return <Link {...props} prefetch={active ? null : false} onMouseEnter={on} onFocus={on} onTouchStart={on} />;
}
