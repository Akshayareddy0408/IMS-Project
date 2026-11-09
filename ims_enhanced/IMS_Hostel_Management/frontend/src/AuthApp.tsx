
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { DashboardApp } from "./App";
import { api } from "./api";
import { supabase } from "./supabase";
import "./auth.css";

type Role = "Student" | "Maintenance Staff" | "Warden" | "Administrator";
type SignupRole = "Student" | "Maintenance Staff" | "Warden";

function trustedRole(value: unknown): Role | null {
  if (value === "Admin") return "Administrator";
  if (value === "Maintenance") return "Maintenance Staff";
  return value === "Student" || value === "Maintenance Staff" || value === "Warden" || value === "Administrator" ? value : null;
}

export default function AuthApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [signupRole, setSignupRole] = useState<SignupRole>("Student");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [accountError, setAccountError] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      setSession(data.session);
      setLoading(false);
      setAuthReady(true);
    }).catch(() => {
      setMessage("Could not restore your saved session. Please try signing in again.");
      setLoading(false);
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!session) {
      setAccountReady(false);
      setAccountError("");
      return;
    }
    if (session.user.app_metadata?.active === false) {
      setAccountReady(true);
      setAccountError("");
      return;
    }
    const role = trustedRole(session.user.app_metadata?.role);
    if (session.user.app_metadata?.role === "Pending") {
      setAccountReady(true);
      setAccountError("");
      return;
    }
    // A trusted app_metadata role means onboarding already completed. In
    // particular, do not block existing Students on editable user_metadata.
    if (role) {
      setAccountReady(true);
      setAccountError("");
      return;
    }

    let cancelled = false;
    setAccountReady(false);
    setAccountError("");
    if (!session.user.user_metadata?.full_name) {
      setAccountError("This account has no provisioned role. Contact your HostelCare Administrator.");
      setAccountReady(true);
      return;
    }
    void api.registerAccount()
      .then(async (result) => {
        if (cancelled) return;
        setMessage(result.message);
        if (!role) {
          const { error } = await supabase?.auth.refreshSession() ?? {};
          if (error) throw error;
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setAccountError(error instanceof Error ? error.message : "Your account could not be provisioned.");
      })
      .finally(() => { if (!cancelled) setAccountReady(true); });
    return () => { cancelled = true; };
  }, [authReady, session?.user.id, session?.user.app_metadata?.role]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: name,
              room_number: room,
              requested_role: signupRole
            },
            emailRedirectTo: window.location.origin
          }
        });

        if (error) throw error;

        setMessage(
          "Account created. Check your inbox to verify your email, then sign in. Staff and Warden access requires Administrator approval."
        );
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin
        });

        if (error) throw error;

        setMessage("Password reset email sent if this address is registered.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });

        if (error) {
          if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message)) {
            throw new Error("Email or password is incorrect.");
          }
          if (/email not confirmed/i.test(error.message)) {
            throw new Error("Please confirm your email address before signing in.");
          }
          throw error;
        }

        setMessage("Signed in. Checking your account access…");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-page">
        <div className="auth-card">Loading your session...</div>
      </main>
    );
  }

  if (session && !accountReady) {
    return <main className="auth-page"><div className="auth-card">{accountError || "Setting up your HostelCare account…"}</div></main>;
  }

  if (session && accountError) {
    return <main className="auth-page"><section className="auth-card"><div className="auth-brand">HOSTELCARE <span>IMS PORTAL</span></div><h1>Account access needs attention</h1><p>{accountError}</p><button className="auth-submit" onClick={() => { void supabase?.auth.signOut(); }}>Sign out</button></section></main>;
  }

  if (session && session.user.app_metadata?.active === false) {
    return <main className="auth-page"><section className="auth-card"><div className="auth-brand">HOSTELCARE <span>IMS PORTAL</span></div><h1>Account inactive</h1><p>An Administrator has deactivated this account. Contact your hostel office for help.</p><button className="auth-submit" onClick={() => { void supabase?.auth.signOut(); }}>Sign out</button></section></main>;
  }

  if (session && trustedRole(session.user.app_metadata?.role) === null && session.user.app_metadata?.role === "Pending") {
    return <PendingAccess onSignOut={() => { void supabase?.auth.signOut(); }} />;
  }

  if (session && trustedRole(session.user.app_metadata?.role)) {
    return (
      <>
        <div className="auth-top">
          <span>Signed in as {session.user.email}</span>
          <button onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </div>
        <DashboardApp
          initialRole={trustedRole(session.user.app_metadata?.role)!}
          email={session.user.email ?? ""}
          fullName={String(session.user.user_metadata?.full_name ?? "")}
          roomNumber={String(session.user.user_metadata?.room_number ?? "")}
          onSignOut={() => { void supabase?.auth.signOut(); }}
        />
      </>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          HOSTELCARE <span>IMS PORTAL</span>
        </div>

        <h1>
          {mode === "signup"
            ? "Create your account"
            : mode === "reset"
              ? "Reset password"
              : "Welcome back"}
        </h1>

        <p>Email verification and secure sign-in powered by Supabase Auth.</p>

        {!supabase && (
          <div className="auth-message">
            Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env before using login.
          </div>
        )}

        <form onSubmit={submit}>
          {mode === "signup" && (
            <>
              <label>
                Full name
                <input
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label>
                Account type
                <select
                  value={signupRole}
                  onChange={(e) =>
                    setSignupRole(e.target.value as SignupRole)
                  }
                >
                  <option value="Student">Student</option>
                  <option value="Maintenance Staff">Maintenance Staff</option>
                  <option value="Warden">Warden</option>
                </select>
              </label>

              {signupRole === "Student" && (
                <label>
                  Room number
                  <input
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    required
                    placeholder="e.g. A-204"
                  />
                </label>
              )}
            </>
          )}

          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {mode !== "reset" && (
            <label>
              Password
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <button className="auth-submit" disabled={!supabase || busy}>
            {busy
              ? "Please wait..."
              : mode === "signup"
                ? "Create account"
                : mode === "reset"
                  ? "Send reset link"
                  : "Sign in"}
          </button>
        </form>

        {message && <div className="auth-message">{message}</div>}

        <div className="auth-links">
          <button
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setMessage("");
            }}
          >
            {mode === "login"
              ? "Create an account"
              : "Back to sign in"}
          </button>

          <button
            onClick={() => {
              setMode("reset");
              setMessage("");
            }}
          >
            Forgot password?
          </button>
        </div>

        <small>
          Staff and Warden accounts require Administrator approval.
          Administrator accounts are created through a trusted setup process.
        </small>
      </section>
    </main>
  );
}

function PendingAccess({ onSignOut }: { onSignOut: () => void }) {
  const [status, setStatus] = useState("Loading application status…");
  const [rejected, setRejected] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api.accountStatus().then((result) => {
      if (!live) return;
      setRejected(result.status === "Rejected");
      setStatus(result.status === "Rejected"
        ? `Your ${result.requested_role ?? "access"} application was rejected.${result.rejection_reason ? ` Reason: ${result.rejection_reason}` : " Contact your Administrator for details."}`
        : `Your ${result.requested_role ?? "privileged access"} application is ${String(result.status).toLowerCase()}. Privileged features will be available after approval. Sign out and back in after your application is approved.`);
    }).catch((error: unknown) => { if (live) setStatus(error instanceof Error ? error.message : "Could not load your application status."); });
    return () => { live = false; };
  }, []);
  async function resubmit() {
    setBusy(true);
    try { const result = await api.registerAccount(); setStatus(result.message); setRejected(false); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not resubmit your application."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand">HOSTELCARE <span>IMS PORTAL</span></div><h1>{rejected ? "Application decision" : "Application pending"}</h1><p>{status}</p>{rejected && <button className="auth-submit" disabled={busy} onClick={() => void resubmit()}>{busy ? "Submitting…" : "Resubmit application"}</button>}<button className="auth-submit" onClick={onSignOut}>Sign out</button></section></main>;
}
