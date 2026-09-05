import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  window.localStorage.clear();
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
  it("offers customer email and Google sign-in and opens all email-linked documents", async () => {
    window.history.replaceState({}, "", "/customer");
    const workspace = {
      user:{id:'customer-user',name:'Buyer User',email:'buyer@example.com',role:'CUSTOMER',customerId:'customer-1',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null},
      organization:{id:'org-1',name:'Acme'},users:[],customers:[],products:[],policies:[],warehouses:[],subscriptions:[],alerts:[],audits:[],
      quotes:[{id:'quote-1',number:'Q-EMAIL-1',customer:'Buyer Company',customerTier:'Gold',stage:'APPROVED',version:1,orderDiscount:0,total:1180,margin:0,riskScore:0,updatedAt:'2026-09-05T00:00:00.000Z',lines:[],approvals:[],negotiation:[],invoices:[]}],
      invoices:[{id:'invoice-1',number:'INV-EMAIL-1',customer:'Buyer Company',amount:1180,paidAmount:0,state:'UNPAID',dueAt:'2026-09-20T00:00:00.000Z',lines:[],payments:[]}],
    };
    let authenticated = false;
    fetchMock.mockImplementation((url:string, options?:RequestInit) => Promise.resolve({
      ok: url.endsWith('/auth/google/config') || (url.endsWith('/auth/customer/login') && options?.method==='POST') || (authenticated && (url.endsWith('/auth/me') || url.endsWith('/workspace'))),
      json: async()=>{
        if(url.endsWith('/auth/google/config'))return {success:true,data:{enabled:false,clientId:null}};
        if(url.endsWith('/auth/customer/login')){authenticated=true;return {success:true,data:{role:'CUSTOMER',destination:'/customer'}};}
        if(authenticated&&url.endsWith('/auth/me'))return {success:true,data:workspace.user};
        if(authenticated&&url.endsWith('/workspace'))return {success:true,data:workspace};
        return {success:false,error:{message:'Please sign in'}};
      },
    }));
    render(<App/>);
    expect(await screen.findByRole('button',{name:'Sign in with Email ID'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Continue with Google Sign-In ID'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Customer Email ID'),{target:{value:'buyer@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'),{target:{value:'CustomerPass12!'}});
    fireEvent.click(screen.getByRole('button',{name:'Sign in with Email ID'}));
    expect((await screen.findAllByText('Q-EMAIL-1')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:/Invoices/}));
    expect((await screen.findAllByText('INV-EMAIL-1')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/customer/login',expect.objectContaining({method:'POST',body:JSON.stringify({email:'buyer@example.com',password:'CustomerPass12!'})}));
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
    expect(screen.queryByText(/^Live$/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(document.querySelector(".app-shell")).toHaveClass("sidebar-collapsed");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("dealos.sidebar.collapsed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Quotations" }));
    expect(screen.getByRole("heading", { name: "Quotation pipeline" })).toBeInTheDocument();
    const requestsBeforeBrandClick = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("link", { name: "DealOS home" }));
    expect(screen.getByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app");
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeBrandClick);
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
  it("edits and publishes every discount ceiling with an audit reason", async () => {
    window.history.replaceState({}, "", "/app");
    const policy = { id: "p1", tier: "Gold", maxDiscount: 15, hardwareLimit: 15, servicesLimit: 10, subscriptionLimit: 10, financeThreshold: 5, version: 2, publishedAt: "2026-09-05T08:00:00.000Z" };
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], quotes: [], products: [], policies: [policy], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockImplementation((url: string, options?: RequestInit) => Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: options?.method === "PATCH" ? { ...policy, version: 3 } : workspace }),
    }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rules" }));
    fireEvent.change(screen.getByLabelText("Gold overall discount ceiling"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Gold Hardware discount ceiling"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Gold Services discount ceiling"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Gold Subscriptions discount ceiling"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Gold Finance escalation threshold"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Gold policy change reason"), { target: { value: "Margin protection review." } });
    fireEvent.click(screen.getByRole("button", { name: "Save & publish" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/policies/p1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ maxDiscount: 14, hardwareLimit: 14, servicesLimit: 9, subscriptionLimit: 8, financeThreshold: 4, reason: "Margin protection review." }),
      }),
    ));
  });
  it("keeps subscriptions hidden from non-admin users even with legacy module access", async () => {
    window.history.replaceState({}, "", "/app");
    const workspace = { user: { id: "m", name: "Manager", email: "manager@acme.test", role: "MANAGER", moduleAccess: ["dashboard", "subscriptions"], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subscriptions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "User access" })).not.toBeInTheDocument();
  });
  it("lets an organization admin open read-only details for an organization member", async () => {
    window.history.replaceState({}, "", "/app");
    const member = { id: "m1", name: "Jordan Davis", email: "jordan@acme.test", loginId: "DL-1234ABCD", role: "REP", status: "ACTIVE", membershipStatus: "ACTIVE", accessRole: "ORGANIZATION_MEMBER", moduleAccess: ["dashboard", "quotations"], createdAt: "2026-09-01T08:00:00.000Z", joinedAt: "2026-09-02T08:00:00.000Z" };
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [member], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => ({ success: true, data: url.endsWith(`/admin/users/${member.id}`) ? member : workspace }),
    }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "User access" }));
    fireEvent.click(screen.getByRole("button", { name: "View details for Jordan Davis" }));
    const detailHeading = await screen.findByRole("heading", { name: "Organization member details" });
    const detail = detailHeading.closest('.modal') as HTMLElement;
    expect(within(detail).getByText("jordan@acme.test")).toBeInTheDocument();
    expect(within(detail).getByText("Organization Member")).toBeInTheDocument();
    expect(within(detail).getByText("Quotations")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/users/m1", expect.objectContaining({ credentials: "include" }));
    expect(within(detail).queryByText(/password/i)).not.toBeInTheDocument();
  });
  it("renders the admin subscription list from the supplied design", async () => {
    window.history.replaceState({}, "", "/app");
    const subscription = { id: "s1", customer: "Acme Corp", productName: "Care Plan", cadence: "Monthly", amount: 1200, nextBillAt: "2026-10-01T00:00:00.000Z", state: "ACTIVE", schedule: ["2026-10-01T00:00:00.000Z"] };
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [subscription], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Subscriptions" }));
    expect(screen.getByRole("heading", { name: "Subscriptions (List)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 Active" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 Paused" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 Cancelled" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New Plan" }));
    fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Care Plan 2yr" } });
    fireEvent.change(screen.getByLabelText("Plan SKU"), { target: { value: "care-2y" } });
    fireEvent.change(screen.getByLabelText("Recurring price"), { target: { value: "2400" } });
    fireEvent.change(screen.getByLabelText("Recurring cost"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Two-year recurring care plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/products", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Care Plan 2yr", sku: "CARE-2Y", category: "Subscriptions", description: "Two-year recurring care plan", unit: "plan", price: 2400, cost: 900, taxRate: 18, recurring: true, cadence: "Monthly" }),
    })));
    fireEvent.click(screen.getByRole("row", { name: /Acme Corp Care Plan/ }));
    expect(screen.getByRole("heading", { name: "Billing detail" })).toBeInTheDocument();
  });
  it("renders live fulfillment stock and previews a warehouse split before reservation", async () => {
    window.history.replaceState({}, "", "/app");
    const product = { id: "p1", name: "Laptop Pro 14", sku: "LP14", category: "Hardware", description: "Laptop", unit: "unit", price: 1200, cost: 800, taxRate: 18, recurring: false, active: true, stocks: [] };
    const quote = { id: "q1", number: "Q-1042", customer: "Acme Corp", customerTier: "Gold", stage: "CONFIRMED", version: 1, orderDiscount: 0, total: 1200, margin: 400, riskScore: 0, updatedAt: "2026-09-05T00:00:00.000Z", order: { id: "o1", number: "SO-1042" }, lines: [{ id: "l1", productId: "p1", quantity: 6, unitPrice: 1200, unitCost: 800, discount: 0, allowedDiscount: 15, product }], approvals: [], negotiation: [], invoices: [] };
    const warehouses = [
      { id: "w1", name: "Main Warehouse", priority: 1, shippingCost: 45, active: true, stocks: [{ onHand: 4, reserved: 0, available: 4, product }] },
      { id: "w2", name: "East Depot", priority: 2, shippingCost: 28, active: true, stocks: [{ onHand: 8, reserved: 1, available: 7, product }] },
    ];
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], quotes: [quote], products: [product], policies: [], warehouses, subscriptions: [], invoices: [], alerts: [], audits: [] };
    const preview = { state: "SPLIT_PENDING", split: { split: [{ productId: "p1", warehouseId: "w1", warehouseName: "Main Warehouse", quantity: 4 }, { productId: "p1", warehouseId: "w2", warehouseName: "East Depot", quantity: 2 }], backorders: [] }, estimatedCost: 73, shipmentCount: 2, preview: true };
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ success: true, data: url.endsWith("/fulfillment/q1/preview") ? preview : workspace }) }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fulfillment" }));
    expect(screen.getByRole("heading", { name: "Fulfillment and Stock (List)" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Main Warehouse.*Laptop Pro 14.*4.*0.*4/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Warehouse settings" }));
    const warehouseSettings = screen.getByRole("heading", { name: "Warehouse settings" }).closest(".modal") as HTMLElement;
    expect(within(warehouseSettings).getByText("1 stocked product · Priority 1")).toBeInTheDocument();
    expect(within(warehouseSettings).getByLabelText("Base shipping cost")).toHaveValue(45);
    expect(within(warehouseSettings).getByRole("checkbox", { name: /Active warehouse/ })).toBeChecked();
    fireEvent.click(within(warehouseSettings).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Record stock receipt" }));
    fireEvent.change(screen.getByLabelText("Quantity received"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Receipt reason"), { target: { value: "PO-1042 received at dock" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Receipt" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/warehouses/w1/restock", expect.objectContaining({ method: "POST", body: JSON.stringify({ productId: "p1", quantity: 3, reason: "PO-1042 received at dock" }) })));
    fireEvent.click(screen.getByRole("row", { name: /Q-1042.*Acme Corp.*Split Pending/ }));
    expect(await screen.findByRole("heading", { name: "Fulfillment Detail: Q-1042 (Acme Corp)" })).toBeInTheDocument();
    expect(await screen.findByRole("row", { name: /Main Warehouse.*4 units.*1.*₹45/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Suggested Split" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Manual Override" }));
    expect(screen.getByRole("heading", { name: "Manual warehouse override" })).toBeInTheDocument();
    expect(screen.getByLabelText("Laptop Pro 14 from East Depot")).toHaveAttribute("max", "7");
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
