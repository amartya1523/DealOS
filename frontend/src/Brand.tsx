type BrandProps = {
  href?: string;
  onActivate?: () => void;
  tone?: "dark" | "light";
};

export function Brand({ href = "/", onActivate, tone = "dark" }: BrandProps) {
  return <a className="wordmark" href={href} aria-label="DealOS home" onClick={onActivate ? (event) => { event.preventDefault(); onActivate(); } : undefined}>
    <img className={`brand-logo brand-logo-${tone}`} src="/images/dealos-logo.png" alt="" />
  </a>;
}
