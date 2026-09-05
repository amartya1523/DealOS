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
  it("renders a recovery link on unknown routes", () => {
    window.history.replaceState({}, "", "/missing");
    render(<App />);
    expect(
      screen.getByRole("link", { name: "Back to DealOS" }),
    ).toHaveAttribute("href", "/");
  });
});
