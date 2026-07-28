import React, { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, LogIn } from "lucide-react";

export default function LoginPage() {
  const { refetch } = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("login.failed"));
      } else {
        await refetch();
      }
    } catch {
      setError(t("login.connectionError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="AIO Voice Connect" className="h-20 w-auto object-contain" />
          <p className="text-sm text-muted-foreground">{t("login.subtitle")}</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">{t("login.cardTitle")}</CardTitle>
            <CardDescription>{t("login.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">{t("login.username")}</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t("login.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2 border border-destructive/20">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                {loading ? t("login.submitting") : t("login.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
