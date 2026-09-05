type BrandProps = {
  href?: string;
  onActivate?: () => void;
  ariaLabel?: string;
  expanded?: boolean;
  tone?: "dark" | "light";
};

export function Brand({ href = "/", onActivate, ariaLabel = "DealOS home", expanded, tone = "dark" }: BrandProps) {
  const content = <img className={`brand-logo brand-logo-${tone}`} src="/images/dealos-logo.png" alt="" />;
  if(onActivate)return <button type="button" className="wordmark" aria-label={ariaLabel} aria-expanded={expanded} onClick={onActivate}>{content}</button>;
  return <a className="wordmark" href={href} aria-label={ariaLabel}>{content}</a>;
}
