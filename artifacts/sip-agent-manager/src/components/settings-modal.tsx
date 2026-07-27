import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { CheckCircle2, Globe, Loader2, User, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { TimezoneSelect } from "@/components/ui/timezone-select";

interface DomainResult {
  ok: boolean;
  sslOk?: boolean;
  steps?: { step: string; success: boolean; error?: string }[];
  error?: string;
  manual?: string[];
  manualSsl?: string[];
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user, refetch } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Account tab
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [language, setLanguage] = useState<"en" | "fr">(user?.language ?? "en");
  const [timezone, setTimezone] = useState(user?.timezone ?? "UTC");
  const [accountLoading, setAccountLoading] = useState(false);

  // Domain tab
  const [domain, setDomain] = useState("");
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainResult, setDomainResult] = useState<DomainResult | null>(null);

  useEffect(() => {
    if (user) {
      setLanguage(user.language);
      setTimezone(user.timezone);
    }
  }, [user]);

  const handleAccountSave = async () => {
    if (password && password !== repeatPassword) {
      toast({ variant: "destructive", title: t("settings.passwordMismatch") });
      return;
    }
    if (password && password.length < 8) {
      toast({ variant: "destructive", title: t("settings.passwordTooShort") });
      return;
    }
    setAccountLoading(true);
    try {
      const body: Record<string, string> = { language, timezone };
      if (password) body.password = password;
      const res = await fetch("/api/settings/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ variant: "destructive", title: d.error ?? t("settings.saveFailed") });
      } else {
        setPassword("");
        setRepeatPassword("");
        await refetch();
        toast({ title: t("settings.settingsSaved") });
      }
    } catch {
      toast({ variant: "destructive", title: t("settings.connectionError") });
    } finally {
      setAccountLoading(false);
    }
  };

  const handleDomainValidate = async () => {
    if (!domain.trim()) return;
    setDomainLoading(true);
    setDomainResult(null);
    try {
      const res = await fetch("/api/setup/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json();
      setDomainResult(data);
      if (data.ok) await refetch();
    } catch {
      setDomainResult({ ok: false, error: t("settings.connectionError") });
    } finally {
      setDomainLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="account">
          <TabsList className="w-full">
            <TabsTrigger value="account" className="flex-1 gap-2"><User className="h-4 w-4" /> {t("settings.account")}</TabsTrigger>
            <TabsTrigger value="domain" className="flex-1 gap-2"><Globe className="h-4 w-4" /> {t("settings.domain")}</TabsTrigger>
          </TabsList>

          {/* ── Account Tab ── */}
          <TabsContent value="account" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <Label>{t("settings.newPassword")} <span className="text-muted-foreground text-xs">{t("settings.newPasswordHint")}</span></Label>
              <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("settings.repeatPassword")}</Label>
              <PasswordInput value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} placeholder="••••••••" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("setup.language")}</Label>
                <div className="flex gap-2">
                  {(["en", "fr"] as const).map(l => (
                    <button key={l} type="button"
                      onClick={() => setLanguage(l)}
                      className={cn("flex-1 flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                        language === l ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted")}
                    >
                      <img
                        src={l === "en" ? "https://flagcdn.com/20x15/gb.png" : "https://flagcdn.com/20x15/fr.png"}
                        srcSet={l === "en" ? "https://flagcdn.com/40x30/gb.png 2x" : "https://flagcdn.com/40x30/fr.png 2x"}
                        width="20" height="15"
                        alt={l === "en" ? "UK" : "FR"}
                        className="rounded-sm"
                      />
                      {l === "en" ? "EN" : "FR"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("setup.timezone")}</Label>
                <TimezoneSelect value={timezone} onChange={setTimezone} />
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button onClick={handleAccountSave} disabled={accountLoading} className="gap-2">
                {accountLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {accountLoading ? t("common.saving") : t("settings.saveChanges")}
              </Button>
            </div>
          </TabsContent>

          {/* ── Domain Tab ── */}
          <TabsContent value="domain" className="space-y-4 pt-4">
            {user?.domainConfigured && user.domain ? (
              <div className="flex items-center gap-3 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{user.domain}</p>
                  <Badge variant="outline" className="text-green-600 border-green-400 text-xs mt-1">{t("settings.domainConnected")}</Badge>
                </div>
              </div>
            ) : (
              <div className="rounded-md bg-muted/50 border border-dashed p-3 text-sm text-muted-foreground">
                {t("settings.noDomain")}
              </div>
            )}

            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
              <p className="font-medium">{t("settings.domainInstTitle")}</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>{t("settings.domainStep1")}</li>
                <li>{t("settings.domainStep2")}</li>
                <li>{t("settings.domainStep3")}</li>
              </ol>
            </div>

            <div className="space-y-1.5">
              <Label>{t("settings.domainLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  value={domain}
                  onChange={e => setDomain(e.target.value)}
                  placeholder={user?.domain ?? "sip.mycompany.com"}
                  disabled={domainLoading}
                />
                <Button onClick={handleDomainValidate} disabled={!domain.trim() || domainLoading} className="gap-2 shrink-0">
                  {domainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {domainLoading ? t("settings.validating") : t("settings.validate")}
                </Button>
              </div>
            </div>

            {domainResult && (
              <div className={cn("rounded-md border p-3 space-y-2", domainResult.ok ? "border-green-300 bg-green-50 dark:bg-green-950/30" : "border-red-300 bg-red-50 dark:bg-red-950/30")}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {domainResult.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                  {domainResult.ok
                    ? (domainResult.sslOk ? t("settings.domainConfiguredHttps") : t("settings.domainConfigured"))
                    : domainResult.error}
                </div>
                {domainResult.steps && (
                  <ul className="space-y-0.5 text-xs font-mono">
                    {domainResult.steps.map((s, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        {s.success ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                        {s.step}
                      </li>
                    ))}
                  </ul>
                )}
                {(domainResult.manualSsl ?? domainResult.manual)?.map((cmd, i) => (
                  <code key={i} className="block text-xs bg-black/10 dark:bg-white/10 px-2 py-1 rounded">{cmd}</code>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
