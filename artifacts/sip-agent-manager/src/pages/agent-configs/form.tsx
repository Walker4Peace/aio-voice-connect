import React from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { 
  useGetAgentConfig, useCreateAgentConfig, useUpdateAgentConfig
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PasswordInput } from "@/components/ui/password-input";
import { ArrowLeft } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["openai", "elevenlabs", "gemini", "deepgram", "cartesia"]),
  apiKey: z.string().min(1),
  mode: z.enum(["inbound", "outbound"]).default("inbound"),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
  systemPrompt: z.string().optional(),
  greeting: z.string().optional(),
  language: z.string().optional(),
  extraConfig: z.string().optional(),
});

export default function AgentConfigForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: existingConfig, isLoading: isLoadingConfig } = useGetAgentConfig(
    Number(id), 
    { query: { enabled: isEdit, queryKey: ['agentConfig', Number(id)] } }
  );

  const createMutation = useCreateAgentConfig();
  const updateMutation = useUpdateAgentConfig();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", provider: "openai", apiKey: "", mode: "inbound",
      voiceId: "", modelId: "", systemPrompt: "", greeting: "", language: "", extraConfig: "",
    },
  });

  const selectedProvider = form.watch("provider");

  React.useEffect(() => {
    if (isEdit && existingConfig) {
      form.reset({
        name: existingConfig.name,
        provider: existingConfig.provider,
        apiKey: existingConfig.apiKey,
        mode: (existingConfig.mode as "inbound" | "outbound") || "inbound",
        voiceId: existingConfig.voiceId || "",
        modelId: existingConfig.modelId || "",
        systemPrompt: existingConfig.systemPrompt || "",
        greeting: existingConfig.greeting || "",
        language: existingConfig.language || "",
        extraConfig: existingConfig.extraConfig || "",
      });
    }
  }, [isEdit, existingConfig, form]);

  if (isEdit && isLoadingConfig) {
    return <div className="animate-pulse p-8 text-muted-foreground">{t("agentForm.loadingConfig")}</div>;
  }

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    if (isEdit) {
      updateMutation.mutate(
        { id: Number(id), data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agentConfigs'] });
            queryClient.invalidateQueries({ queryKey: ['agentConfig', Number(id)] });
            toast({ title: t("agentForm.updated"), description: t("agentForm.updatedDesc") });
            setLocation("/agent-configs");
          },
          onError: () => toast({ variant: "destructive", title: t("common.error"), description: t("agentForm.updateFailed") }),
        }
      );
    } else {
      createMutation.mutate(
        { data: values },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agentConfigs'] });
            toast({ title: t("agentForm.created"), description: t("agentForm.createdDesc") });
            setLocation("/agent-configs");
          },
          onError: () => toast({ variant: "destructive", title: t("common.error"), description: t("agentForm.createFailed") }),
        }
      );
    }
  };

  const showModel = ["openai", "gemini", "cartesia", "elevenlabs"].includes(selectedProvider);
  const showVoiceId = ["cartesia", "openai", "gemini", "deepgram"].includes(selectedProvider);
  const showGreeting = ["openai", "elevenlabs", "gemini"].includes(selectedProvider);
  
  const getVoiceIdLabel = () => {
    switch (selectedProvider) {
      case "openai": return "Voice Name (alloy, echo, fable, onyx, nova, shimmer)";
      case "elevenlabs": return "ElevenLabs Voice ID (optional)";
      case "cartesia": return "Cartesia Voice ID";
      default: return t("agentForm.voiceId");
    }
  };

  const getModelIdLabel = () => {
    switch (selectedProvider) {
      case "openai": return "Model (e.g. gpt-4o-realtime-preview)";
      case "gemini": return "Model (e.g. gemini-2.0-flash-live-001)";
      case "elevenlabs": return "ElevenLabs Agent ID";
      default: return "Model ID";
    }
  };

  const getModelIdPlaceholder = () => {
    if (selectedProvider === "elevenlabs") return "agent_xxxxxxxxxxxxxxxx";
    return t("agentForm.leaveBlank");
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => window.history.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{isEdit ? t("agentForm.editTitle") : t("agentForm.newTitle")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("agentForm.description")}</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <div className="grid grid-cols-3 gap-6 pb-6 border-b">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agentForm.agentName")}</FormLabel>
                    <FormControl>
                      <Input placeholder="ElevenLabs Sales Agent" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="provider" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agentForm.aiProvider")}</FormLabel>
                    <Select key={field.value} onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI (Realtime)</SelectItem>
                        <SelectItem value="elevenlabs">ElevenLabs (Conversational AI)</SelectItem>
                        <SelectItem value="gemini">Google Gemini (Live)</SelectItem>
                        <SelectItem value="deepgram">Deepgram (Voice Agent)</SelectItem>
                        <SelectItem value="cartesia">Cartesia (Sonic)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="mode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agentForm.callMode")}</FormLabel>
                    <Select key={field.value} onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="inbound">{t("agentForm.inbound")}</SelectItem>
                        <SelectItem value="outbound">{t("agentForm.outbound")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="space-y-6">
                <h3 className="text-lg font-medium">{t("agentForm.providerSettings")}</h3>
                
                <FormField control={form.control} name="apiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)} {t("agentForm.apiKey")}</FormLabel>
                    <FormControl>
                      <PasswordInput placeholder="sk-..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-6">
                  {showModel && (
                    <FormField control={form.control} name="modelId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{getModelIdLabel()}</FormLabel>
                        <FormControl>
                          <Input placeholder={getModelIdPlaceholder()} {...field} />
                        </FormControl>
                        {selectedProvider === "elevenlabs" && (
                          <p className="text-xs text-muted-foreground">
                            ElevenLabs → Conversational AI → your agent → Agent ID.
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {showVoiceId && (
                    <FormField control={form.control} name="voiceId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{getVoiceIdLabel()}</FormLabel>
                        <FormControl>
                          <Input placeholder={t("agentForm.leaveBlank")} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {showGreeting && (
                    <FormField control={form.control} name="greeting" render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {selectedProvider === "elevenlabs" ? t("agentForm.firstMessage") : t("agentForm.greeting")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={selectedProvider === "elevenlabs" ? "Hello! How can I help you today?" : "Hello!"}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {selectedProvider === "elevenlabs" ? t("agentForm.firstMsgDesc") : t("agentForm.greetingDesc")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}

                  {selectedProvider !== "elevenlabs" && (
                    <FormField control={form.control} name="language" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("agentForm.languageCode")}</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. en-US" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                </div>

                <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {selectedProvider === "openai" ? t("agentForm.instructions") : t("agentForm.systemPrompt")}
                    </FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="You are a helpful customer service assistant..." 
                        className="min-h-[120px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      {selectedProvider === "elevenlabs" ? t("agentForm.elevenLabsPromptDesc") : t("agentForm.systemPromptDesc")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
                
                <FormField control={form.control} name="extraConfig" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agentForm.extraConfig")}</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder='{"temperature": 0.7}' 
                        className="font-mono text-xs"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>{t("agentForm.extraConfigDesc")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="flex justify-end gap-4 pt-6 border-t">
                <Button type="button" variant="outline" onClick={() => window.history.back()}>
                  {t("agentForm.cancel")}
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {isEdit ? t("agentForm.update") : t("agentForm.create")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
