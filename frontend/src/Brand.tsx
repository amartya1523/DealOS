import { Layers } from "lucide-react";

export function Brand({ href = "/", onActivate }: { href?: string; onActivate?: () => void }) {
  return (
    <a className="wordmark" href={href} aria-label="DealOS home" onClick={onActivate ? (event) => { event.preventDefault(); onActivate(); } : undefined}>
      <span className="brand-symbol">
        <Layers />
      </span>
      <span className="brand-name">deal<span>os</span><sup>®</sup></span>
    </a>
  );
}
