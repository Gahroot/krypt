import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * Login slice — bridge state for the auth gate (LoginPanel.tsx).
 *
 * Shown before the game connects. Mirrors the character-create flow: the Phaser
 * {@link LoginScene} owns the authentication side effects (REST calls to the
 * `/auth/*` endpoints, token persistence) and registers the imperative
 * {@link LoginActions}; React reads a plain {@link LoginSnapshot} and drives the
 * flow purely through those actions. On success the scene stores the
 * server-issued token and advances to character creation.
 */

/** Plain snapshot of the login screen state pushed from Phaser. */
export interface LoginSnapshot {
  /** Validation / auth error message ("" when none). */
  error: string;
  /** True while an auth request is in flight (disables every button). */
  sending: boolean;
  /** True when a browser wallet is injected, so "Connect Wallet" is offered. */
  walletAvailable: boolean;
  /** Whether the server requires an invite code for new registrations. */
  inviteCodeRequired: boolean;
  /** True once the user has checked the ToS acceptance checkbox. */
  tosAccepted: boolean;
}

/** Imperative actions the scene wires up so React can drive sign-in. */
export interface LoginActions {
  /** Sign in with an existing email + password. */
  loginEmail(email: string, password: string): void;
  /** Register a brand-new account from an email + password. */
  registerEmail(email: string, password: string, inviteCode?: string): void;
  /** Connect a browser wallet and sign in by signature. */
  connectWallet(inviteCode?: string): void;
  /** Continue without credentials — mints a fresh guest account. */
  guest(inviteCode?: string): void;
}

const DEFAULT_SNAPSHOT: LoginSnapshot = {
  error: "",
  sending: false,
  walletAvailable: false,
  inviteCodeRequired: false,
  tosAccepted: false,
};

export interface LoginSlice {
  loginOpen: boolean;
  login: LoginSnapshot;
  loginActions: LoginActions | null;

  setLoginOpen: (open: boolean) => void;
  setLogin: (snapshot: LoginSnapshot) => void;
  setLoginActions: (actions: LoginActions | null) => void;
}

export const createLoginSlice: StateCreator<UIState, [], [], LoginSlice> = (set) => ({
  loginOpen: false,
  login: DEFAULT_SNAPSHOT,
  loginActions: null,

  setLoginOpen: (open) => set({ loginOpen: open }),
  setLogin: (snapshot) => set({ login: snapshot }),
  setLoginActions: (actions) => set({ loginActions: actions }),
});
