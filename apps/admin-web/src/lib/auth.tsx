import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type AuthUser } from "./api";

interface AuthCtx {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Purge legacy V2 browser-accessible JWTs on first V3 page load.
    try {
      localStorage.removeItem("salon_admin_token");
      localStorage.removeItem("salon_admin_user");
    } catch { /* Storage may be blocked; cookie session remains functional. */ }
    let active = true;
    api.get<{ user: AuthUser }>("/auth/me")
      .then(({ user }) => { if (active) setUser(user); })
      .catch(() => { if (active) setUser(null); })
      .finally(() => { if (active) setReady(true); });
    const onUnauthorized = () => setUser(null);
    window.addEventListener("salon:unauthorized", onUnauthorized);
    return () => { active = false; window.removeEventListener("salon:unauthorized", onUnauthorized); };
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      ready,
      login: async (email: string, password: string) => {
        const res = await api.post<{ user: AuthUser }>("/auth/login", { email, password });
        setUser(res.user);
        setReady(true);
      },
      logout: async () => {
        // Do not report a successful logout unless the server clears the HttpOnly cookie.
        await api.post("/auth/logout");
        setUser(null);
        window.location.hash = "#/login";
      },
    }),
    [user, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
