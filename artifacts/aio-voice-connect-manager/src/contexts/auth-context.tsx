import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface AdminUser {
  id: number;
  username: string;
  language: "en" | "fr";
  timezone: string;
  domain: string | null;
  domainConfigured: boolean;
}

interface AuthState {
  isLoading: boolean;
  setupComplete: boolean;
  user: AdminUser | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      const data = await res.json();
      setSetupComplete(data.setupComplete ?? false);
      setUser(data.user ?? null);
    } catch {
      setSetupComplete(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return (
    <AuthContext.Provider value={{ isLoading, setupComplete, user, refetch, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
