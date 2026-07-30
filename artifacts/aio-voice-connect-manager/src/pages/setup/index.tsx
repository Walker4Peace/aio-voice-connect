import React, { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { CheckCircle2, Globe, Loader2, ShieldCheck, User, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimezoneSelect } from "@/components/ui/timezone-select";

type Step = "account" | "domain" | "finish";

interface DomainResult {
  ok: boolean;
  sslOk?: boolean;
  steps?: { step: string; success: boolean; error?: string }[];
  error?: string;
  manual?: string[];
  manualSsl?: string[];
}

export default function SetupWizard() {
  const { refetch } = useAuth();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("account");

  // Account fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [timezone, setTimezone] = useState("UTC");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  // Domain fields
  const [domain, setDomain] = useState("");
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainResult, setDomainResult] = useState<DomainResult | null>(null);

  const handleLanguageChange = (lang: "en" | "fr") => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountError(null);
    if (password !== repeatPassword) { setAccountError(t("setup.passwordMismatch")); return; }
    if (password.length < 8) { setAccountError(t("setup.passwordTooShort")); return; }
    setAccountLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, language, timezone }),
      });
      const data = await res.json();
      if (!res.ok) { setAccountError(data.error ?? t("setup.setupFailed")); return; }
      setStep("domain");
    } catch {
      setAccountError(t("setup.connectionError"));
    } finally {
      setAccountLoading(false);
    }
  };

  const handleDomainSubmit = async () => {
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
    } catch {
      setDomainResult({ ok: false, error: t("setup.connectionError") });
    } finally {
      setDomainLoading(false);
    }
  };

  const stepIndex = step === "account" ? 0 : step === "domain" ? 1 : 2;

  const steps = [
    { label: t("setup.stepAccount"), icon: User },
    { label: t("setup.stepDomain"),  icon: Globe },
    { label: t("setup.stepFinish"),  icon: CheckCircle2 },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/30 p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="AIO Voice Connect" className="h-20 w-auto object-contain" />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">{t("setup.welcome")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("setup.subtitle")}</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-0">
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center gap-1">
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                  i < stepIndex ? "border-green-500 bg-green-500 text-white"
                    : i === stepIndex ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted bg-background text-muted-foreground"
                )}>
                  {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </div>
              {i < 2 && <div className={cn("mb-4 h-0.5 w-16 transition-colors", i < stepIndex ? "bg-green-500" : "bg-muted")} />}
            </React.Fragment>
          ))}
        </div>

        {/* ── STEP 1: Account ── */}
        {step === "account" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> {t("setup.accountTitle")}</CardTitle>
              <CardDescription>{t("setup.accountDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAccountSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">{t("setup.username")}</Label>
                  <Input id="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" required minLength={3} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="password">{t("setup.password")}</Label>
                    <PasswordInput id="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t("setup.passwordMin")} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="repeat">{t("setup.repeatPassword")}</Label>
                    <PasswordInput id="repeat" value={repeatPassword} onChange={e => setRepeatPassword(e.target.value)} placeholder="••••••••" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t("setup.language")}</Label>
                    <div className="flex gap-2">
                      {(["en", "fr"] as const).map(l => (
                        <button key={l} type="button"
                          onClick={() => handleLanguageChange(l)}
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
                    <Label htmlFor="tz">{t("setup.timezone")}</Label>
                    <TimezoneSelect value={timezone} onChange={setTimezone} />
                  </div>
                </div>

                {accountError && (
                  <p className="text-sm text-destructive rounded-md bg-destructive/10 px-3 py-2 border border-destructive/20">{accountError}</p>
                )}

                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={accountLoading} className="gap-2">
                    {accountLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {accountLoading ? t("setup.saving") : t("setup.next")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 2: Domain ── */}
        {step === "domain" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" /> {t("setup.domainTitle")} <span className="text-sm font-normal text-muted-foreground">{t("setup.domainOptional")}</span>
              </CardTitle>
              <CardDescription>{t("setup.domainDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Instructions */}
              <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 text-sm space-y-2">
                <p className="font-medium text-blue-900 dark:text-blue-200">{t("setup.domainInstructionTitle")}</p>
                <ol className="list-decimal list-inside space-y-1 text-blue-800 dark:text-blue-300">
                  <li dangerouslySetInnerHTML={{ __html: t("setup.domainStep1") }} />
                  <li dangerouslySetInnerHTML={{ __html: t("setup.domainStep2") }} />
                  <li>{t("setup.domainStep3")}</li>
                  <li>{t("setup.domainStep4")}</li>
                </ol>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-2">{t("setup.domainNote")}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="domain">{t("setup.domainTitle")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="domain"
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    placeholder={t("setup.domainPlaceholder")}
                    disabled={domainLoading}
                  />
                  <Button onClick={handleDomainSubmit} disabled={!domain.trim() || domainLoading} className="gap-2 shrink-0">
                    {domainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {domainLoading ? t("setup.validating") : t("setup.validate")}
                  </Button>
                </div>
              </div>

              {/* Result */}
              {domainResult && (
                <div className={cn("rounded-md border p-4 space-y-3", domainResult.ok ? "border-green-300 bg-green-50 dark:bg-green-950/30" : "border-red-300 bg-red-50 dark:bg-red-950/30")}>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {domainResult.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />}
                    {domainResult.ok
                      ? (domainResult.sslOk ? t("setup.domainConfiguredHttps") : t("setup.domainConfiguredHttp"))
                      : domainResult.error}
                  </div>
                  {domainResult.steps && (
                    <ul className="space-y-1 text-xs font-mono">
                      {domainResult.steps.map((s, i) => (
                        <li key={i} className="flex items-center gap-2">
                          {s.success ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> : <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                          {s.step}{s.error ? ` — ${s.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {domainResult.manualSsl && (
                    <div className="text-xs space-y-1">
                      <p className="font-medium text-orange-700 dark:text-orange-400">{t("setup.manualHttps")}</p>
                      {domainResult.manualSsl.map((cmd, i) => <code key={i} className="block bg-black/10 dark:bg-white/10 px-2 py-1 rounded">{cmd}</code>)}
                    </div>
                  )}
                  {domainResult.manual && (
                    <div className="text-xs space-y-1">
                      <p className="font-medium text-red-700 dark:text-red-400">{t("setup.manualCommands")}</p>
                      {domainResult.manual.map((cmd, i) => <code key={i} className="block bg-black/10 dark:bg-white/10 px-2 py-1 rounded whitespace-pre-wrap">{cmd}</code>)}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-2 border-t">
                <Button onClick={() => setStep("finish")} variant={domainResult?.ok ? "default" : "outline"}>
                  {domainResult?.ok ? t("setup.continue") : t("setup.skip")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── STEP 3: Finish ── */}
        {step === "finish" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" /> {t("setup.finishTitle")}</CardTitle>
              <CardDescription>{t("setup.finishDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 text-sm space-y-2">
                <p className="font-medium text-green-900 dark:text-green-200">{t("setup.accountCreated")}</p>
                <p className="text-green-800 dark:text-green-300" dangerouslySetInnerHTML={{ __html: t("setup.domainLater") }} />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md bg-muted/50 p-3">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>{t("setup.sessionActive")}</span>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={() => refetch()} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" /> {t("setup.goToDashboard")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
