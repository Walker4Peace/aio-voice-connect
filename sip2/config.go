package main

import (
	"encoding/json"
	"os"
	"strconv"
)

// Config mirrors the JSON written by deployment.ts buildConfig
type Config struct {
	Mode     string `json:"mode"`     // "inbound" | "outbound"
	APIPort  int    `json:"api_port"` // HTTP API port
	Provider string `json:"provider"` // "elevenlabs" | "openai" | ...

	SIP SIPConfig `json:"sip"`

	ElevenLabs *ElevenLabsConfig `json:"elevenlabs,omitempty"`
	OpenAI     *OpenAIConfig     `json:"openai,omitempty"`
	Gemini     *GeminiConfig     `json:"gemini,omitempty"`
	Deepgram   *DeepgramConfig   `json:"deepgram,omitempty"`
	Cartesia   *CartesiaConfig   `json:"cartesia,omitempty"`

	Outbound *OutboundConfig `json:"outbound,omitempty"`

	Tools             []ToolConfig `json:"tools,omitempty"`
	ToolsCallbackURL  string       `json:"tools_callback_url,omitempty"`
	ContextWebhookURL string       `json:"context_webhook_url,omitempty"`
	ResultWebhook     string       `json:"result_webhook,omitempty"`
}

type SIPConfig struct {
	Username      string `json:"username"`
	AuthID        string `json:"auth_id"`
	Password      string `json:"password"`
	Domain        string `json:"domain"`
	Server        string `json:"server"`
	Listen        int    `json:"listen"`
	Transport     string `json:"transport"`
	OutboundProxy string `json:"outbound_proxy,omitempty"`
}

type ElevenLabsConfig struct {
	AgentID      string `json:"agent_id"`
	FirstMessage string `json:"first_message,omitempty"`
	SystemPrompt string `json:"system_prompt,omitempty"`
}

type OpenAIConfig struct {
	Model        string `json:"model"`
	Voice        string `json:"voice"`
	Instructions string `json:"instructions,omitempty"`
	Greeting     string `json:"greeting,omitempty"`
}

type GeminiConfig struct {
	Model        string `json:"model"`
	Voice        string `json:"voice"`
	Language     string `json:"language,omitempty"`
	SystemPrompt string `json:"system_prompt,omitempty"`
	Greeting     string `json:"greeting,omitempty"`
}

type DeepgramConfig struct {
	Model        string `json:"model"`
	ListenModel  string `json:"listen_model,omitempty"`
	SystemPrompt string `json:"system_prompt,omitempty"`
	Language     string `json:"language,omitempty"`
}

type CartesiaConfig struct {
	VoiceID      string `json:"voice_id"`
	Model        string `json:"model"`
	Language     string `json:"language,omitempty"`
	SystemPrompt string `json:"system_prompt,omitempty"`
}

type OutboundConfig struct {
	TargetNumber         string `json:"target_number"`
	CallerID             string `json:"caller_id,omitempty"`
	TaskDescription      string `json:"task_description,omitempty"`
	HangupOnTaskComplete bool   `json:"hangup_on_task_complete"`
}

type ToolConfig struct {
	Name                string                 `json:"name"`
	Description         string                 `json:"description"`
	Parameters          map[string]interface{} `json:"parameters,omitempty"`
	ExecutionType       string                 `json:"execution_type,omitempty"`
	Timeout             int                    `json:"timeout,omitempty"`
	RequireConfirmation bool                   `json:"require_confirmation,omitempty"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	// Env var overrides
	if v := os.Getenv("SIP_USERNAME"); v != "" {
		cfg.SIP.Username = v
	}
	if v := os.Getenv("SIP_AUTH_ID"); v != "" {
		cfg.SIP.AuthID = v
	}
	if v := os.Getenv("SIP_PASSWORD"); v != "" {
		cfg.SIP.Password = v
	}
	if v := os.Getenv("SIP_DOMAIN"); v != "" {
		cfg.SIP.Domain = v
	}
	if v := os.Getenv("SIP_SERVER"); v != "" {
		cfg.SIP.Server = v
	}
	if v := os.Getenv("SIP_OUTBOUND_PROXY"); v != "" {
		cfg.SIP.OutboundProxy = v
	}
	if v := os.Getenv("SIP_LOCAL_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			cfg.SIP.Listen = p
		}
	}
	if v := os.Getenv("HTTP_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			cfg.APIPort = p
		}
	}
	return &cfg, nil
}
