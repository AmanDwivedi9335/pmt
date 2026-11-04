"use client";
import { useEffect, useState, useCallback, type FormEvent } from "react";
import { Building2, ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@pmt/ui";
import Workspace from "./workspace";
import { readApiResponse } from "../lib/api-response";
type Me = {
  user: { name: string; email: string };
  csrf: string;
  memberships: any[];
};
function identityLinkToken(kind: "invite" | "reset") {
  return (
    new URLSearchParams(location.hash.slice(1)).get(kind) ??
    new URLSearchParams(location.search).get(kind)
  );
}
export default function Portal() {
  const [me, setMe] = useState<Me | null>(null),
    [org, setOrg] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [mode, setMode] = useState("login"),
    [busy, setBusy] = useState(false);
  const api = useCallback(
    async (path: string, method = "GET", body?: unknown, key?: string) => {
      const r = await fetch(`/api/v1/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "idempotency-key": key } : {}),
          ...(org ? { "x-organization-id": org } : {}),
          ...(me ? { "x-csrf-token": me.csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return readApiResponse(r);
    },
    [org, me],
  );
  const loadMe = useCallback(async () => {
    const r = await fetch("/api/v1/auth/me");
    if (r.ok) {
      const value = await r.json();
      setMe(value);
      setOrg(
        localStorage.getItem("pmt-org") &&
          value.memberships.some(
            (m: any) => m.orgId === localStorage.getItem("pmt-org"),
          )
          ? localStorage.getItem("pmt-org")!
          : value.memberships[0]?.orgId || "",
      );
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void loadMe().catch(() => {
      setError("The API is unavailable. Check that the backend is running.");
      setLoading(false);
    });
    if (identityLinkToken("reset")) setMode("reset-password");
    if (identityLinkToken("invite")) setMode("accept-invitation");
  }, [loadMe]);
  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode === "reset-password")
        fields.token = identityLinkToken("reset") || "";
      if (mode === "accept-invitation")
        fields.token = identityLinkToken("invite") || "";
      await api(`auth/${mode}`, "POST", fields);
      if (mode === "forgot-password") {
        setError("If this email is registered, a reset link has been queued.");
      } else if (mode === "reset-password") {
        history.replaceState({}, "", "/");
        setMode("login");
      } else {
        history.replaceState({}, "", "/");
        setMode("login");
        await loadMe();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!me || mode === "accept-invitation" || mode === "reset-password")
    return (
      <main className="auth">
        <div className="auth-story">
          <div className="brand">
            <span className="brand-mark">
              <Building2 />
            </span>
            fieldwork<span className="brand-dot">.</span>
          </div>
          <span className="eyebrow">PROJECT OPERATIONS, CONNECTED</span>
          <h1>
            From the first
            <br />
            delivery to the
            <br />
            <em>final milestone.</em>
          </h1>
          <p>
            A clear view of your projects, materials and money.
            <br />
            Built for the people who get things done.
          </p>
          <div className="auth-proof">
            <ShieldCheck size={18} /> Organization isolation · Secure sessions ·
            Audited actions
          </div>
          <div className="blueprint" aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
        </div>
        <div className="auth-form">
          <div className="auth-card">
            <span className="eyebrow">YOUR OPERATIONS WORKSPACE</span>
            <h2>
              {mode === "register"
                ? "Start your workspace"
                : mode === "forgot-password"
                  ? "Reset your password"
                  : mode === "reset-password"
                    ? "Choose a new password"
                    : mode === "accept-invitation"
                      ? "Join your team"
                      : "Welcome back"}
            </h2>
            <p className="muted">
              {mode === "register"
                ? "Set up your organization to begin."
                : "Sign in to keep your projects moving."}
            </p>
            {error && (
              <div role="alert" className="notice">
                {error}
              </div>
            )}
            <form onSubmit={authenticate}>
              {["register", "accept-invitation"].includes(mode) && (
                <label>
                  Your name
                  <input
                    name="name"
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </label>
              )}
              {mode === "register" && (
                <label>
                  Organization
                  <input
                    name="organization"
                    required
                    minLength={2}
                    autoComplete="organization"
                  />
                </label>
              )}
              {!["reset-password", "accept-invitation"].includes(mode) && (
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="you@company.com"
                    autoComplete="email"
                  />
                </label>
              )}
              {mode !== "forgot-password" && (
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                  />
                  <small>At least 12 characters.</small>
                </label>
              )}
              <Button disabled={busy || loading} type="submit">
                {busy ? <Loader2 className="spin" size={16} /> : null}
                {mode === "login"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create workspace"
                    : "Continue"}
                <ArrowRight size={16} />
              </Button>
            </form>
            <div className="auth-links">
              <button
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError("");
                }}
              >
                {mode === "register"
                  ? "Already have an account? Sign in"
                  : "Create an organization"}
              </button>
              <button
                onClick={() => {
                  setMode(
                    mode === "forgot-password" ? "login" : "forgot-password",
                  );
                  setError("");
                }}
              >
                {mode === "forgot-password"
                  ? "Back to sign in"
                  : "Forgot password?"}
              </button>
            </div>
          </div>
          <p className="auth-footer">
            Fieldwork / Project Operations Management
          </p>
        </div>
      </main>
    );
  return (
    <Workspace
      me={me}
      org={org}
      setOrg={(value) => {
        setOrg(value);
        localStorage.setItem("pmt-org", value);
      }}
      api={api}
      onLogout={() => {
        void api("auth/logout", "POST")
          .then(() => setMe(null))
          .catch((e) => setError(e.message));
      }}
    />
  );
}
