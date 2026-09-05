import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, BarChart3, Download, FileSpreadsheet, FilterX, Package, Printer, TrendingUp, Users } from "lucide-react";
import type { Quote, Workspace } from "./api";

type Period = "MONTH" | "QUARTER" | "YEAR" | "ALL";
type ReportView = "quote";

const currency = (value: number | string, compact = false) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard" }).format(Number(value));
const readable = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, character => character.toUpperCase());
const percent = (part: number, total: number) => total ? `${Math.round(part / total * 100)}%` : "—";
const isoDay = (value: string) => value.slice(0, 10);

function periodRange(period: Period, previous = false) {
  const now = new Date();
  if (period === "ALL") return null;
  if (period === "MONTH") {
    const start = new Date(now.getFullYear(), now.getMonth() - (previous ? 1 : 0), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + (previous ? 0 : 1), 1);
    return { start, end };
  }
  if (period === "QUARTER") {
    const quarterStart = Math.floor(now.getMonth() / 3) * 3 - (previous ? 3 : 0);
    return { start: new Date(now.getFullYear(), quarterStart, 1), end: new Date(now.getFullYear(), quarterStart + 3, 1) };
  }
  return { start: new Date(now.getFullYear() - (previous ? 1 : 0), 0, 1), end: new Date(now.getFullYear() + (previous ? 0 : 1), 0, 1) };
}

function inPeriod(quote: Quote, period: Period, previous = false) {
  const range = periodRange(period, previous);
  if (!range) return true;
  const created = new Date(quote.createdAt);
  return created >= range.start && created < range.end;
}

export function SalesReporting({ data, open }: { data: Workspace; open: (view: ReportView, id?: string) => void }) {
  const [period, setPeriod] = useState<Period>("MONTH");
  const [owner, setOwner] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [product, setProduct] = useState("ALL");
  const owners = [...new Map(data.quotes.filter(quote => quote.owner).map(quote => [quote.owner!.id, quote.owner!])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...new Set(data.quotes.flatMap(quote => quote.lines.map(line => line.product.category)))].sort();
  const products = [...new Map(data.quotes.flatMap(quote => quote.lines.map(line => [line.product.id, line.product]))).values()].sort((a, b) => a.name.localeCompare(b.name));
  const matchesDimensions = (quote: Quote) => (owner === "ALL" || quote.owner?.id === owner) && (status === "ALL" || quote.stage === status) && (product === "ALL" || (product.startsWith("CATEGORY:") ? quote.lines.some(line => line.product.category === product.slice(9)) : quote.lines.some(line => line.product.id === product.slice(8))));
  const filtered = data.quotes.filter(quote => inPeriod(quote, period) && matchesDimensions(quote));
  const previous = period === "ALL" ? [] : data.quotes.filter(quote => inPeriod(quote, period, true) && matchesDimensions(quote));
  const approved = filtered.filter(quote => ["APPROVED", "CONFIRMED"].includes(quote.stage));
  const pipelineValue = filtered.reduce((sum, quote) => sum + Number(quote.total), 0);
  const confirmedValue = approved.reduce((sum, quote) => sum + Number(quote.total), 0);
  const comparison = period === "ALL" ? "All available history" : previous.length ? `${filtered.length >= previous.length ? "+" : ""}${Math.round((filtered.length - previous.length) / previous.length * 100)}% vs previous period` : "No quotations in previous period";
  const report = useMemo(() => buildReport(filtered), [filtered]);
  const resetFilters = () => { setPeriod("MONTH"); setOwner("ALL"); setStatus("ALL"); setProduct("ALL"); };
  const exportXls = () => downloadSpreadsheet(filtered, { period, owner: owners.find(item => item.id === owner)?.name ?? "All teams", status: status === "ALL" ? "All statuses" : readable(status), product: product === "ALL" ? "All products" : product.startsWith("CATEGORY:") ? product.slice(9) : products.find(item => item.id === product.slice(8))?.name ?? "Product" });
  const exportPdf = () => { const original = document.title; document.title = `DealOS Sales Report — ${new Date().toISOString().slice(0, 10)}`; window.print(); document.title = original; };

  return <div className="reports-dashboard">
    <section className="report-filterbar" aria-label="Sales report filters">
      <div className="report-filter-fields">
        <label>Period<select aria-label="Period" value={period} onChange={event => setPeriod(event.target.value as Period)}><option value="MONTH">This month</option><option value="QUARTER">This quarter</option><option value="YEAR">This year</option><option value="ALL">All time</option></select></label>
        <label>Sales team<select aria-label="Sales team" value={owner} onChange={event => setOwner(event.target.value)}><option value="ALL">All assigned teams</option>{owners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Approval status<select aria-label="Approval status" value={status} onChange={event => setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="NEGOTIATION">Negotiation</option><option value="CONFIRMED">Confirmed</option><option value="DRAFT">Draft</option></select></label>
        <label>Product / category<select aria-label="Product or category" value={product} onChange={event => setProduct(event.target.value)}><option value="ALL">All products and categories</option>{categories.map(category => <option key={category} value={`CATEGORY:${category}`}>Category · {category}</option>)}{products.map(item => <option key={item.id} value={`PRODUCT:${item.id}`}>Product · {item.name}</option>)}</select></label>
      </div>
      <div className="report-export-actions"><button className="button quiet" onClick={resetFilters}><FilterX/>Reset</button><button className="button ghost" disabled={!filtered.length} onClick={exportPdf}><Printer/>Export PDF</button><button className="button ghost" disabled={!filtered.length} onClick={exportXls}><FileSpreadsheet/>Export XLS</button></div>
    </section>

    {!filtered.length ? <ReportEmpty reset={resetFilters}/> : <>
      <section className="report-kpis">
        <ReportKpi label="Quotations created" value={String(filtered.length)} note={comparison}/>
        <ReportKpi label="Approved / confirmed" value={String(approved.length)} note={`${percent(approved.length, filtered.length)} conversion`}/>
        <ReportKpi label="Pipeline value" value={currency(pipelineValue, true)} note={`${currency(pipelineValue / filtered.length)} average deal`} tone="dark"/>
        <ReportKpi label="Confirmed value" value={currency(confirmedValue, true)} note={`${approved.length} approved or confirmed`} tone="accent"/>
      </section>

      <section className="report-panel sales-funnel"><ReportHeading eyebrow="Stage progression" title="Sales funnel" icon={<TrendingUp/>}/><div className="funnel-track">{report.funnel.map((step, index) => <div key={step.label} style={{ "--funnel-width": `${Math.max(28, step.count / Math.max(1, filtered.length) * 100)}%` } as CSSProperties}><span>{index + 1}</span><div><b>{step.label}</b><strong>{step.count}</strong><small>{percent(step.count, filtered.length)} of created</small></div></div>)}</div></section>

      <section className="report-panel sales-trend"><ReportHeading eyebrow="Selected period" title="Sales trend" icon={<BarChart3/>}/><div className="trend-chart" role="img" aria-label="Quotation count and confirmed value over time">{report.trend.map(point => <div key={point.label}><div className="trend-columns"><i style={{ height: `${Math.max(point.quotes ? 12 : 2, point.quotes / report.maxTrendQuotes * 100)}%` }} title={`${point.quotes} quotations`}/><i style={{ height: `${Math.max(point.confirmed ? 12 : 2, point.confirmed / report.maxTrendValue * 100)}%` }} title={`${currency(point.confirmed)} confirmed`}/></div><span>{point.label}</span></div>)}</div><div className="report-legend"><span><i/>Quotes created</span><span><i/>Confirmed value</span></div></section>

      <div className="report-grid two">
        <section className="report-panel"><ReportHeading eyebrow="Account concentration" title="Value by customer"/><div className="report-table"><table><thead><tr><th>Customer</th><th>Deals</th><th>Pipeline value</th><th/></tr></thead><tbody>{report.customers.map(customer => <tr key={customer.name}><td><b>{customer.name}</b></td><td>{customer.quotes.length}</td><td><strong>{currency(customer.value)}</strong></td><td><button aria-label={`Open ${customer.name}`} onClick={() => open("quote", customer.quotes[0]!.id)}>Open <ArrowRight/></button></td></tr>)}</tbody></table></div></section>
        <section className="report-panel"><ReportHeading eyebrow="Team output" title="Representative performance" icon={<Users/>}/><div className="report-table"><table><thead><tr><th>Representative</th><th>Quotes</th><th>Won</th><th>Conversion</th><th>Pipeline</th><th>Confirmed</th></tr></thead><tbody>{report.representatives.map(rep => <tr key={rep.id}><td><b>{rep.name}</b></td><td>{rep.quotes}</td><td>{rep.won}</td><td>{percent(rep.won, rep.quotes)}</td><td>{currency(rep.pipeline, true)}</td><td>{currency(rep.confirmed, true)}</td></tr>)}</tbody></table></div></section>
      </div>

      <div className="report-grid two">
        <section className="report-panel discount-report"><ReportHeading eyebrow="Commercial quality" title="Discount & margin analysis"/><div className="discount-summary"><div><span>Average discount</span><strong>{report.discounts.average.toFixed(1)}%</strong></div><div><span>Highest discount</span><strong>{report.discounts.highest.toFixed(1)}%</strong></div><div><span>Quoted discount value</span><strong>{currency(report.discounts.amount, true)}</strong></div><div><span>Potential margin risk</span><strong>{currency(report.discounts.risk, true)}</strong></div></div><div className="category-discounts">{report.discounts.categories.map(category => <div key={category.name}><span>{category.name}</span><i><b style={{ width: `${Math.min(100, category.average * 4)}%` }}/></i><strong>{category.average.toFixed(1)}%</strong></div>)}</div></section>
        <section className="report-panel"><ReportHeading eyebrow="Workflow latency" title="Approval bottlenecks"/><div className="report-table"><table><thead><tr><th>Approval role</th><th>Pending</th><th>Average wait</th><th>Longest wait</th></tr></thead><tbody>{report.approvals.length ? report.approvals.map(row => <tr key={row.step}><td><b>{row.step}</b></td><td><span className="report-pending">{row.pending}</span></td><td>{formatWait(row.averageHours)}</td><td>{formatWait(row.longestHours)}</td></tr>) : <tr><td colSpan={4}><div className="inline-empty">No pending approvals in this dataset.</div></td></tr>}</tbody></table></div></section>
      </div>

      <section className="report-panel"><ReportHeading eyebrow="Product contribution" title="Top products" icon={<Package/>}/><div className="report-table"><table><thead><tr><th>Product</th><th>Category</th><th>Deal frequency</th><th>Quantity</th><th>Quoted value</th></tr></thead><tbody>{report.products.map((item, index) => <tr key={item.id}><td><b>{item.name}</b>{index === 0 && <small className="top-product">Top contributor</small>}</td><td>{item.category}</td><td>{item.deals}</td><td>{item.quantity}</td><td><strong>{currency(item.value)}</strong></td></tr>)}</tbody></table></div></section>
    </>}
  </div>;
}

function ReportKpi({ label, value, note, tone = "" }: { label: string; value: string; note: string; tone?: string }) { return <article className={`report-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function ReportHeading({ eyebrow, title, icon }: { eyebrow: string; title: string; icon?: ReactNode }) { return <div className="report-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{icon}</div>; }
function ReportEmpty({ reset }: { reset: () => void }) { return <section className="report-empty"><span><BarChart3/></span><h2>No quotations found for the selected filters.</h2><p>Change the reporting period or remove one of the selected dimensions.</p><button className="button primary" onClick={reset}><FilterX/>Reset filters</button></section>; }

function buildReport(quotes: Quote[]) {
  const funnelStages = [["Quotes created", null], ["Pending approval", "PENDING_APPROVAL"], ["Approved", "APPROVED"], ["Negotiation", "NEGOTIATION"], ["Confirmed", "CONFIRMED"]] as const;
  const funnel = funnelStages.map(([label, stage]) => ({ label, count: stage ? quotes.filter(quote => quote.stage === stage).length : quotes.length }));
  const customers = [...quotes.reduce((map, quote) => { const row = map.get(quote.customer) ?? { name: quote.customer, value: 0, quotes: [] as Quote[] }; row.value += Number(quote.total); row.quotes.push(quote); map.set(quote.customer, row); return map; }, new Map<string, { name: string; value: number; quotes: Quote[] }>()).values()].sort((a, b) => b.value - a.value);
  const representatives = [...quotes.reduce((map, quote) => { const id = quote.owner?.id ?? "unassigned"; const row = map.get(id) ?? { id, name: quote.owner?.name ?? "Unassigned", quotes: 0, won: 0, pipeline: 0, confirmed: 0 }; row.quotes++; row.pipeline += Number(quote.total); if (["APPROVED", "CONFIRMED"].includes(quote.stage)) { row.won++; row.confirmed += Number(quote.total); } map.set(id, row); return map; }, new Map<string, { id: string; name: string; quotes: number; won: number; pipeline: number; confirmed: number }>()).values()].sort((a, b) => b.confirmed - a.confirmed || b.pipeline - a.pipeline);
  const lines = quotes.flatMap(quote => quote.lines);
  const lineWeight = lines.reduce((sum, line) => sum + line.quantity, 0);
  const average = lineWeight ? lines.reduce((sum, line) => sum + Number(line.discount) * line.quantity, 0) / lineWeight : 0;
  const highest = Math.max(0, ...lines.map(line => Number(line.discount)));
  const amount = lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity * Number(line.discount) / 100, 0);
  const risk = lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity * Math.max(0, Number(line.discount) - Number(line.allowedDiscount)) / 100, 0);
  const categories = [...lines.reduce((map, line) => { const row = map.get(line.product.category) ?? { name: line.product.category, weighted: 0, quantity: 0 }; row.weighted += Number(line.discount) * line.quantity; row.quantity += line.quantity; map.set(line.product.category, row); return map; }, new Map<string, { name: string; weighted: number; quantity: number }>()).values()].map(row => ({ name: row.name, average: row.quantity ? row.weighted / row.quantity : 0 })).sort((a, b) => b.average - a.average);
  const products = [...lines.reduce((map, line) => { const row = map.get(line.product.id) ?? { id: line.product.id, name: line.product.name, category: line.product.category, deals: new Set<string>(), quantity: 0, value: 0 }; const quote = quotes.find(item => item.lines.some(candidate => candidate.id === line.id)); if (quote) row.deals.add(quote.id); row.quantity += line.quantity; row.value += Number(line.unitPrice) * line.quantity * (1 - Number(line.discount) / 100); map.set(line.product.id, row); return map; }, new Map<string, { id: string; name: string; category: string; deals: Set<string>; quantity: number; value: number }>()).values()].map(row => ({ ...row, deals: row.deals.size })).sort((a, b) => b.value - a.value);
  const approvals = [...quotes.flatMap(quote => quote.approvals.filter(approval => approval.state === "PENDING")).reduce((map, approval) => { const hours = approval.createdAt ? Math.max(0, (Date.now() - new Date(approval.createdAt).getTime()) / 3_600_000) : 0; const row = map.get(approval.step) ?? { step: approval.step, pending: 0, totalHours: 0, longestHours: 0 }; row.pending++; row.totalHours += hours; row.longestHours = Math.max(row.longestHours, hours); map.set(approval.step, row); return map; }, new Map<string, { step: string; pending: number; totalHours: number; longestHours: number }>()).values()].map(row => ({ ...row, averageHours: row.pending ? row.totalHours / row.pending : 0 })).sort((a, b) => b.longestHours - a.longestHours);
  const trendMap = quotes.reduce((map, quote) => { const key = isoDay(quote.createdAt); const row = map.get(key) ?? { label: new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" }).format(new Date(quote.createdAt)), quotes: 0, confirmed: 0 }; row.quotes++; if (["APPROVED", "CONFIRMED"].includes(quote.stage)) row.confirmed += Number(quote.total); map.set(key, row); return map; }, new Map<string, { label: string; quotes: number; confirmed: number }>());
  const trend = [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([, value]) => value);
  return { funnel, customers, representatives, discounts: { average, highest, amount, risk, categories }, products, approvals, trend, maxTrendQuotes: Math.max(1, ...trend.map(point => point.quotes)), maxTrendValue: Math.max(1, ...trend.map(point => point.confirmed)) };
}

function formatWait(hours: number) { if (!hours) return "Just now"; if (hours < 24) return `${Math.round(hours)}h`; return `${Math.round(hours / 24)}d`; }

function downloadSpreadsheet(quotes: Quote[], filters: Record<string, string>) {
  const escape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const rows = quotes.map(quote => `<tr><td>${escape(quote.number)}</td><td>${escape(quote.customer)}</td><td>${escape(quote.owner?.name ?? "Unassigned")}</td><td>${escape(readable(quote.stage))}</td><td>${Number(quote.total)}</td><td>${escape(isoDay(quote.createdAt))}</td></tr>`).join("");
  const summary = Object.entries(filters).map(([key, value]) => `<tr><th>${escape(readable(key))}</th><td>${escape(value)}</td></tr>`).join("");
  const html = `<html><head><meta charset="utf-8"></head><body><table>${summary}</table><br/><table border="1"><thead><tr><th>Quotation</th><th>Customer</th><th>Representative</th><th>Status</th><th>Value (INR)</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `dealos-sales-report-${new Date().toISOString().slice(0, 10)}.xls`; link.click(); URL.revokeObjectURL(url);
}
