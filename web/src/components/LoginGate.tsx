import { useCallback, useEffect, useState } from "react";

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((data) => {
        setNeedsAuth(data.auth_required);
        if (!data.auth_required) setAuthenticated(true);
      })
      .catch(() => setAuthenticated(true))
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.authenticated) {
        setAuthenticated(true);
      } else {
        setError("Invalid password");
      }
    } catch {
      setError("Connection failed");
    }
  }, [password]);

  if (checking) {
    return (
      <div className="min-h-screen bg-sigil-bg flex items-center justify-center">
        <div className="text-sigil-muted">Loading...</div>
      </div>
    );
  }

  if (needsAuth && !authenticated) {
    return (
      <div className="min-h-screen bg-sigil-bg flex items-center justify-center">
        <div className="bg-sigil-surface border border-sigil-border rounded-xl p-8 w-[400px]">
          <div className="text-center mb-6">
            <span className="text-sigil-accent text-3xl font-black tracking-tighter">
              SIGIL
            </span>
            <span className="text-sigil-muted text-xs tracking-widest uppercase ml-2">
              v2
            </span>
          </div>

          <div className="space-y-4">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="w-full bg-sigil-bg border border-sigil-border rounded-lg px-4 py-3 text-sm
                         text-sigil-text focus:border-sigil-accent outline-none"
              autoFocus
            />
            {error && <p className="text-sigil-danger text-xs">{error}</p>}
            <button
              onClick={handleLogin}
              className="w-full py-3 rounded-lg bg-sigil-accent text-sigil-bg font-semibold
                         hover:bg-sigil-accent/90 transition-all"
            >
              Enter
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
