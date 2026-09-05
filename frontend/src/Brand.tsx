import { Layers } from "lucide-react";

export function Brand() {
  return (
    <a className="wordmark" href="/" aria-label="DealOS home">
      <span className="brand-symbol">
        <Layers />
      </span>
      deal<span>os</span>
      <sup>®</sup>
    </a>
  );
}
