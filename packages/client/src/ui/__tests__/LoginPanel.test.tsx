import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginPanel } from "@/ui/LoginPanel";
import { uiStore, type LoginActions } from "@/ui/store";

/**
 * Smoke / render tests for the auth-gate overlay panel.
 *
 * These drive the SAME bridge store the live LoginScene does: push a snapshot in
 * via `setLogin`, then assert React renders it and routes user intent back out
 * through the `loginActions.*` registry.
 */

function mockActions(): LoginActions {
  return {
    loginEmail: vi.fn(),
    registerEmail: vi.fn(),
    connectWallet: vi.fn(),
    guest: vi.fn(),
  };
}

let actions: LoginActions;

beforeEach(() => {
  actions = mockActions();
  uiStore.getState().setLogin({
    error: "",
    sending: false,
    walletAvailable: true,
    inviteCodeRequired: false,
    tosAccepted: false,
  });
  uiStore.getState().setLoginActions(actions);
  uiStore.getState().setLoginOpen(true);
});

afterEach(() => {
  uiStore.getState().setLoginOpen(false);
});

describe("LoginPanel", () => {
  it("renders nothing when closed", () => {
    uiStore.getState().setLoginOpen(false);
    const { container } = render(<LoginPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the auth gate with both alternative sign-in methods", () => {
    render(<LoginPanel />);
    expect(screen.getByRole("heading", { name: /welcome to cryptomaple/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play as guest/i })).toBeInTheDocument();
  });

  it("shows the alpha ToS notice", () => {
    render(<LoginPanel />);
    expect(screen.getByText(/closed alpha/i)).toBeInTheDocument();
    expect(screen.getByText(/wipes possible/i)).toBeInTheDocument();
    expect(screen.getByText(/test currency only/i)).toBeInTheDocument();
    expect(screen.getByText(/accept the alpha terms/i)).toBeInTheDocument();
  });

  it("routes email + password to actions.loginEmail in sign-in mode (no ToS needed)", async () => {
    const user = userEvent.setup();
    render(<LoginPanel />);

    await user.type(screen.getByLabelText(/email/i), "hero@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(actions.loginEmail).toHaveBeenCalledWith("hero@example.com", "hunter2");
    expect(actions.registerEmail).not.toHaveBeenCalled();
  });

  it("requires ToS checkbox for registration", async () => {
    const user = userEvent.setup();
    render(<LoginPanel />);

    await user.click(screen.getByRole("tab", { name: /register/i }));
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "s3cret!");

    // Create Account should be disabled without ToS acceptance
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();

    // Check the ToS checkbox
    await user.click(screen.getByLabelText(/accept the alpha terms/i));

    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(actions.registerEmail).toHaveBeenCalledWith("new@example.com", "s3cret!", undefined);
  });

  it("requires ToS checkbox for guest play", async () => {
    const user = userEvent.setup();
    render(<LoginPanel />);

    // Play as Guest should be disabled without ToS acceptance
    expect(screen.getByRole("button", { name: /play as guest/i })).toBeDisabled();

    await user.click(screen.getByLabelText(/accept the alpha terms/i));
    await user.click(screen.getByRole("button", { name: /play as guest/i }));
    expect(actions.guest).toHaveBeenCalled();
  });

  it("disables Connect Wallet when no wallet is available", () => {
    uiStore.getState().setLogin({
      error: "",
      sending: false,
      walletAvailable: false,
      inviteCodeRequired: false,
      tosAccepted: false,
    });
    render(<LoginPanel />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeDisabled();
  });

  it("requires ToS checkbox for wallet connect", async () => {
    const user = userEvent.setup();
    render(<LoginPanel />);

    // Wallet should be disabled without ToS
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeDisabled();

    await user.click(screen.getByLabelText(/accept the alpha terms/i));
    expect(screen.getByRole("button", { name: /connect wallet/i })).not.toBeDisabled();
  });

  it("surfaces an auth error from the snapshot", () => {
    uiStore.getState().setLogin({
      error: "invalid email or password",
      sending: false,
      walletAvailable: true,
      inviteCodeRequired: false,
      tosAccepted: false,
    });
    render(<LoginPanel />);
    expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
  });

  it("shows the invite code field when the gate is enabled", () => {
    uiStore.getState().setLogin({
      error: "",
      sending: false,
      walletAvailable: true,
      inviteCodeRequired: true,
      tosAccepted: false,
    });
    render(<LoginPanel />);

    // Invite code field should be visible in login mode (for guest + register).
    expect(screen.getByLabelText(/invite code/i)).toBeInTheDocument();
    expect(screen.getByText(/invite code is required/i)).toBeInTheDocument();
  });

  it("passes invite code to actions.registerEmail", async () => {
    uiStore.getState().setLogin({
      error: "",
      sending: false,
      walletAvailable: true,
      inviteCodeRequired: true,
      tosAccepted: false,
    });
    const user = userEvent.setup();
    render(<LoginPanel />);

    await user.click(screen.getByRole("tab", { name: /register/i }));
    await user.type(screen.getByLabelText(/invite code/i), "CM-TESTCODE");
    await user.type(screen.getByLabelText(/email/i), "new@example.com");
    await user.type(screen.getByLabelText(/password/i), "s3cret!");
    await user.click(screen.getByLabelText(/accept the alpha terms/i));
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(actions.registerEmail).toHaveBeenCalledWith("new@example.com", "s3cret!", "CM-TESTCODE");
  });

  it("passes invite code to actions.guest", async () => {
    uiStore.getState().setLogin({
      error: "",
      sending: false,
      walletAvailable: true,
      inviteCodeRequired: true,
      tosAccepted: false,
    });
    const user = userEvent.setup();
    render(<LoginPanel />);

    await user.type(screen.getByLabelText(/invite code/i), "CM-GUESTCODE");
    await user.click(screen.getByLabelText(/accept the alpha terms/i));
    await user.click(screen.getByRole("button", { name: /play as guest/i }));

    expect(actions.guest).toHaveBeenCalledWith("CM-GUESTCODE");
  });
});
