import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Badge } from "@/components/ui/badge"

export function ProviderBadge({ provider }: { provider?: string | null }) {
  if (!provider) {
    return <Badge variant="outline" className="text-muted-foreground bg-muted/50 border-muted">No AI</Badge>;
  }

  const p = provider.toLowerCase();
  
  if (p === 'openai') {
    return <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-[#10a37f] border-[#10a37f]/20 bg-[#10a37f]/10">OpenAI</span>;
  }
  if (p === 'elevenlabs') {
    return <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-[#7e22ce] border-[#7e22ce]/20 bg-[#7e22ce]/10">ElevenLabs</span>;
  }
  if (p === 'gemini') {
    return <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-[#2563eb] border-[#2563eb]/20 bg-[#2563eb]/10">Gemini</span>;
  }
  if (p === 'deepgram') {
    return <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-[#ea580c] border-[#ea580c]/20 bg-[#ea580c]/10">Deepgram</span>;
  }
  if (p === 'cartesia') {
    return <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold text-[#0d9488] border-[#0d9488]/20 bg-[#0d9488]/10">Cartesia</span>;
  }

  return <Badge variant="outline">{provider}</Badge>;
}
