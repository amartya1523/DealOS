import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("gsap", () => ({
  default: {
    registerPlugin: vi.fn(),
    matchMedia: () => ({ add: vi.fn(), revert: vi.fn() }),
  },
}));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: {} }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = vi.fn();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({
      success: false,
      error: { message: "Please sign in" },
    }),
  });
  window.history.replaceState({}, "", "/");
});
afterEach(cleanup);
describe("DealOS public routes", () => {
  it("renders the landing page and interactive workflow", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /The deal is a system. Run it like one./ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Workspace preview")).not.toBeInTheDocument();
    expect(screen.queryByText("$284,500")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "See the rule. See the reason." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Revision 06 · Draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause motion" }));
    expect(
      screen.getByRole("button", { name: "Resume motion" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("link", { name: "Open your deal room" }),
    ).toHaveAttribute("href", "/sign-up");
  });
  it("shows a failed login without losing entered email", async () => {
    window.history.replaceState({}, "", "/sign-in");
    render(<App />);
    fireEvent.change(screen.getByLabelText("Email or user ID"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "WrongPassword12!" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Sign in to your workspace/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please sign in",
    );
    expect(screen.getByLabelText("Email or user ID")).toHaveValue("test@example.com");
  });
  it("creates an organization admin and opens the isolated admin dashboard", async () => {
    window.history.replaceState({}, "", "/sign-up");
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: url.endsWith("/signup") || url.endsWith("/workspace"),
        json: async () =>
          url.endsWith("/signup")
            ? { success: true, data: { status: "ACTIVE", role: "ADMIN" } }
            : url.endsWith("/workspace")
              ? { success:true, data:{user:{id:'a',name:'Test Person',email:'test@example.com',role:'ADMIN',moduleAccess:[]},organization:{id:'o',name:'Acme'},users:[],quotes:[],products:[],policies:[],warehouses:[],subscriptions:[],invoices:[],alerts:[],audits:[]} }
              : { success: false },
      }),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Admin full name"), {
      target: { value: "Test Person" },
    });
    fireEvent.change(screen.getByLabelText("Admin email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "TestPassword12!" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    expect(await screen.findByRole("heading", {name:"Sales dashboard"})).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app");
    expect(screen.getByRole("button", { name: "New quotation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View reports" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View reports" }));
    expect(screen.getByRole("heading", { name: "Sales reporting" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "New quotation" }));
    expect(screen.getByRole("heading", { name: "New quotation" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/signup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          organizationName: "Acme",
          email: "test@example.com",
          password: "TestPassword12!",
          displayName: "Test Person",
        }),
      }),
    );
  });
  it("protects direct workspace access", async () => {
    window.history.replaceState({}, "", "/app");
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Welcome back." }),
    ).toBeInTheDocument();
  });
  it("filters the approval queue by pending, returned, and approved state", async () => {
    window.history.replaceState({}, "", "/app");
    const quote = (id:string, stage:string, state:string) => ({ id, number:`Q-${id}`, customer:`${id} Customer`, customerTier:'Gold', stage, version:1, orderDiscount:0, total:100, margin:20, riskScore:1, updatedAt:'2026-09-05T00:00:00.000Z', lines:[], approvals:[{id:`approval-${id}`,step:'Sales Manager',sequence:1,state}], negotiation:[], invoices:[] });
    const workspace = { user:{id:'admin',name:'Admin User',email:'admin@example.com',role:'ADMIN',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null}, organization:{id:'org',name:'Acme'}, users:[], quotes:[quote('PENDING','PENDING_APPROVAL','PENDING'),quote('RETURNED','DRAFT','RETURNED'),quote('APPROVED','APPROVED','APPROVED'),quote('REJECTED','REJECTED','REJECTED')], products:[], policies:[], warehouses:[], subscriptions:[], invoices:[], alerts:[], audits:[] };
    fetchMock.mockImplementation((url:string) => Promise.resolve({ok:true,json:async()=>({success:true,data:url.endsWith('/workspace')?workspace:{}})}));
    render(<App/>);
    expect(await screen.findByRole("heading", {name:"Sales dashboard"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Approvals"}));
    expect(screen.getByText("Q-PENDING")).toBeInTheDocument();
    expect(screen.queryByText("Q-RETURNED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Pending"})).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", {name:"Returned"}));
    expect(screen.getByText("Q-RETURNED")).toBeInTheDocument();
    expect(screen.queryByText("Q-PENDING")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Returned"})).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", {name:"Approved"}));
    expect(screen.getByText("Q-APPROVED")).toBeInTheDocument();
    expect(screen.queryByText("Q-RETURNED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Approved"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Q-REJECTED")).not.toBeInTheDocument();
  });
  it("shows the dedicated invitation-only customer sign-in", async () => {
    window.history.replaceState({}, "", "/customer");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Everything shared with you, in one place." })).toBeInTheDocument();
    expect(screen.getByLabelText("Customer Email ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google Sign-In ID" })).toBeInTheDocument();
  });
  it("opens customer-scoped invoices in the new deal room", async () => {
    window.history.replaceState({}, "", "/customer");
    const portalWorkspace = { user:{id:'customer',name:'Priya Nair',email:'customer@dealos.demo',role:'CUSTOMER',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null},organization:{id:'org',name:'DealOS Demo'},users:[],customers:[],quotes:[],products:[],policies:[],warehouses:[],subscriptions:[],invoices:[{id:'invoice',number:'INV-1042',customer:'Acme Corp',amount:'2520',paidAmount:'0',state:'UNPAID',dueAt:'2026-09-20T00:00:00.000Z',lines:[],payments:[]}],alerts:[],audits:[] };
    fetchMock.mockResolvedValue({ok:true,json:async()=>({success:true,data:portalWorkspace})});
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Review your quotations" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Invoices/ }));
    expect(screen.getByRole("heading", { name: "INV-1042" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/v1/invoices/invoice/pdf");
  });
  it("uses the dedicated Platform Owner login and opens global control", async () => {
    window.history.replaceState({}, "", "/login/super-admin");
    const ownerWorkspace = { user: { id: "platform-owner", name: "Platform Owner", email: "superadmin", role: "ADMIN", moduleAccess: [], actorType: "PLATFORM_OWNER", platformSuperAdmin: true, viewContext: null }, organization: null, users: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    const dashboard = { metrics: { totalOrganizations: 2, activeOrganizations: 2, suspendedOrganizations: 0, activeUsers: 7, pendingInvitations: 1, blockedDeals: 1 }, organizations: [], pagination: { page: 1, pages: 1, total: 0 }, recentActions: [] };
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ success: true, data: url.includes("/platform/dashboard") ? dashboard : url.includes("/workspace") ? ownerWorkspace : { actorType: "PLATFORM_OWNER" } }) }));
    render(<App />);
    fireEvent.change(screen.getByLabelText("Platform login ID"), { target: { value: "superadmin" } });
    fireEvent.change(screen.getByLabelText("Platform password"), { target: { value: "ConfiguredOwnerPassword!" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter Platform Control" }));
    expect(await screen.findByRole("heading", { name: "Global organizations" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/super-admin/login", expect.objectContaining({ method: "POST", body: JSON.stringify({ loginId: "superadmin", password: "ConfiguredOwnerPassword!" }) }));
  });
  it("renders a recovery link on unknown routes", () => {
    window.history.replaceState({}, "", "/missing");
    render(<App />);
    expect(
      screen.getByRole("link", { name: "Back to DealOS" }),
    ).toHaveAttribute("href", "/");
  });
});
