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
import { AlertTriangle, CheckCircle2, Download, Globe, Loader2, RefreshCw, Terminal, Trash2, User, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { TimezoneSelect } from "@/components/ui/timezone-select";

interface DomainStep {
  step: string;
  success: boolean;
  error?: string;
}

interface DomainResult {
  ok: boolean;
  sslOk?: boolean;
  domain?: string;
  steps?: DomainStep[];
  error?: string;
  needsManual?: boolean;
  manualCommands?: string[];
  cleanupCommands?: string[];
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
  const [resetResult, setResetResult] = useState<{ cleanupCommands?: string[]; message?: string } | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const domainLocked = !!(user?.domainConfigured && user?.domain);

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
    if (!domain.trim() || domainLocked) return;
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

  const handleDomainReset = async () => {
    setResetLoading(true);
    setResetResult(null);
    setDomainResult(null);
    try {
      const res = await fetch("/api/setup/domain", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      await refetch();
      if (data.cleanupCommands?.length) {
        setResetResult({ cleanupCommands: data.cleanupCommands, message: data.message });
      } else {
        toast({ title: data.message ?? "Domain reset." });
      }
    } catch {
      toast({ variant: "destructive", title: t("settings.connectionError") });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="account" className="flex flex-col min-h-0 flex-1">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="account" className="flex-1 gap-2"><User className="h-4 w-4" /> {t("settings.account")}</TabsTrigger>
            <TabsTrigger value="domain" className="flex-1 gap-2"><Globe className="h-4 w-4" /> {t("settings.domain")}</TabsTrigger>
          </TabsList>

          {/* ── Account Tab ── */}
          <TabsContent value="account" className="space-y-4 pt-4 overflow-y-auto">
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
                      className={cn("flex-1 cursor-pointer flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-all",
                        language === l ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-input bg-background hover:bg-muted hover:shadow-sm")}
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
          <TabsContent value="domain" className="space-y-4 pt-4 overflow-y-auto">
            {/* Current domain status */}
            {domainLocked ? (
              <div className="flex items-center gap-3 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user!.domain}</p>
                  <Badge variant="outline" className="text-green-600 border-green-400 text-xs mt-1">
                    {t("settings.domainConnected")}
                  </Badge>
                </div>
                <button
                  onClick={handleDomainReset}
                  disabled={resetLoading}
                  title="Reset domain"
                  className="shrink-0 p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              <div className="rounded-md bg-muted/50 border border-dashed p-3 text-sm text-muted-foreground">
                {t("settings.noDomain")}
              </div>
            )}

            {/* Reset result — cleanup commands to run on server */}
            {resetResult && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {resetResult.message ?? "Run these cleanup commands on the server:"}
                </div>
                {resetResult.cleanupCommands && (
                  <ManualCommands
                    title=""
                    commands={resetResult.cleanupCommands}
                  />
                )}
              </div>
            )}

            {/* Instructions (only shown when not yet configured) */}
            {!domainLocked && (
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
                <p className="font-medium">{t("settings.domainInstTitle")}</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>{t("settings.domainStep1")}</li>
                  <li>{t("settings.domainStep2")}</li>
                  <li>{t("settings.domainStep3")}</li>
                </ol>
              </div>
            )}

            {/* Input (locked once domain is configured) */}
            {!domainLocked && (
              <div className="space-y-1.5">
                <Label>{t("settings.domainLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleDomainValidate()}
                    placeholder={user?.domain ?? "sip.mycompany.com"}
                    disabled={domainLoading}
                  />
                  <Button onClick={handleDomainValidate} disabled={!domain.trim() || domainLoading} className="gap-2 shrink-0">
                    {domainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {domainLoading ? t("settings.validating") : t("settings.validate")}
                  </Button>
                </div>
              </div>
            )}

            {/* Result */}
            {domainResult && (
              <DomainResultPanel result={domainResult} />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Domain result panel ────────────────────────────────────────────────────────

function DomainResultPanel({ result }: { result: DomainResult }) {
  if (result.ok) {
    return (
      <div className="rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-green-800 dark:text-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          {result.sslOk ? "Domain configured with HTTPS ✓" : "Domain configured (HTTP only)"}
        </div>
        <StepList steps={result.steps} />
        {!result.sslOk && result.manualCommands && (
          <ManualCommands
            title="Run to enable HTTPS:"
            commands={result.manualCommands}
          />
        )}
      </div>
    );
  }

  if (result.needsManual) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          <Terminal className="h-4 w-4 shrink-0" />
          Manual server setup required
        </div>

        <StepList steps={result.steps} />

        <div className="rounded bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
          The nginx config was saved on the server at{" "}
          <code className="font-mono font-semibold">/tmp/aio-vc-nginx-config.conf</code> — run the commands below directly (no file upload needed).
        </div>

        {result.manualCommands && (
          <ManualCommands
            title="Run these commands on the server:"
            commands={result.manualCommands}
          />
        )}

        {result.cleanupCommands && (
          <details className="text-xs">
            <summary className="cursor-pointer flex items-center gap-1.5 text-muted-foreground hover:text-foreground py-1 select-none">
              <Trash2 className="h-3 w-3" /> Undo / cleanup files
            </summary>
            <ManualCommands
              title="Run to remove any partially-created nginx files:"
              commands={result.cleanupCommands}
            />
          </details>
        )}
      </div>
    );
  }

  // Generic failure (DNS not configured, connection error, etc.)
  return (
    <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-200">
        <XCircle className="h-4 w-4 text-red-600 shrink-0" />
        {result.error ?? "Domain configuration failed"}
      </div>
      <StepList steps={result.steps} />
    </div>
  );
}

function StepList({ steps }: { steps?: DomainStep[] }) {
  if (!steps?.length) return null;
  return (
    <ul className="space-y-0.5 text-xs font-mono">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-1.5">
          {s.success
            ? <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
            : <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />}
          <span className={s.success ? "text-foreground" : "text-red-700 dark:text-red-400"}>
            {s.step}
            {s.error ? <span className="block text-[10px] text-red-600 dark:text-red-400 font-normal mt-0.5 whitespace-pre-wrap">{s.error}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ManualCommands({
  title,
  commands,
}: {
  title: string;
  commands: string[];
}) {
  const [copied, setCopied] = React.useState<number | null>(null);
  const copy = (text: string, i: number) => {
    navigator.clipboard?.writeText(text).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(el); el.select(); document.execCommand("copy"); document.body.removeChild(el);
    });
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  };

  const filtered = commands.filter(c => !c.startsWith("#"));
  const comments = commands.filter(c => c.startsWith("#"));

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{title}</p>
      {comments.length > 0 && (
        <p className="text-xs text-muted-foreground">{comments.map(c => c.replace(/^# /, "")).join(" ")}</p>
      )}
      <div className="space-y-1">
        {filtered.map((cmd, i) => (
          <div key={i} className="flex items-start gap-1.5 group">
            <pre className="flex-1 text-[10px] font-mono bg-black/10 dark:bg-white/10 px-2 py-1.5 rounded whitespace-pre-wrap break-all leading-relaxed">{cmd}</pre>
            <button
              onClick={() => copy(cmd, i)}
              className="shrink-0 mt-1 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Copy"
            >
              {copied === i
                ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                : <span className="text-[10px] text-muted-foreground">copy</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
