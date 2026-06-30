import { useState } from "react";
import { LogIn, UserPlus, Wallet, User } from "lucide-react";

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
 */

type Mode = "login" | "register";

export function LoginPanel() {
  const open = useUIStore((s) => s.loginOpen);
  const { error, sending, walletAvailable } = useUIStore((s) => s.login);
  const actions = useUIStore((s) => s.loginActions);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!open) return null;

  const canSubmit = email.trim().length > 0 && password.length > 0 && !sending;

  const submit = (): void => {
    if (!canSubmit) return;
    if (mode === "login") actions?.loginEmail(email.trim(), password);
    else actions?.registerEmail(email.trim(), password);
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
      <Panel
        title="Welcome to CryptoMaple"
        className="w-[400px] max-w-[calc(100vw-2rem)] select-text"
      >
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

        {/* ── Alternative sign-in methods ── */}
        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">or</span>
          <Separator className="flex-1" />
        </div>

        <div className="grid gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={sending || !walletAvailable}
            title={walletAvailable ? undefined : "No browser wallet detected"}
            onClick={() => actions?.connectWallet()}
          >
            <Wallet /> Connect Wallet
          </Button>
          <Button type="button" variant="ghost" disabled={sending} onClick={() => actions?.guest()}>
            <User /> Continue as Guest
          </Button>
        </div>
      </Panel>
    </div>
  );
}
