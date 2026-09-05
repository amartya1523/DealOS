import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateRiskProfile, DealHealth, recommendationFor } from "./DealHealth";
import type { Alert, Quote, Workspace } from "./api";

afterEach(cleanup);

const alert: Alert = { id: "alert-1", kind: "DISCOUNT_ANOMALY", title: "Discount is outside policy", detail: "Q-0102 · Services discount is 18%", severity: "High", resourceId: "quote-1", resolved: false, nudged: false, createdAt: "2026-09-05T10:00:00.000Z" };
const quote = { id: "quote-1", number: "Q-0102", customer: "Acme Corp", customerTier: "Gold", stage: "PENDING_APPROVAL", version: 1, orderDiscount: 0, total: 840000, margin: 210000, riskScore: 8, createdAt: "2026-08-20T10:00:00.000Z", updatedAt: "2026-09-05T10:00:00.000Z", lastActivity: "2026-08-29T10:00:00.000Z", owner: { id: "rep-1", name: "Aarav Mehta" }, lines: [{ id: "line-1", productId: "product-1", quantity: 1, unitPrice: 1000000, unitCost: 600000, discount: 18, allowedDiscount: 10, product: { id: "product-1", name: "Implementation", sku: "SVC-1", category: "Services", description: "Implementation service", unit: "project", price: 1000000, cost: 600000, taxRate: 18, recurring: false, active: true, stocks: [] } }], approvals: [{ id: "approval-1", step: "Sales Manager", sequence: 1, state: "PENDING", createdAt: "2026-09-01T10:00:00.000Z" }], negotiation: [], invoices: [] } as Quote;
const workspace = { user: { id: "admin-1", name: "Admin", email: "admin@example.com", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "org-1", name: "Acme" }, users: [], customers: [], quotes: [quote], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [alert], audits: [] } as Workspace;

describe("Deal Health intervention center", () => {
  it("shows a compact healthy state instead of an empty panel", () => {
    render(<DealHealth data={{ ...workspace, quotes: [], alerts: [] }} mutate={vi.fn()} open={vi.fn()}/>);
    expect(screen.getByRole("heading", { name: "All deals are healthy" })).toBeInTheDocument();
    const healthyState = document.querySelector(".healthy-state") as HTMLElement;
    expect(within(healthyState).getByText("Stalled deals")).toBeInTheDocument();
    expect(within(healthyState).getByText("Discount anomalies")).toBeInTheDocument();
    expect(within(healthyState).getByText("Delivery risks")).toBeInTheDocument();
    expect(within(healthyState).getAllByText("0")).toHaveLength(3);
  });

  it("calculates risk from deal data and recommends the approval action", () => {
    const profile = calculateRiskProfile(alert, quote);
    expect(profile.score).toBeGreaterThanOrEqual(60);
    expect(profile.factors.find(factor => factor.label === "Discount risk")?.points).toBe(32);
    expect(recommendationFor(alert, quote)).toMatch(/pending approval/i);
  });

  it("filters alerts and connects review, nudge, and dismiss actions", () => {
    const mutate = vi.fn(async () => undefined);
    const open = vi.fn();
    render(<DealHealth data={workspace} mutate={mutate} open={open}/>);
    expect(screen.getByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
    expect(screen.getByText("₹8,40,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Review deal/ }));
    expect(open).toHaveBeenCalledWith("approval", "quote-1");
    fireEvent.click(screen.getByRole("button", { name: /Nudge rep/ }));
    expect(mutate).toHaveBeenCalledWith("/deal-health/alert-1/actions", { action: "NUDGE", reason: "Representative follow-up requested from deal health." }, "POST", "Representative nudged");
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge/ }));
    expect(mutate).toHaveBeenCalledWith("/deal-health/alert-1/actions", { action: "ACKNOWLEDGE", reason: "Alert reviewed from deal health." }, "POST", "Alert acknowledged");
    fireEvent.click(screen.getByRole("button", { name: /Resolve/ }));
    expect(mutate).toHaveBeenCalledWith("/deal-health/alert-1/actions", { action: "RESOLVE", reason: "Risk signal resolved from deal health." }, "POST", "Alert resolved");
    fireEvent.click(screen.getByRole("button", { name: /Delivery/ }));
    expect(screen.getByRole("heading", { name: "No alerts match these filters" })).toBeInTheDocument();
  });
});
