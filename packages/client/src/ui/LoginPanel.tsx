import { useState } from "react";
import { LogIn, UserPlus, Wallet, User, ShieldAlert } from "lucide-react";

import { Panel } from "@/ui/components/Panel";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";
import { Separator } from "@/ui/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/ui/components/ui/tabs";
import { useUIStore } from "@/ui/store";

/**
 * LoginPanel — the auth gate shown before the game connects.
 *
 * Follows the CharacterCreate/Intro overlay pattern: the Phaser `LoginScene`
 * owns the authentication side effects + token persistence and pushes a plain
 * snapshot in; this component reads it and drives the flow exclusively through
 * `actions.*`. It offers email+password sign-in/registration, "Connect Wallet",
 * and "Continue as Guest". The panel owns only its own local form state.
 *
 * Every new account (guest, register, wallet) must accept a short alpha ToS /
 * Privacy notice before proceeding. Returning logins (email+password sign-in)
 * skip this since the account already accepted.
 */

type Mode = "login" | "register";

export function LoginPanel() {
  const open = useUIStore((s) => s.loginOpen);
  const { error, sending, walletAvailable, inviteCodeRequired } = useUIStore((s) => s.login);
  const actions = useUIStore((s) => s.loginActions);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [tosChecked, setTosChecked] = useState(false);

  if (!open) return null;

  // Returning logins (email+password sign-in) don't need ToS — only new account creation does.
  const needsTos = mode === "register";

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    !sending &&
    (!inviteCodeRequired || inviteCode.trim().length > 0) &&
    (!needsTos || tosChecked);

  const submit = (): void => {
    if (!canSubmit) return;
    if (mode === "login") actions?.loginEmail(email.trim(), password);
    else actions?.registerEmail(email.trim(), password, inviteCode.trim() || undefined);
  };

  const canGuest = !sending && (!inviteCodeRequired || inviteCode.trim().length > 0) && tosChecked;
  const canWallet =
    !sending &&
    walletAvailable &&
    (!inviteCodeRequired || inviteCode.trim().length > 0) &&
    tosChecked;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <Panel
        title="Welcome to CryptoMaple"
        className="w-[420px] max-w-[calc(100vw-2rem)] select-text"
      >
        {/* ── Invite code (when alpha gating is enabled) ── */}
        {inviteCodeRequired && (
          <div className="mb-3 grid gap-1.5">
            <Label htmlFor="login-invite">Invite Code</Label>
            <Input
              id="login-invite"
              type="text"
              autoComplete="off"
              value={inviteCode}
              placeholder="CM-XXXXXXXX"
              aria-invalid={!!error}
              disabled={sending}
              onChange={(e) => setInviteCode(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              An invite code is required to join the alpha.
            </p>
          </div>
        )}

        {/* ── Alpha ToS / Privacy notice ── */}
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs font-medium text-amber-300">Closed Alpha — Not a final product</p>
          </div>
          <ul className="mb-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground/80">Wipes possible.</strong> Your characters,
              items, and mesos may be reset between alpha waves.
            </li>
            <li>
              <strong className="text-foreground/80">Test currency only.</strong> No item or
              currency in the alpha has real-money value.
            </li>
            <li>
              <strong className="text-foreground/80">Data stored.</strong> We store your email (if
              provided), wallet address (if linked), gameplay analytics, and session data to run the
              alpha and fix bugs.
            </li>
            <li>
              <strong className="text-foreground/80">Code of conduct.</strong> Be respectful. No
              exploits, harassment, or real-money trading during alpha. Violations may result in a
              ban.
            </li>
          </ul>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={tosChecked}
              onChange={(e) => setTosChecked(e.target.checked)}
              disabled={sending}
            />
            <span className="text-xs text-muted-foreground">
              I have read and accept the alpha Terms of Service and Privacy Policy.
            </span>
          </label>
        </div>

        {/* ── Primary CTA: Guest play ── */}
        <div className="mb-4">
          <Button
            type="button"
            size="lg"
            className="w-full text-base"
            disabled={!canGuest}
            onClick={() => actions?.guest(inviteCode.trim() || undefined)}
          >
            <User /> Play as Guest
          </Button>
          <p className="mt-1.5 text-center text-xs text-muted-foreground">
            No account needed — jump right in
          </p>
        </div>

        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or sign in</span>
          <Separator className="flex-1" />
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign In</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
        </Tabs>

        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              placeholder="you@example.com"
              aria-invalid={!!error}
              disabled={sending}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              placeholder="••••••••"
              aria-invalid={!!error}
              disabled={sending}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <p className={`min-h-4 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error ||
              (mode === "login"
                ? "Sign in to continue your adventure."
                : "Create an account to save your progress.")}
          </p>

          <Button type="submit" disabled={!canSubmit}>
            {mode === "login" ? (
              <>
                <LogIn /> Sign In
              </>
            ) : (
              <>
                <UserPlus /> Create Account
              </>
            )}
          </Button>
        </form>

        {/* ── Wallet sign-in ── */}
        <Button
          type="button"
          variant="outline"
          className="mt-4 w-full"
          disabled={!canWallet}
          title={walletAvailable ? undefined : "No browser wallet detected"}
          onClick={() => actions?.connectWallet(inviteCode.trim() || undefined)}
        >
          <Wallet /> Connect Wallet
        </Button>
      </Panel>
    </div>
  );
}
