import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BellRing, CheckCircle2, ChevronDown, ChevronUp, Clock3, Sparkles, TrendingUp, X } from "lucide-react";
import type { Alert, Quote, Workspace } from "./api";

type HealthFilter = "ALL" | "HIGH" | "STALLED" | "DISCOUNT_ANOMALY" | "DELIVERY_SLIPPAGE";
type HealthView = "quote" | "approval" | "fulfillment-detail";
type RiskLevel = "Low" | "Medium" | "High" | "Critical";
type RiskFactor = { label: string; level: RiskLevel; points: number };
type RiskProfile = { score: number; level: RiskLevel; factors: RiskFactor[] };

const healthFilters: Array<[HealthFilter, string]> = [["ALL", "All"], ["HIGH", "High risk"], ["STALLED", "Stalled"], ["DISCOUNT_ANOMALY", "Discount"], ["DELIVERY_SLIPPAGE", "Delivery"]];
const money = (value: number | string, compact = false) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard" }).format(Number(value));
const readable = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
const shortDate = (value: string | Date) => new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const ageInDays = (value?: string) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)) : 0;

export function quoteForAlert(alert: Alert, quotes: Quote[]) {
  return quotes.find(quote => quote.id === alert.resourceId || quote.number === alert.resourceId || `${alert.title} ${alert.detail}`.includes(quote.number));
}

export function calculateRiskProfile(alert: Alert, quote?: Quote): RiskProfile {
  const discountExcess = quote ? Math.max(0, ...quote.lines.map(line => Number(line.discount) - Number(line.allowedDiscount))) : 0;
  const pendingApproval = quote?.approvals.some(approval => approval.state === "PENDING") ?? false;
  const approvalAge = quote ? Math.max(0, ...quote.approvals.filter(approval => approval.state === "PENDING").map(approval => ageInDays(approval.createdAt))) : 0;
  const backorders = quote?.fulfillment?.split.backorders.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
  const inactiveDays = ageInDays(quote?.lastActivity);
  const negotiationCount = quote?.negotiation.length ?? 0;
  const factors: RiskFactor[] = [
    { label: "Discount risk", points: Math.min(35, Math.round(discountExcess * 4)), level: discountExcess > 8 ? "High" : discountExcess > 0 ? "Medium" : "Low" },
    { label: "Approval delay", points: pendingApproval ? Math.min(25, 10 + approvalAge) : 0, level: pendingApproval && approvalAge >= 5 ? "High" : pendingApproval ? "Medium" : "Low" },
    { label: "Delivery risk", points: alert.kind === "DELIVERY_SLIPPAGE" ? Math.min(30, 20 + backorders * 2) : 0, level: alert.kind === "DELIVERY_SLIPPAGE" ? (backorders > 2 ? "High" : "Medium") : "Low" },
    { label: "Customer inactivity", points: alert.kind === "STALLED" ? Math.min(30, Math.max(15, inactiveDays * 3)) : 0, level: alert.kind === "STALLED" ? (inactiveDays >= 9 ? "High" : "Medium") : "Low" },
    { label: "Negotiation activity", points: Math.min(10, negotiationCount * 2), level: negotiationCount >= 4 ? "High" : negotiationCount ? "Medium" : "Low" },
  ];
  const detectedScore = factors.reduce((sum, factor) => sum + factor.points, 0);
  const severityFloor = alert.severity.toLowerCase() === "critical" ? 80 : alert.severity.toLowerCase() === "high" ? 60 : alert.severity.toLowerCase() === "medium" ? 40 : 0;
  const score = Math.min(100, Math.max(detectedScore, severityFloor));
  const level: RiskLevel = score >= 80 ? "Critical" : score >= 60 ? "High" : score >= 35 ? "Medium" : "Low";
  return { score, level, factors };
}

export function recommendationFor(alert: Alert, quote?: Quote) {
  if (alert.kind === "STALLED") return "Ask the sales representative to follow up with the customer today.";
  if (alert.kind === "DISCOUNT_ANOMALY") return quote?.approvals.some(approval => approval.state === "PENDING") ? "Review the discount before the pending approval is completed." : "Review the discount against policy before advancing the deal.";
  if (alert.kind === "DELIVERY_SLIPPAGE") return "Review warehouse allocation and consider an alternative fulfillment split.";
  return "Open the deal and review its latest activity.";
}

export function DealHealth({ data, mutate, open }: { data: Workspace; mutate: (path: string, body: unknown, method?: string, message?: string) => Promise<void>; open: (view: HealthView, id?: string) => void }) {
  const [filter, setFilter] = useState<HealthFilter>("ALL");
  const [representative, setRepresentative] = useState("ALL");
  const [stage, setStage] = useState("ALL");
  const [days, setDays] = useState("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const activeAlerts = data.alerts.filter(alert => !alert.resolved);
  const enriched = activeAlerts.map(alert => ({ alert, quote: quoteForAlert(alert, data.quotes) }));
  const representatives = [...new Set(enriched.map(item => item.quote?.owner?.name).filter((name): name is string => Boolean(name)))].sort();
  const stages = [...new Set(enriched.map(item => item.quote?.stage).filter((value): value is string => Boolean(value)))].sort();
  const filtered = enriched.filter(({ alert, quote }) => {
    const categoryMatch = filter === "ALL" || filter === alert.kind || (filter === "HIGH" && ["high", "critical"].includes(alert.severity.toLowerCase()));
    const repMatch = representative === "ALL" || quote?.owner?.name === representative;
    const stageMatch = stage === "ALL" || quote?.stage === stage;
    const dateMatch = days === "ALL" || ageInDays(alert.createdAt) <= Number(days);
    return categoryMatch && repMatch && stageMatch && dateMatch;
  });
  const atRiskQuotes = [...new Map(enriched.filter(({ alert, quote }) => quote && ["high", "critical"].includes(alert.severity.toLowerCase())).map(({ quote }) => [quote!.id, quote!])).values()];
  const trend = useMemo(() => buildTrend(activeAlerts), [activeAlerts]);

  return <div className="health-center">
    <div className="health-kpis">
      <HealthKpi label="Stalled deals" value={String(activeAlerts.filter(alert => alert.kind === "STALLED").length)} note="Deals inactive beyond threshold"/>
      <HealthKpi label="Discount anomalies" value={String(activeAlerts.filter(alert => alert.kind === "DISCOUNT_ANOMALY").length)} note="Outside representative baseline" tone="warning"/>
      <HealthKpi label="Delivery slippage" value={String(activeAlerts.filter(alert => alert.kind === "DELIVERY_SLIPPAGE").length)} note="Promise date is at risk"/>
      <HealthKpi label="At-risk pipeline" value={money(atRiskQuotes.reduce((sum, quote) => sum + Number(quote.total), 0), true)} note={`${atRiskQuotes.length} ${atRiskQuotes.length === 1 ? "deal requires" : "deals require"} attention`} tone="dark"/>
    </div>

    <div className="health-filterbar" aria-label="Deal health filters">
      <div className="health-filter-tabs">{healthFilters.map(([id, text]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{text}<span>{id === "ALL" ? activeAlerts.length : id === "HIGH" ? activeAlerts.filter(alert => ["high", "critical"].includes(alert.severity.toLowerCase())).length : activeAlerts.filter(alert => alert.kind === id).length}</span></button>)}</div>
      <div className="health-selects">
        <label>Representative<select aria-label="Sales representative" value={representative} onChange={event => setRepresentative(event.target.value)}><option value="ALL">All representatives</option>{representatives.map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Deal stage<select aria-label="Deal stage" value={stage} onChange={event => setStage(event.target.value)}><option value="ALL">All stages</option>{stages.map(value => <option key={value} value={value}>{readable(value)}</option>)}</select></label>
        <label>Date range<select aria-label="Date range" value={days} onChange={event => setDays(event.target.value)}><option value="ALL">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
      </div>
    </div>

    {filtered.length ? <div className="health-layout">
      <section className="health-feed"><div className="health-section-head"><div><span className="eyebrow">Detect → explain → act</span><h2>Actionable alerts</h2></div><span>{filtered.length} active</span></div>{filtered.map(({ alert, quote }) => <HealthAlert key={alert.id} alert={alert} quote={quote} data={data} expanded={expanded === alert.id} toggle={() => setExpanded(expanded === alert.id ? null : alert.id)} mutate={mutate} open={open}/>)}</section>
      <section className="risk-trend"><div className="health-section-head"><div><span className="eyebrow">Last four weeks</span><h2>Risk trend</h2></div><TrendingUp/></div><p>New risk signals detected from persisted deal alerts.</p><div className="risk-bars">{trend.map(row => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${row.width}%` }}/></i><strong>{row.count}</strong></div>)}</div><div className="trend-legend"><span><i/>Stalled</span><span><i/>Discount</span><span><i/>Delivery</span></div></section>
    </div> : <HealthyState stalled={activeAlerts.filter(alert => alert.kind === "STALLED").length} discount={activeAlerts.filter(alert => alert.kind === "DISCOUNT_ANOMALY").length} delivery={activeAlerts.filter(alert => alert.kind === "DELIVERY_SLIPPAGE").length} filtered={activeAlerts.length > 0}/>} 
  </div>;
}

function HealthKpi({ label, value, note, tone = "" }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`health-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function HealthAlert({ alert, quote, data, expanded, toggle, mutate, open }: { alert: Alert; quote?: Quote; data: Workspace; expanded: boolean; toggle: () => void; mutate: (path: string, body: unknown, method?: string, message?: string) => Promise<void>; open: (view: HealthView, id?: string) => void }) {
  const risk = calculateRiskProfile(alert, quote);
  const recommendation = recommendationFor(alert, quote);
  const canNudge = ["REP", "MANAGER", "ADMIN"].includes(data.user.role);
  const discount = quote ? Math.max(0, ...quote.lines.map(line => Number(line.discount))) : null;
  const baseline = quote?.lines.length ? quote.lines.reduce((sum, line) => sum + Number(line.allowedDiscount), 0) / quote.lines.length : null;
  const marginRisk = quote ? quote.lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity * Math.max(0, Number(line.discount) - Number(line.allowedDiscount)) / 100, 0) : 0;
  const backorders = quote?.fulfillment?.split.backorders.reduce((sum, row) => sum + row.quantity, 0) ?? 0;
  const pendingApproval = quote?.approvals.find(approval => approval.state === "PENDING");
  const timeline = buildTimeline(alert, quote, data);
  const openPrimary = () => {
    if (!quote) return;
    if (alert.kind === "DELIVERY_SLIPPAGE") open("fulfillment-detail", quote.id);
    else if (alert.kind === "DISCOUNT_ANOMALY" && pendingApproval) open("approval", quote.id);
    else open("quote", quote.id);
  };
  return <article className={`health-alert ${risk.level.toLowerCase()}`}>
    <div className="health-alert-top"><span className={`severity ${risk.level.toLowerCase()}`}><i/>{risk.level} risk</span><span className="health-alert-type">{readable(alert.kind)}</span><span className="health-alert-date">Detected {shortDate(alert.createdAt)}</span></div>
    <div className="health-alert-summary"><div><span className="eyebrow">{quote?.number ?? alert.resourceId}</span><h3>{quote?.customer ?? alert.title}</h3><strong>{quote ? money(quote.total) : "Value unavailable"}</strong><small>{quote?.owner?.name ? `Owner · ${quote.owner.name}` : "Owner unavailable"}{quote?.stage ? ` · ${readable(quote.stage)}` : ""}</small></div><div className={`risk-score-ring ${risk.level.toLowerCase()}`}><strong>{risk.score}</strong><span>/ 100</span></div></div>
    <div className="health-alert-insight"><div><span className="insight-label"><AlertTriangle/>Why</span><p>{alert.title}</p><small>{alert.detail}</small></div><div className="next-action"><span className="insight-label"><Sparkles/>AI recommendation</span><p>{recommendation}</p></div></div>
    {alert.kind === "DISCOUNT_ANOMALY" && quote && <div className="health-facts"><span>Current discount<strong>{discount?.toFixed(1)}%</strong></span><span>Policy baseline<strong>{baseline?.toFixed(1)}%</strong></span><span>Difference<strong>+{Math.max(0, (discount ?? 0) - (baseline ?? 0)).toFixed(1)} pts</strong></span><span>Potential margin risk<strong>{money(marginRisk)}</strong></span></div>}
    {alert.kind === "DELIVERY_SLIPPAGE" && <div className="health-facts"><span>Fulfillment state<strong>{quote?.fulfillment ? readable(quote.fulfillment.state) : "Allocation pending"}</strong></span><span>Inventory shortfall<strong>{backorders ? `${backorders} units` : "Recorded risk signal"}</strong></span><span>Reason<strong>{alert.detail}</strong></span></div>}
    <div className="health-alert-actions">
      {canNudge && <button className="button primary" disabled={alert.nudged} onClick={() => mutate(`/deal-health/${alert.id}/actions`, { action: "NUDGE", reason: "Representative follow-up requested from deal health." }, "POST", "Representative nudged")}><BellRing/>{alert.nudged ? "Rep nudged" : "Nudge rep"}</button>}
      {quote && <button className="button ghost" onClick={openPrimary}>{alert.kind === "DELIVERY_SLIPPAGE" ? "View fulfillment" : alert.kind === "DISCOUNT_ANOMALY" && pendingApproval ? "Review deal" : "Open deal"}<ArrowRight/></button>}
      {canNudge && <button className="button ghost" disabled={Boolean(alert.acknowledgedAt)} onClick={() => mutate(`/deal-health/${alert.id}/actions`, { action: "ACKNOWLEDGE", reason: "Alert reviewed from deal health." }, "POST", "Alert acknowledged")}><CheckCircle2/>{alert.acknowledgedAt ? "Acknowledged" : "Acknowledge"}</button>}
      <button className="button quiet" onClick={() => mutate(`/deal-health/${alert.id}/actions`, { action: "RESOLVE", reason: "Risk signal resolved from deal health." }, "POST", "Alert resolved")}><X/>Resolve</button>
      <button className="health-why-toggle" aria-expanded={expanded} onClick={toggle}>{expanded ? "Hide risk detail" : "Why is this deal at risk?"}{expanded ? <ChevronUp/> : <ChevronDown/>}</button>
    </div>
    {expanded && <div className="health-detail"><div><h4>Why this deal is at risk</h4><div className="risk-factor-list">{risk.factors.map(factor => <div key={factor.label}><span className={factor.level.toLowerCase()}>{factor.level === "Low" ? <CheckCircle2/> : <AlertTriangle/>}</span><b>{factor.label}</b><em>{factor.level}</em></div>)}</div><div className="overall-risk">Overall risk <strong>{risk.level.toUpperCase()}</strong></div></div><div><h4>Deal timeline</h4>{timeline.length ? <div className="deal-timeline">{timeline.map((event, index) => <div key={`${event.date}-${index}`}><i/><time>{shortDate(event.date)}</time><span>{event.text}</span></div>)}</div> : <p className="muted">No related activity has been recorded yet.</p>}</div></div>}
  </article>;
}

function HealthyState({ stalled, discount, delivery, filtered }: { stalled: number; discount: number; delivery: number; filtered: boolean }) {
  return <section className="healthy-state"><span><CheckCircle2/></span><div><span className="eyebrow">{filtered ? "No matching alerts" : "Deal health clear"}</span><h2>{filtered ? "No alerts match these filters" : "All deals are healthy"}</h2><p>{filtered ? "Adjust the filters to see other active risk signals." : "No active risk signals require intervention right now."}</p></div><dl><div><dt>Stalled deals</dt><dd>{stalled}</dd></div><div><dt>Discount anomalies</dt><dd>{discount}</dd></div><div><dt>Delivery risks</dt><dd>{delivery}</dd></div></dl></section>;
}

function buildTimeline(alert: Alert, quote: Quote | undefined, data: Workspace) {
  const events: Array<{ date: string; text: string }> = [];
  if (quote?.createdAt) events.push({ date: quote.createdAt, text: "Quotation created" });
  quote?.approvals.forEach(approval => events.push({ date: approval.decidedAt ?? approval.createdAt ?? quote.updatedAt, text: approval.decidedAt ? `${approval.step} ${readable(approval.state).toLowerCase()}` : `${approval.step} approval requested` }));
  quote?.negotiation.forEach(item => events.push({ date: item.createdAt, text: `${item.author}: ${item.message}` }));
  data.audits.filter(event => [alert.id, quote?.id].includes(event.resourceId)).forEach(event => events.push({ date: event.createdAt, text: readable(event.action) }));
  events.push({ date: alert.createdAt, text: `${readable(alert.kind)} detected` });
  return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 7);
}

function buildTrend(alerts: Alert[]) {
  const now = new Date();
  const rows = Array.from({ length: 4 }, (_, reverseIndex) => {
    const index = 3 - reverseIndex;
    const end = new Date(now); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() - index * 7);
    const start = new Date(end); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
    const count = alerts.filter(alert => { const created = new Date(alert.createdAt); return created >= start && created <= end; }).length;
    return { label: shortDate(start).replace(/, \d{4}/, ""), count };
  });
  const max = Math.max(1, ...rows.map(row => row.count));
  return rows.map(row => ({ ...row, width: Math.max(row.count ? 10 : 0, row.count / max * 100) }));
}
