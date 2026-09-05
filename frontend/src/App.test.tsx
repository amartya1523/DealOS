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
  delete window.Razorpay;
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
    expect(screen.queryByText(/Choose a demo role/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Made with/i)).not.toBeInTheDocument();
  });
  it("opens the public English chat assistant from sign in", () => {
    window.history.replaceState({}, "", "/sign-in");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open DealOS Assistant" }));
    expect(screen.getByText("DealOS Guide")).toBeInTheDocument();
    expect(screen.getByText(/Powered by Groq · English/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about DealOS…")).toBeInTheDocument();
  });
  it("offers customer email and Google sign-in and opens all email-linked documents", async () => {
    window.history.replaceState({}, "", "/customer");
    const workspace = {
      user:{id:'customer-user',name:'Buyer User',email:'buyer@example.com',role:'CUSTOMER',customerId:'customer-1',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null},
      organization:{id:'org-1',name:'Acme'},users:[],customers:[],products:[],policies:[],warehouses:[],subscriptions:[],alerts:[],audits:[],
      quotes:[{id:'quote-1',number:'Q-EMAIL-1',customer:'Buyer Company',customerTier:'Gold',stage:'APPROVED',version:2,revisionId:'revision-2',revisionNumber:2,termsHash:'terms-2',orderDiscount:27,total:1180,margin:0,riskScore:0,updatedAt:'2026-09-05T00:00:00.000Z',capabilities:{comment:true,accept:true,propose:true},lines:[],approvals:[],negotiation:[],invoices:[]}],
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
    expect(screen.getByText('Revision 2 · frozen customer copy')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Accept quotation'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:/Invoices/}));
    expect((await screen.findAllByText('INV-EMAIL-1')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/customer/login',expect.objectContaining({method:'POST',body:JSON.stringify({email:'buyer@example.com',password:'CustomerPass12!'})}));
  });
  it("creates an Admin customer with one-time temporary portal credentials", async () => {
    window.history.replaceState({}, "", "/app");
    const workspace = { user:{id:'admin',name:'Admin User',email:'admin@example.com',role:'ADMIN',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null}, organization:{id:'org',name:'Acme'}, users:[], customers:[], quotes:[], products:[], policies:[], warehouses:[], subscriptions:[], invoices:[], alerts:[], audits:[] };
    fetchMock.mockResolvedValue({ok:true,json:async()=>({success:true,data:workspace})});
    render(<App/>);
    expect(await screen.findByRole("heading", {name:"Sales dashboard"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Customers"}));
    fireEvent.click(screen.getByRole("button", {name:"Add Customer"}));
    expect(screen.getByLabelText("Tier")).not.toHaveTextContent("Enterprise");
    fireEvent.change(screen.getByLabelText("Company Name *"), {target:{value:"Portal Customer"}});
    fireEvent.change(screen.getByLabelText(/^Email ID/), {target:{value:"portal@example.com"}});
    fireEvent.change(screen.getByPlaceholderText("e.g. 9876543210"), {target:{value:"9876543210"}});
    const generated = screen.getByLabelText(/^Temporary password/) as HTMLInputElement;
    expect(generated.value).toMatch(/^Deal-.+!$/);
    expect(generated.value.length).toBeGreaterThanOrEqual(12);
    fireEvent.click(screen.getAllByRole("button", {name:/Add Customer/}).at(-1)!);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/customers',expect.objectContaining({
      method:'POST',
      body:expect.stringContaining('"email":"portal@example.com"'),
    })));
    const requestCall=fetchMock.mock.calls.find(([url,options])=>url==='/api/v1/customers'&&options?.method==='POST');
    expect(JSON.parse(String(requestCall?.[1]?.body))).toMatchObject({email:'portal@example.com',temporaryPassword:generated.value});
    expect(await screen.findByRole('heading',{name:'Copy these credentials now'})).toBeInTheDocument();
    expect(screen.getByText('/customer/sign-in')).toBeInTheDocument();
  });
  it("lets an admin edit and safely delete a customer from customer details", async () => {
    window.history.replaceState({}, "", "/app?screen=customer&record=customer-1");
    const customer = {id:'customer-1',name:'Portal Customer',tier:'Gold',currency:'INR',customerType:'Business / Company',region:'India',contactPerson:'Asha Rao',email:'portal@example.com',phone:'9876543210',countryCode:'+91',gstin:null,billingAddress:'1 Market Road',shippingAddress:'1 Market Road',paymentTerms:7,active:true,createdAt:'2026-09-05T00:00:00.000Z',updatedAt:'2026-09-05T00:00:00.000Z',quotes:[],invoices:[],users:[],invitations:[]};
    const workspace = { user:{id:'admin',name:'Admin User',email:'admin@example.com',role:'ADMIN',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null}, organization:{id:'org',name:'Acme'}, users:[], customers:[customer], quotes:[], products:[], policies:[], warehouses:[], subscriptions:[], invoices:[], alerts:[], audits:[] };
    fetchMock.mockResolvedValue({ok:true,json:async()=>({success:true,data:workspace})});
    render(<App/>);
    expect(await screen.findByRole('heading',{name:'Portal Customer'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Edit customer'}));
    expect(screen.getByRole('heading',{name:'Edit Customer'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Company Name *'),{target:{value:'Updated Customer'}});
    fireEvent.change(screen.getByLabelText('Contact Person'),{target:{value:'Asha Sharma'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Changes'}));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/customers/customer-1',expect.objectContaining({method:'PATCH',body:expect.stringContaining('"name":"Updated Customer"')})));
    fireEvent.click(screen.getByRole('button',{name:'Delete customer'}));
    expect(screen.getByText(/Existing quotations, invoices, and audit records will be preserved/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button',{name:'Delete customer'}).at(-1)!);
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/customers/customer-1',expect.objectContaining({method:'PATCH',body:JSON.stringify({active:false})})));
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
              ? { success:true, data:{user:{id:'a',name:'Test Person',email:'test@example.com',role:'ADMIN',moduleAccess:[]},organization:{id:'o',name:'Acme'},users:[],customers:[],quotes:[],products:[],policies:[],warehouses:[],subscriptions:[],invoices:[],alerts:[],audits:[]} }
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
    expect(screen.getByRole("button", { name: "Add Invoice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View reports" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Invoice" }));
    expect(screen.getByRole("heading", { name: "Issue invoice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("heading", { name: "Issue invoice" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(document.querySelector(".app-shell")).not.toHaveClass("sidebar-collapsed");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");
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
  it("searches across modules and surfaces workspace notifications in English", async () => {
    window.history.replaceState({}, "", "/app");
    const workspace = {
      user:{id:'admin',name:'Admin User',email:'admin@example.com',role:'ADMIN',moduleAccess:[],actorType:'USER',platformSuperAdmin:false,viewContext:null},
      organization:{id:'org',name:'Acme'},users:[],customers:[],products:[],policies:[],warehouses:[],subscriptions:[],audits:[],
      quotes:[],
      invoices:[{id:'invoice-1',number:'INV-2026-1042',customer:'Northstar Labs',amount:42000,paidAmount:0,state:'UNPAID',dueAt:'2026-09-20T00:00:00.000Z',lines:[],payments:[]}],
      alerts:[{id:'alert-1',kind:'PAYMENT',title:'Invoice payment overdue',detail:'Northstar Labs has an outstanding balance.',severity:'HIGH',resourceId:'invoice-1',resolved:false,nudged:false,createdAt:'2026-09-06T08:00:00.000Z'}],
    };
    fetchMock.mockResolvedValue({ok:true,json:async()=>({success:true,data:workspace})});
    render(<App/>);
    const search=await screen.findByRole('textbox',{name:'Search across workspace'});
    fireEvent.change(search,{target:{value:'1042'}});
    const results=screen.getByRole('listbox',{name:'Global search results'});
    expect(within(results).getByText('Invoice')).toBeInTheDocument();
    expect(within(results).getByText('INV-2026-1042')).toBeInTheDocument();
    fireEvent.click(within(results).getByText('INV-2026-1042'));
    expect(screen.getByRole('heading',{name:'Invoice detail'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Notifications \(1 unread\)/}));
    expect(screen.getByText('Updates from every module')).toBeInTheDocument();
    expect(screen.getByText('Invoice payment overdue')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Mark all as read'})).toBeInTheDocument();
  });
  it("filters the approval queue by pending, returned, and approved state", async () => {
    window.history.replaceState({}, "", "/app");
    const approvalCase = (state:string) => ({id:`case-${state}`,version:1,state,route:'MANAGER',revisionId:`revision-${state}`,policyId:'policy-1',createdAt:'2026-09-05T00:00:00.000Z',completedAt:null,quotation:{id:`quote-${state}`,number:`Q-${state}`,customer:`${state} Customer`,customerTier:'Gold',total:'100',currency:'INR',owner:{id:'rep',name:'Rep'},team:{id:'team',name:'Sales'}},submittedBy:{id:'rep',name:'Rep'},currentStep:null,managerStep:null,risk:{components:{},flags:[],reasons:[],policy:{}},lines:[],steps:[],audit:[]});
    const workspace = { user:{id:'manager',name:'Manager User',email:'manager@example.com',role:'MANAGER',moduleAccess:['dashboard','approvals'],actorType:'USER',platformSuperAdmin:false,viewContext:null}, organization:{id:'org',name:'Acme'}, users:[], quotes:[], products:[], policies:[], warehouses:[], subscriptions:[], invoices:[], alerts:[], audits:[] };
    fetchMock.mockImplementation((url:string) => Promise.resolve({ok:true,json:async()=>({success:true,data:url.endsWith('/workspace')?workspace:url.includes('/approvals?state=')?{items:[approvalCase(new URL(url,'http://local').searchParams.get('state')!)]}:{}})}));
    render(<App/>);
    expect(await screen.findByRole("heading", {name:"Sales dashboard"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name:"Approvals"}));
    expect(await screen.findByText("Q-PENDING")).toBeInTheDocument();
    expect(screen.queryByText("Q-RETURNED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Pending"})).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", {name:"Returned"}));
    expect(await screen.findByText("Q-RETURNED")).toBeInTheDocument();
    expect(screen.queryByText("Q-PENDING")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Returned"})).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", {name:"Approved"}));
    expect(await screen.findByText("Q-APPROVED")).toBeInTheDocument();
    expect(screen.queryByText("Q-RETURNED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", {name:"Approved"})).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Q-REJECTED")).not.toBeInTheDocument();
  });
  it("edits and publishes every discount ceiling with an audit reason", async () => {
    window.history.replaceState({}, "", "/app");
    const policy = { id: "p1", tier: "Gold", maxDiscount: 15, hardwareLimit: 15, servicesLimit: 10, subscriptionLimit: 10, financeThreshold: 5, aggregateDiscountLimit: 20, minimumMarginPercent: 12, version: 2, publishedAt: "2026-09-05T08:00:00.000Z" };
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
        body: JSON.stringify({ maxDiscount: 14, hardwareLimit: 14, servicesLimit: 9, subscriptionLimit: 8, financeThreshold: 4, aggregateDiscountLimit: 20, minimumMarginPercent: 12, reason: "Margin protection review." }),
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
  it("shows the exact business role and blocks navigation to unassigned modules", async () => {
    window.history.replaceState({}, "", "/app?screen=invoices&record=invoice-1");
    const workspace = { user: { id: "rep", name: "Aarav Mehta", email: "aarav@acme.test", role: "REP", moduleAccess: ["dashboard", "quotations"], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], customers: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockImplementation((url:string)=>Promise.resolve({ ok: true, json: async () => ({ success: true, data: url.includes('/leads')?{items:[]}:workspace }) }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Sales representative")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Portal leads" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quotations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invoices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Products" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "User access" })).not.toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("screen")).toBe("dashboard"));
    const portalLeads=screen.getByRole("button", { name: "Portal leads" });
    const quotations=screen.getByRole("button", { name: "Quotations" });
    fireEvent.click(portalLeads);
    expect(await screen.findByRole("heading", { name: "Portal Leads", level: 1 })).toBeInTheDocument();
    expect(portalLeads).toHaveClass("active");
    expect(quotations).not.toHaveClass("active");
  });
  it("renders a safe empty workspace when an administrator assigned no modules", async () => {
    window.history.replaceState({}, "", "/app?screen=reports");
    const workspace = { user: { id: "rep", name: "Aarav Mehta", email: "aarav@acme.test", role: "REP", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], customers: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "No modules assigned" })).toBeInTheDocument();
    expect(screen.getByText("Sales representative")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reports" })).not.toBeInTheDocument();
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
  it("creates a service without inventory fields and normalizes GST-inclusive pricing", async () => {
    window.history.replaceState({}, "", "/app?screen=products");
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], customers: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Product" }));
    expect(screen.queryByRole("checkbox", { name: /Service item/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Services" } });

    expect(screen.queryByLabelText("Opening stock *")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Vendor / brand")).not.toHaveAttribute("list");
    expect(screen.getByLabelText("Vendor / brand")).toHaveAttribute("placeholder", "Enter brand manually");
    expect(screen.getByText("Recurring billing · no inventory")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Item name *"), { target: { value: "Implementation consulting" } });
    fireEvent.change(screen.getByLabelText("Price treatment"), { target: { value: "included" } });
    fireEvent.change(screen.getByLabelText("Selling price"), { target: { value: "1180" } });
    fireEvent.change(screen.getByLabelText("Purchase cost"), { target: { value: "600" } });
    expect(screen.getByLabelText("Base price (before GST)")).toHaveValue("1000.00");
    fireEvent.click(screen.getByRole("button", { name: "Create Service" }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([url, options]) => url === "/api/v1/products" && options?.method === "POST");
      expect(request).toBeTruthy();
      const payload = JSON.parse(String(request?.[1]?.body));
      expect(payload).toMatchObject({ name: "Implementation consulting", category: "Services", unit: "Hour", price: 1000, cost: 600, taxRate: 18, recurring: true, cadence: "Monthly", active: true });
      expect(payload.sku).toMatch(/^SER-IMPLEMENTATION-[A-Z0-9]{4}$/);
      expect(payload).not.toHaveProperty("openingStock");
      expect(payload).not.toHaveProperty("minAlertLevel");
      expect(payload).not.toHaveProperty("maxCapacity");
      expect(payload).not.toHaveProperty("storeVisible");
      expect(payload).not.toHaveProperty("featured");
    });
  });

  it("does not expose a free-form invoice builder outside a confirmed order", async () => {
    window.history.replaceState({}, "", "/app?screen=invoices");
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], customers: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);

    expect((await screen.findAllByRole("heading", { name: "Invoices" }))[0]).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All invoices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpaid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paid" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(screen.getByRole("dialog", { name: "Issue invoice" })).toBeInTheDocument();
    expect(screen.getByText("No orders waiting for an invoice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create New Product" })).not.toBeInTheDocument();
  });

  it("issues an invoice from an eligible confirmed order snapshot", async () => {
    window.history.replaceState({}, "", "/app?screen=invoices");
    const customer = { id: "c1", name: "Northstar Retail", contactPerson: "Asha Rao", email: "asha@northstar.test", phone: "9876543210", countryCode: "+91", gstin: "29ABCDE1234F1Z5", customerType: "Business", tier: "Gold", active: true, paymentTerms: 15, billingAddress: "Bengaluru", shippingAddress: "Bengaluru", createdAt: "2026-09-06T00:00:00.000Z" };
    const quote = { id:"q1",number:"Q-1001",customer:"Northstar Retail",customerTier:"Gold",stage:"CONFIRMED",version:3,orderDiscount:0,total:1180,margin:300,riskScore:0,updatedAt:"2026-09-06T00:00:00.000Z",order:{id:"o1",number:"SO-1001",state:"CONFIRMED"},lines:[{id:"l1",productId:"p1",product:{id:"p1",name:"Office Router",sku:"RTR-100",category:"Hardware",description:"Managed office router",price:1000,cost:700,taxRate:18,recurring:false,cadence:null},quantity:1,unitPrice:1000,discount:0,allowedDiscount:5,net:1000}],approvals:[],negotiation:[],invoices:[] };
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], customers: [customer], quotes: [quote], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);

    expect((await screen.findAllByRole("heading", { name: "Invoices" }))[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    const dialog=screen.getByRole("dialog", { name: "Issue invoice" });
    expect(within(dialog).getByText("Q-1001")).toBeInTheDocument();
    expect(within(dialog).getByText("SO-1001 · Northstar Retail")).toBeInTheDocument();
    const dueAt=(within(dialog).getByLabelText("Due date") as HTMLInputElement).value;
    fireEvent.click(within(dialog).getByRole("button", { name: "Issue invoice" }));
    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('/api/v1/orders/o1/invoices',expect.objectContaining({method:'POST',body:JSON.stringify({kind:'ONE_TIME',dueAt})})));
  });

  it("starts inventory numbers blank and supports an inline custom category", async () => {
    window.history.replaceState({}, "", "/app?screen=products");
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], customers: [], quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, data: workspace }) });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Product" }));
    const openingStock=screen.getByLabelText("Opening stock *");
    expect(openingStock).toHaveValue(null);
    fireEvent.change(openingStock, { target: { value: "100" } });
    expect(openingStock).toHaveValue(100);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Other" } });
    expect(screen.getByLabelText("Custom category")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit")).toHaveValue("Unit");
    fireEvent.change(screen.getByLabelText("Custom category"), { target: { value: "Security appliances" } });
    fireEvent.change(screen.getByLabelText("Item name *"), { target: { value: "Edge gateway" } });
    expect((screen.getByLabelText("SKU / HSN code") as HTMLInputElement).value).toMatch(/^SEC-EDGE-GATEWAY-[A-Z0-9]{4}$/);
  });

  it("shows inventory status and edits a catalog item in the shared product modal", async () => {
    window.history.replaceState({}, "", "/app?screen=products");
    const warehouse={name:"Main Warehouse"};
    const inStock={id:"p1",name:"Desk",sku:"DESK-1",category:"Hardware",description:"Standing desk",unit:"Piece",brand:"Acme",price:1000,cost:600,taxRate:18,recurring:false,cadence:null,active:true,storeVisible:true,featured:false,stocks:[{onHand:8,reserved:3,minAlertLevel:2,maxCapacity:20,warehouse}]};
    const outOfStock={...inStock,id:"p2",name:"Chair",sku:"CHAIR-1",stocks:[{onHand:3,reserved:3,minAlertLevel:2,maxCapacity:20,warehouse}]};
    const service={...inStock,id:"p3",name:"Installation",sku:"INSTALL-1",category:"Services",unit:"Hour",recurring:true,cadence:"Monthly",stocks:[]};
    const workspace={user:{id:"a",name:"Admin",email:"admin@acme.test",role:"ADMIN",moduleAccess:[],actorType:"USER",platformSuperAdmin:false,viewContext:null},organization:{id:"o",name:"Acme"},users:[],customers:[],quotes:[],products:[inStock,outOfStock,service],policies:[],warehouses:[],subscriptions:[],invoices:[],alerts:[],audits:[]};
    fetchMock.mockResolvedValue({ok:true,json:async()=>({success:true,data:workspace})});
    render(<App/>);

    expect(await screen.findByText("In Stock")).toBeInTheDocument();
    expect(screen.getByText("5 available")).toBeInTheDocument();
    expect(screen.getByText("Out Of Stock")).toBeInTheDocument();
    expect(screen.getByText("Not Tracked")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button",{name:"Edit Desk"}));
    expect(screen.getByRole("dialog",{name:"Edit Desk"})).toBeInTheDocument();
    expect(screen.getByLabelText("Item name *")).toHaveValue("Desk");
    expect(screen.getByLabelText("SKU / HSN code")).toHaveValue("DESK-1");
    expect(screen.getByLabelText("Vendor / brand")).toHaveValue("Acme");
    expect(screen.getByText("Stock quantities are controlled through warehouse receipts and fulfillment, so editing catalog details cannot overwrite live inventory.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Selling price"),{target:{value:"1200"}});
    fireEvent.click(screen.getByRole("button",{name:"Save changes"}));

    await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith("/api/v1/products/p1",expect.objectContaining({
      method:"PATCH",
      body:expect.stringContaining('"price":1200'),
    })));
    expect(window.location.search).toBe("?screen=products");
  });

  it("renders live fulfillment stock and previews a warehouse split before reservation", async () => {
    window.history.replaceState({}, "", "/app");
    const product = { id: "p1", name: "Laptop Pro 14", sku: "LP14", category: "Hardware", description: "Laptop", unit: "unit", price: 1200, cost: 800, taxRate: 18, recurring: false, active: true, stocks: [] };
    const quote = { id: "q1", number: "Q-1042", customer: "Acme Corp", customerTier: "Gold", stage: "CONFIRMED", version: 1, orderDiscount: 0, total: 1200, margin: 400, riskScore: 0, updatedAt: "2026-09-05T00:00:00.000Z", order: { id: "o1", number: "SO-1042", state: "CONFIRMED" }, lines: [{ id: "l1", productId: "p1", quantity: 6, unitPrice: 1200, unitCost: 800, discount: 0, allowedDiscount: 15, product }], approvals: [], negotiation: [], invoices: [] };
    const warehouses = [
      { id: "w1", name: "Main Warehouse", priority: 1, shippingCost: 45, active: true, stocks: [{ onHand: 4, reserved: 0, available: 4, product }] },
      { id: "w2", name: "East Depot", priority: 2, shippingCost: 28, active: true, stocks: [{ onHand: 8, reserved: 1, available: 7, product }] },
    ];
    const workspace = { user: { id: "a", name: "Admin", email: "admin@acme.test", role: "ADMIN", moduleAccess: [], actorType: "USER", platformSuperAdmin: false, viewContext: null }, organization: { id: "o", name: "Acme" }, users: [], quotes: [quote], products: [product], policies: [], warehouses, subscriptions: [], invoices: [], alerts: [], audits: [] };
    const preview = { state: "SPLIT_PENDING", split: { split: [{ orderLineId: "ol1", productId: "p1", warehouseId: "w1", warehouseName: "Main Warehouse", quantity: 4 }, { orderLineId: "ol1", productId: "p1", warehouseId: "w2", warehouseName: "East Depot", quantity: 2 }], backorders: [] }, items:[{orderLineId:"ol1",productId:"p1",productName:"Laptop Pro 14",orderedQuantity:6,reservedQuantity:6,fulfilledQuantity:6,backorderedQuantity:0}], estimatedCost: 73, shipmentCount: 2, stockFingerprint:"a".repeat(64), preview: true };
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ success: true, data: url.endsWith("/fulfillment/o1/preview") ? preview : workspace }) }));
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
    fireEvent.click(screen.getByRole("button", { name: "Record Receipt & Check Backorder" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/fulfillment/o1/receive", expect.objectContaining({ method: "POST", body: JSON.stringify({ warehouseId: "w1", productId: "p1", quantity: 3, reason: "PO-1042 received at dock" }) })));
    fireEvent.click(screen.getByRole("row", { name: /SO-1042.*Acme Corp.*Split Pending/ }));
    expect(await screen.findByRole("heading", { name: "Fulfillment Detail: SO-1042 (Acme Corp)" })).toBeInTheDocument();
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
    let paid=false;
    let checkoutOptions:Record<string,any>|undefined;
    window.Razorpay=class {
      constructor(options:Record<string,any>){checkoutOptions=options;}
      on(){/* The success path is driven by the checkout handler below. */}
      open(){void checkoutOptions?.handler({razorpay_payment_id:'pay_test_1',razorpay_order_id:'order_test_1',razorpay_signature:'a'.repeat(64)});}
    } as any;
    fetchMock.mockImplementation((url:string,options?:RequestInit)=>{
      if(url.endsWith('/payments/orders')&&options?.method==='POST')return Promise.resolve({ok:true,json:async()=>({success:true,data:{paymentRecordId:'00000000-0000-0000-0000-000000000002',orderId:'order_test_1',amount:252000,amountRupees:'2520.00',currency:'INR',keyId:'rzp_test_public',testMode:true,invoice:{id:'invoice',number:'INV-1042',customer:'Acme Corp'},prefill:{email:'customer@dealos.demo'}}})});
      if(url.endsWith('/payments/verify')&&options?.method==='POST'){paid=true;return Promise.resolve({ok:true,json:async()=>({success:true,data:{payment:{status:'SUCCESS'}}})});}
      const current=paid?{...portalWorkspace,invoices:[{...portalWorkspace.invoices[0],paidAmount:'2520',state:'PAID',payments:[{id:'payment',amount:'2520',reference:'PORTAL-DEMO',paidAt:'2026-09-06T00:00:00.000Z'}]}]}:portalWorkspace;
      return Promise.resolve({ok:true,json:async()=>({success:true,data:current})});
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Review your quotations" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Invoices/ }));
    expect(screen.getByRole("heading", { name: "INV-1042" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/v1/invoices/invoice/pdf");
    expect(screen.getByRole("button", { name: "Request due-date change" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Pay now · ₹2,520" }));
    expect(await screen.findByRole("heading", { name: "Successfully paid" })).toBeInTheDocument();
    expect(screen.getByText("INV-1042 is now marked Paid in both the customer portal and the invoice workspace.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/payments/orders',expect.objectContaining({method:'POST',body:JSON.stringify({invoiceId:'invoice'})}));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/payments/verify',expect.objectContaining({method:'POST',body:JSON.stringify({paymentRecordId:'00000000-0000-0000-0000-000000000002',razorpayOrderId:'order_test_1',razorpayPaymentId:'pay_test_1',razorpaySignature:'a'.repeat(64)})}));
    expect(checkoutOptions).toMatchObject({key:'rzp_test_public',amount:252000,currency:'INR',order_id:'order_test_1'});
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Paid" })).toBeDisabled();
    expect(screen.getByText("This invoice is fully paid and synchronized with the business account.")).toBeInTheDocument();
    expect(window.localStorage.getItem('dealos.invoice.updated')).toBeTruthy();
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
