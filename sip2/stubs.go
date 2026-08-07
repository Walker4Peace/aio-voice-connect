package main

// Stub implementations for OpenAI, Gemini, Deepgram, Cartesia providers.
// These are placeholders — only ElevenLabs is fully implemented.

import (
	"context"
	"log"
)

func runOpenAI(ctx context.Context, cfg *Config, apiKey string, rtpConn *RTPConn, callID string) error {
	log.Printf("OpenAI provider not yet implemented in this build")
	return nil
}

func runGemini(ctx context.Context, cfg *Config, apiKey string, rtpConn *RTPConn, callID string) error {
	log.Printf("Gemini provider not yet implemented in this build")
	return nil
}

func runDeepgram(ctx context.Context, cfg *Config, apiKey string, rtpConn *RTPConn, callID string) error {
	log.Printf("Deepgram provider not yet implemented in this build")
	return nil
}

func runCartesia(ctx context.Context, cfg *Config, apiKey string, rtpConn *RTPConn, callID string) error {
	log.Printf("Cartesia provider not yet implemented in this build")
	return nil
}
