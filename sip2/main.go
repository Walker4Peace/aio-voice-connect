package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	// Load config
	configFile := os.Getenv("CONFIG_FILE")
	if configFile == "" {
		configFile = "config.json"
	}

	cfg, err := LoadConfig(configFile)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Resolve API key for the provider
	apiKey := resolveAPIKey(cfg.Provider)

	if apiKey == "" && cfg.Provider == "openai" {
		log.Printf("No OPENAI_API_KEY set - calls will use fallback audio handling")
	}

	fmt.Printf("Loaded config with %d functions\n", len(cfg.Tools))
	fmt.Printf("Starting HTTP API server on :%d\n", cfg.APIPort)

	// Start HTTP API server
	go startAPIServer(cfg.APIPort)

	// Get public IP
	log.Printf("DEBUG: Determined outbound IP as %s", "detecting...")
	publicIP := getPublicIP()
	localIP := getLocalIP()
	log.Printf("Local IP determined as: %s", localIP)
	log.Printf("DEBUG: Retrieved external IP as %s", publicIP)
	log.Printf("External IP determined as: %s", publicIP)

	// Create SIP client
	sipClient, err := NewSIPClient(cfg, publicIP)
	if err != nil {
		log.Fatalf("Failed to create SIP client: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle OS signals for clean shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Printf("Shutting down SIP client.")
		log.Printf("Shutting down API server.")
		cancel()
	}()

	// Start SIP transport
	if err := sipClient.Start(ctx); err != nil {
		log.Fatalf("Failed to start SIP: %v", err)
	}

	// Register with SIP server
	if err := sipClient.Register(ctx); err != nil {
		log.Fatalf("SIP registration failed: %v", err)
	}

	// Run in configured mode
	switch cfg.Mode {
	case "outbound":
		if err := runOutboundMode(ctx, sipClient, cfg, apiKey); err != nil {
			log.Printf("Outbound call error: %v", err)
			os.Exit(1)
		}
	default: // "inbound"
		runInboundMode(ctx, sipClient, cfg, apiKey)
	}
}

func resolveAPIKey(provider string) string {
	// Try provider-specific env var first, then generic AI_API_KEY
	switch provider {
	case "elevenlabs":
		if k := os.Getenv("ELEVENLABS_API_KEY"); k != "" {
			return k
		}
	case "openai":
		if k := os.Getenv("OPENAI_API_KEY"); k != "" {
			return k
		}
	case "gemini":
		if k := os.Getenv("GEMINI_API_KEY"); k != "" {
			return k
		}
	case "deepgram":
		if k := os.Getenv("DEEPGRAM_API_KEY"); k != "" {
			return k
		}
	case "cartesia":
		if k := os.Getenv("CARTESIA_API_KEY"); k != "" {
			return k
		}
	}
	// Generic fallback
	return os.Getenv("AI_API_KEY")
}
