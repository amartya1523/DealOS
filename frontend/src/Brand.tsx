import { Layers } from "lucide-react";

export function Brand({ href = "/", onActivate, ariaLabel = "DealOS home", expanded }: { href?: string; onActivate?: () => void; ariaLabel?: string; expanded?: boolean }) {
  const content = <>
      <span className="brand-symbol">
        <Layers />
      </span>
      <span className="brand-name">deal<span>os</span><sup>®</sup></span>
    </>;
  if(onActivate)return <button type="button" className="wordmark" aria-label={ariaLabel} aria-expanded={expanded} onClick={onActivate}>{content}</button>;
  return <a className="wordmark" href={href} aria-label={ariaLabel}>{content}</a>;
}
