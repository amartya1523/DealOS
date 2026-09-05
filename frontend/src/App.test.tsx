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
  Element.prototype.scrollIntoView = vi.fn();
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
      screen.getByRole("heading", { name: /Every deal\. In motion\./ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore Approve" }));
    expect(screen.getByRole("heading", { name: /Find your green light/ })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Make your next move" }),
    ).toHaveAttribute("href", "/sign-up");
  });
  it("shows a failed login without losing entered email", async () => {
    window.history.replaceState({}, "", "/sign-in");
    render(<App />);
    fireEvent.change(screen.getByLabelText("Work email"), {
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
    expect(screen.getByLabelText("Work email")).toHaveValue("test@example.com");
  });
  it("submits signup to the API and shows activation requirement", async () => {
    window.history.replaceState({}, "", "/sign-up");
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: url.endsWith("/signup"),
        json: async () =>
          url.endsWith("/signup")
            ? { success: true, data: { status: "PENDING" } }
            : { success: false },
      }),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Test Person" },
    });
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "TestPassword12!" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Request workspace access" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "pending administrator activation",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/signup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
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
  it("renders the live Platform Super Admin control plane for protected members", async () => {
    window.history.replaceState({}, "", "/app");
    const workspace = { user: { id: "platform-owner", realUserId: "platform-owner", actorType: "PLATFORM_OWNER", name: "Platform Owner", email: "platform-owner", role: "ADMIN", platformSuperAdmin: true, organization: null, viewContext: null }, quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    const dashboard = { metrics: { totalOrganizations: 2, activeOrganizations: 2, suspendedOrganizations: 0, activeUsers: 5, pendingInvitations: 1, blockedDeals: 1 }, organizations: [], pagination: { page: 1, pages: 1, total: 0 }, recentActions: [] };
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ success: true, data: url.includes("/platform/dashboard") ? dashboard : url.includes("/workspace") ? workspace : workspace.user }) }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Global organizations" })).toBeInTheDocument();
    expect(screen.getByText("Platform Control")).toBeInTheDocument();
    expect(await screen.findByText("Approval bottlenecks")).toBeInTheDocument();
  });
  it("uses a dedicated Platform Owner login route and endpoint", async () => {
    window.history.replaceState({}, "", "/login/super-admin");
    const workspace = { user: { id: "platform-owner", realUserId: "platform-owner", actorType: "PLATFORM_OWNER", name: "Platform Owner", email: "platform-owner", role: "ADMIN", platformSuperAdmin: true, organization: null, viewContext: null }, quotes: [], products: [], policies: [], warehouses: [], subscriptions: [], invoices: [], alerts: [], audits: [] };
    const dashboard = { metrics: { totalOrganizations: 2, activeOrganizations: 2, suspendedOrganizations: 0, activeUsers: 5, pendingInvitations: 0, blockedDeals: 0 }, organizations: [], pagination: { page: 1, pages: 1, total: 0 }, recentActions: [] };
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => ({ success: true, data: url.includes("/platform/dashboard") ? dashboard : url.includes("/workspace") ? workspace : { actorType: "PLATFORM_OWNER" } }) }));
    render(<App />);
    expect(screen.getByRole("heading", { name: "Platform Owner sign in" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Platform login ID"), { target: { value: "platform-owner" } });
    fireEvent.change(screen.getByLabelText("Platform password"), { target: { value: "ConfiguredOwnerPassword!" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter Platform Control" }));
    expect(await screen.findByRole("heading", { name: "Global organizations" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/super-admin/login", expect.objectContaining({ method: "POST", body: JSON.stringify({ loginId: "platform-owner", password: "ConfiguredOwnerPassword!" }) }));
  });
  it("renders a recovery link on unknown routes", () => {
    window.history.replaceState({}, "", "/missing");
    render(<App />);
    expect(
      screen.getByRole("link", { name: "Back to DealOS" }),
    ).toHaveAttribute("href", "/");
  });
});
