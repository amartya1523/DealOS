import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesReporting } from "./SalesReporting";
import type { Quote, Workspace } from "./api";

const now = new Date().toISOString();
const product = { id: "product-1", name: "Revenue Suite", sku: "REV-1", category: "Services", description: "Revenue operations", unit: "Engagement", price: 100000, cost: 60000, taxRate: 18, recurring: false, active: true, stocks: [] };
function quote(input: { id: string; number: string; stage: string; ownerId: string; ownerName: string; total: number; discount: number }): Quote { return { id: input.id, number: input.number, customer: "Acme Corp", customerTier: "Gold", stage: input.stage, version: 1, orderDiscount: 0, total: input.total, margin: input.total * .3, riskScore: 0, createdAt: now, updatedAt: now, lastActivity: now, owner: { id: input.ownerId, name: input.ownerName }, lines: [{ id: `line-${input.id}`, productId: product.id, quantity: 2, unitPrice: 100000, unitCost: 60000, discount: input.discount, allowedDiscount: 8, product }], approvals: input.stage === "PENDING_APPROVAL" ? [{ id: `approval-${input.id}`, step: "Sales Manager", sequence: 1, state: "PENDING", createdAt: now }] : [], negotiation: [], invoices: [] }; }
const quotes = [
  quote({ id: "quote-1", number: "Q-001", stage: "CONFIRMED", ownerId: "rep-1", ownerName: "Aarav Mehta", total: 200000, discount: 5 }),
  quote({ id: "quote-2", number: "Q-002", stage: "PENDING_APPROVAL", ownerId: "rep-2", ownerName: "Maya Shah", total: 300000, discount: 18 }),
];
const workspace = { user: { id: "admin", name: "Admin", email: "admin@example.com", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "org", name: "Acme" }, users: [], customers: [], quotes, products: [product], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] } as Workspace;

beforeEach(() => {
  vi.stubGlobal("print", vi.fn());
  URL.createObjectURL = vi.fn(() => "blob:report");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([80,75]),{status:200,headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}})));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Sales Reporting", () => {
  it("aggregates customers and opens the related quotation", () => {
    const open = vi.fn();
    render(<SalesReporting data={workspace} open={open}/>);
    const customerSection = screen.getByRole("heading", { name: "Value by customer" }).closest("section")!;
    expect(within(customerSection).getAllByText("Acme Corp")).toHaveLength(1);
    expect(within(customerSection).getByText("2")).toBeInTheDocument();
    expect(within(customerSection).getByText("₹5,00,000")).toBeInTheDocument();
    fireEvent.click(within(customerSection).getByRole("button", { name: "Open Acme Corp" }));
    expect(open).toHaveBeenCalledWith("quote", "quote-1");
  });

  it("applies status and representative filters to every report section", () => {
    render(<SalesReporting data={workspace} open={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText("Approval status"), { target: { value: "CONFIRMED" } });
    const quotationCard = screen.getByText("Quotations created").closest("article")!;
    expect(within(quotationCard).getByText("1")).toBeInTheDocument();
    const performanceSection = screen.getByRole("heading", { name: "Representative performance" }).closest("section")!;
    expect(within(performanceSection).queryByText("Maya Shah")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sales team"), { target: { value: "rep-2" } });
    expect(screen.getByRole("heading", { name: "No quotations found for the selected filters." })).toBeInTheDocument();
  });

  it("exports the currently filtered report to print/PDF and native XLSX", async () => {
    render(<SalesReporting data={workspace} open={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText("Approval status"), { target: { value: "CONFIRMED" } });
    fireEvent.click(screen.getByRole("button", { name: /Export PDF/ }));
    expect(window.print).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Export XLS/ }));
    await waitFor(()=>expect(URL.createObjectURL).toHaveBeenCalledOnce());
    const spreadsheet = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(spreadsheet.type).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});
