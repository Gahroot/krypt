import Phaser from "phaser";

import {
  getToken,
  refreshSession,
  loginWithPassword,
  registerWithPassword,
  connectWallet,
  guestSignIn,
  isWalletAvailable,
  logout,
} from "../backend";
import { uiStore } from "../ui/store";

// Background fill behind the React overlay (matches the UI palette).
const BG = 0x0c1019;

// ═══════════════════════════════════════════════════════════════════════════════
// LoginScene — thin controller for the React login/auth overlay.
//
// The auth UI lives in `ui/LoginPanel.tsx`. This scene owns the authentication
// side effects (REST calls to the `/auth/*` endpoints + token persistence in
// backend.ts) and registers the imperative actions React calls. On success it
// stores the server-issued token and advances to character creation.
//
// A returning player who already holds a still-valid token is resumed silently
// (no flash of the login form); first-load players (no token) see the form.
// ═══════════════════════════════════════════════════════════════════════════════

export class LoginScene extends Phaser.Scene {
  private sending = false;

  constructor() {
    super("login");
  }

  create(): void {
    this.sending = false;
    this.cameras.main.setBackgroundColor(BG);

    this.registerActions();
    this.publish("");

    // Hide the overlay panel when this scene shuts down (hand-off to next scene).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      uiStore.getState().setLoginOpen(false);
    });

    // Returning player with a stored token → try a silent resume before showing
    // the form; first-load players (no token) get the login form immediately.
    if (getToken()) {
      void this.trySilentResume();
    } else {
      uiStore.getState().setLoginOpen(true);
    }
  }

  /** Refresh a stored token; on success skip the form, else clear it and show login. */
  private async trySilentResume(): Promise<void> {
    const session = await refreshSession();
    if (session) {
      this.proceed();
      return;
    }
    // Token was invalid/expired/revoked — wipe it and show the login form.
    logout();
    uiStore.getState().setLoginOpen(true);
  }

  /** Push the current status into the bridge store. */
  private publish(error: string): void {
    uiStore.getState().setLogin({
      error,
      sending: this.sending,
      walletAvailable: isWalletAvailable(),
    });
  }

  /** Wire the imperative actions the React panel drives the flow through. */
  private registerActions(): void {
    uiStore.getState().setLoginActions({
      loginEmail: (email, password) => void this.run(() => loginWithPassword(email, password)),
      registerEmail: (email, password) =>
        void this.run(() => registerWithPassword(email, password)),
      connectWallet: () => void this.run(() => connectWallet()),
      guest: () => void this.run(() => guestSignIn()),
    });
  }

  /** Run an auth call: gate re-entry, surface errors, advance on success. */
  private async run(fn: () => Promise<unknown>): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    this.publish("");
    try {
      await fn();
      this.proceed();
    } catch (err) {
      this.sending = false;
      this.publish(err instanceof Error ? err.message : "Authentication failed.");
    }
  }

  /** Authenticated — close the panel and hand off to the character roster. */
  private proceed(): void {
    this.sending = false;
    uiStore.getState().setLoginOpen(false);
    this.scene.start("character_select");
  }
}
