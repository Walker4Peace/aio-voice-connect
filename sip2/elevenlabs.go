package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// elMsg is a message to be sent to the ElevenLabs WebSocket.
type elMsg struct {
	msgType int
	data    []byte
}

// ElevenLabsConn wraps a gorilla WebSocket with a single-writer goroutine.
// This is the fix for: panic: concurrent write to websocket connection.
// Gorilla WebSocket allows one concurrent reader and one concurrent writer.
// We guarantee this by routing ALL writes through a channel to a single goroutine.
type ElevenLabsConn struct {
	conn    *websocket.Conn
	writeCh chan elMsg
	closeCh chan struct{}
	once    sync.Once
}

func newElevenLabsConn(conn *websocket.Conn) *ElevenLabsConn {
	c := &ElevenLabsConn{
		conn:    conn,
		writeCh: make(chan elMsg, 256),
		closeCh: make(chan struct{}),
	}
	go c.writerLoop()
	return c
}

// writerLoop is the ONLY goroutine that calls conn.WriteMessage.
func (c *ElevenLabsConn) writerLoop() {
	for {
		select {
		case msg, ok := <-c.writeCh:
			if !ok {
				return
			}
			if err := c.conn.WriteMessage(msg.msgType, msg.data); err != nil {
				return
			}
		case <-c.closeCh:
			return
		}
	}
}

// WriteJSON serializes v and sends it as a text message.
func (c *ElevenLabsConn) WriteJSON(v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	select {
	case c.writeCh <- elMsg{websocket.TextMessage, data}:
		return nil
	case <-c.closeCh:
		return fmt.Errorf("websocket closed")
	}
}

// WriteAudio sends raw bytes as a binary message.
func (c *ElevenLabsConn) WriteAudio(data []byte) error {
	cp := make([]byte, len(data))
	copy(cp, data)
	select {
	case c.writeCh <- elMsg{websocket.BinaryMessage, cp}:
		return nil
	case <-c.closeCh:
		return fmt.Errorf("websocket closed")
	}
}

// ReadMessage reads from the WebSocket (only one goroutine should call this).
func (c *ElevenLabsConn) ReadMessage() (int, []byte, error) {
	return c.conn.ReadMessage()
}

// Close signals the writer to stop and closes the connection.
func (c *ElevenLabsConn) Close() {
	c.once.Do(func() {
		close(c.closeCh)
		c.conn.Close()
	})
}

// ─── ElevenLabs message types ──────────────────────────────────────────────

type elInitMetadata struct {
	Type string `json:"type"`
	ConversationInitiationMetadataEvent struct {
		ConversationID         string `json:"conversation_id"`
		AgentOutputAudioFormat string `json:"agent_output_audio_format"`
	} `json:"conversation_initiation_metadata_event"`
}

type elAudioChunk struct {
	Type string `json:"type"`
	// ElevenLabs ConvAI API format: audio_event.audio_base_64
	AudioEvent struct {
		AudioBase64 string `json:"audio_base_64"`
	} `json:"audio_event"`
}

type elUserTranscript struct {
	Type string `json:"type"`
	UserTranscriptionEvent struct {
		UserTranscript string `json:"user_transcript"`
	} `json:"user_transcription_event"`
}

type elAgentResponse struct {
	Type string `json:"type"`
	AgentResponseEvent struct {
		AgentResponse string `json:"agent_response"`
	} `json:"agent_response_event"`
}

type elToolCall struct {
	Type            string `json:"type"`
	ClientToolCall struct {
		ToolName   string                 `json:"tool_name"`
		ToolCallID string                 `json:"tool_call_id"`
		Parameters map[string]interface{} `json:"parameters"`
	} `json:"client_tool_call"`
}

type elPing struct {
	Type      string `json:"type"`
	PingEvent struct {
		EventID int `json:"event_id"`
	} `json:"ping_event"`
}

// elRawMsg is used for type-dispatch.
type elRawMsg struct {
	Type string `json:"type"`
}

// ElevenLabsBridge manages a full ElevenLabs conversation session.
type ElevenLabsBridge struct {
	cfg        *ElevenLabsConfig
	apiKey     string
	conn       *ElevenLabsConn
	rtpConn    *RTPConn
	callID     string
	outputRate int // Hz (8000 or 16000)

	// rtpQueue carries 160-byte (20 ms) PCMU chunks from elevenLabsReader to
	// rtpPacer.  Buffered to absorb bursts from ElevenLabs without blocking.
	rtpQueue chan []byte

	// Callbacks
	onConvID     func(convID string)
	onUserSpeech func(text string)
	onAISpeech   func(text string)
	onToolCall   func(name, callID string, params map[string]interface{})
	onConvEnded  func()
	onRawMsg     func(raw string)
}

func NewElevenLabsBridge(cfg *ElevenLabsConfig, apiKey string, rtpConn *RTPConn, callID string) *ElevenLabsBridge {
	return &ElevenLabsBridge{
		cfg:     cfg,
		apiKey:  apiKey,
		rtpConn: rtpConn,
		callID:  callID,
	}
}

// Connect establishes the ElevenLabs WebSocket connection.
func (b *ElevenLabsBridge) Connect(ctx context.Context) error {
	url := fmt.Sprintf("wss://api.elevenlabs.io/v1/convai/conversation?agent_id=%s", b.cfg.AgentID)
	log.Printf("Connecting to ElevenLabs Conversational AI (agent: %s)...", b.cfg.AgentID)

	headers := http.Header{}
	if b.apiKey != "" {
		headers.Set("xi-api-key", b.apiKey)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
	}
	rawConn, _, err := dialer.DialContext(ctx, url, headers)
	if err != nil {
		return fmt.Errorf("failed to connect to ElevenLabs: %w", err)
	}

	b.conn = newElevenLabsConn(rawConn)
	log.Printf("Connected to ElevenLabs Conversational AI")

	// Receive the conversation initiation metadata
	_, raw, err := b.conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("failed to read init metadata: %w", err)
	}
	var meta elInitMetadata
	if err := json.Unmarshal(raw, &meta); err == nil && meta.Type == "conversation_initiation_metadata" {
		convID := meta.ConversationInitiationMetadataEvent.ConversationID
		format := meta.ConversationInitiationMetadataEvent.AgentOutputAudioFormat
		// Determine output sample rate
		b.outputRate = 8000
		if strings.Contains(format, "16000") {
			b.outputRate = 16000
		} else if strings.Contains(format, "24000") {
			b.outputRate = 24000
		}
		if b.onConvID != nil && convID != "" {
			b.onConvID(convID)
		}
		log.Printf("ElevenLabs conversation started: %s (audio format: %s)", convID, format)
	}

	// Send conversation initiation with overrides
	return b.sendInitData(ctx)
}

func (b *ElevenLabsBridge) sendInitData(ctx context.Context) error {
	hasSysPrompt := b.cfg.SystemPrompt != ""

	log.Printf("Note: first_message/system_prompt in config require 'Allow client overrides' in ElevenLabs dashboard")
	log.Printf("If override fails, the agent's default greeting will be used")
	log.Printf("DEBUG: appConfig=%v", true)
	log.Printf("DEBUG: ElevenLabs.FirstMessage='%s', SystemPrompt='%s', Functions=%d",
		b.cfg.FirstMessage, b.cfg.SystemPrompt, 0)

	if !hasSysPrompt && b.cfg.FirstMessage == "" {
		return nil
	}

	type promptOverride struct {
		Prompt string `json:"prompt,omitempty"`
	}
	type agentOverride struct {
		Prompt *promptOverride `json:"prompt,omitempty"`
		FirstMessage string   `json:"first_message,omitempty"`
	}
	type convOverride struct {
		Agent *agentOverride `json:"agent,omitempty"`
	}
	type initData struct {
		ConversationConfigOverride convOverride `json:"conversation_config_override"`
		Type                       string       `json:"type"`
	}

	agent := &agentOverride{}
	if hasSysPrompt {
		log.Printf("Overriding system prompt")
		agent.Prompt = &promptOverride{Prompt: b.cfg.SystemPrompt}
	}
	if b.cfg.FirstMessage != "" {
		agent.FirstMessage = b.cfg.FirstMessage
	}

	msg := initData{
		ConversationConfigOverride: convOverride{Agent: agent},
		Type:                       "conversation_initiation_client_data",
	}

	raw, _ := json.Marshal(msg)
	log.Printf("Sending conversation initiation to ElevenLabs: %s", string(raw))

	return b.conn.WriteJSON(msg)
}

// Start launches the RTP↔ElevenLabs audio bridge goroutines.
// It blocks until all goroutines finish (call ended or context cancelled).
//
// Three goroutines run concurrently:
//   1. elevenLabsReader — reads WS messages, queues PCMU chunks, handles control.
//   2. rtpPacer         — sends one queued PCMU chunk every 20 ms (real-time pacing).
//   3. rtpToElevenLabs  — forwards phone RTP → ElevenLabs.
//
// When elevenLabsReader exits (conversation_ended, WS error, or ctx done):
//   • it closes rtpQueue so rtpPacer drains remaining audio and exits.
//   • it cancels bridgeCtx so rtpToElevenLabs exits within one read-deadline.
func (b *ElevenLabsBridge) Start(ctx context.Context) {
	bridgeCtx, cancelBridge := context.WithCancel(ctx)

	// rtpQueue buffers 20-ms PCMU chunks from ElevenLabs.
	// 2000 slots ≈ 40 seconds — enough for the longest burst.
	b.rtpQueue = make(chan []byte, 2000)

	var closeOnce sync.Once
	closeQueue := func() { closeOnce.Do(func() { close(b.rtpQueue) }) }

	var wg sync.WaitGroup
	wg.Add(3)

	// 1. ElevenLabs reader
	go func() {
		defer wg.Done()
		defer cancelBridge() // unblocks rtpToElevenLabs
		defer closeQueue()   // unblocks rtpPacer after drain
		b.elevenLabsReader(bridgeCtx)
	}()

	// 2. RTP pacer (one packet per 20 ms)
	go func() {
		defer wg.Done()
		b.rtpPacer(bridgeCtx)
	}()

	// 3. Phone → ElevenLabs forwarder
	go func() {
		defer wg.Done()
		b.rtpToElevenLabs(bridgeCtx)
	}()

	wg.Wait()
	cancelBridge() // ensure no leak if Start returns first
}

// enqueuePCMU splits a raw PCMU buffer into 160-byte (20 ms) chunks and
// pushes each chunk onto b.rtpQueue for the pacer to send in real time.
func (b *ElevenLabsBridge) enqueuePCMU(pcmu []byte) {
	const chunkSize = 160
	for len(pcmu) > 0 {
		n := chunkSize
		if n > len(pcmu) {
			n = len(pcmu)
		}
		chunk := make([]byte, n)
		copy(chunk, pcmu[:n])
		select {
		case b.rtpQueue <- chunk:
		default:
			// Queue full (> 40 s of buffered audio) — drop oldest would be
			// ideal but dropping newest is simpler; this should never happen
			// in practice.
		}
		pcmu = pcmu[n:]
	}
}

// rtpPacer sends one 160-byte PCMU chunk from rtpQueue every 20 ms.
// This decouples ElevenLabs burst delivery from real-time RTP pacing so the
// phone's jitter buffer is never overflowed.
func (b *ElevenLabsBridge) rtpPacer(ctx context.Context) {
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	sent := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Non-blocking read: send one packet per tick if available.
			select {
			case pkt, ok := <-b.rtpQueue:
				if !ok {
					return // queue closed (conversation ended)
				}
				if err := b.rtpConn.SendPacket(pkt); err != nil {
					log.Printf("Error sending RTP packet: %v", err)
				}
				sent++
				if sent%100 == 0 {
					log.Printf("Outbound sent %d RTP packets to %s", sent, b.rtpConn.RemoteAddr())
				}
			default:
				// No audio ready this tick — send nothing (natural silence).
			}
		}
	}
}

// elevenLabsReader reads messages from ElevenLabs and routes them:
//
//   - Binary frames  → decode PCMU, split into 160-byte chunks, enqueue for pacer.
//   - "audio" JSON   → same as binary (fallback for non-ulaw formats).
//   - Control JSON   → handle ping/pong, transcripts, tool calls, conv_ended.
//
// ElevenLabs ConvAI sends audio as binary WebSocket frames for ulaw_8000,
// and as base64 JSON for PCM formats.  We handle both.
func (b *ElevenLabsBridge) elevenLabsReader(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msgType, raw, err := b.conn.ReadMessage()
		if err != nil {
			log.Printf("Error reading from ElevenLabs: %v", err)
			return
		}

		// ── Binary frame: raw audio ───────────────────────────────────────
		if msgType == websocket.BinaryMessage {
			var pcmu []byte
			if b.outputRate == 8000 {
				pcmu = raw // already PCMU
			} else {
				pcm16 := raw
				if b.outputRate == 16000 {
					pcm16 = downsample2x(pcm16)
				} else if b.outputRate > 16000 {
					pcm16 = downsample3x(pcm16)
				}
				pcmu = encodePCMU(pcm16)
			}
			b.enqueuePCMU(pcmu)
			continue
		}

		// ── Text frame: JSON control message ─────────────────────────────
		var base elRawMsg
		if err := json.Unmarshal(raw, &base); err != nil {
			continue
		}

		rawStr := string(raw)
		if b.onRawMsg != nil {
			b.onRawMsg(rawStr)
		}
		if strings.Contains(rawStr, `"tool_name"`) || strings.Contains(rawStr, `"conversation_ended"`) {
			log.Printf("ElevenLabs raw message: %s", rawStr)
		}

		switch base.Type {
		case "audio":
			// JSON audio path (some ElevenLabs configurations).
			var audioMsg elAudioChunk
			if err := json.Unmarshal(raw, &audioMsg); err != nil {
				continue
			}
			b64 := audioMsg.AudioEvent.AudioBase64
			if b64 == "" {
				continue
			}
			rawAudio, err := base64.StdEncoding.DecodeString(b64)
			if err != nil {
				continue
			}
			var pcmu []byte
			if b.outputRate == 8000 {
				pcmu = rawAudio
			} else {
				pcm16 := rawAudio
				if b.outputRate == 16000 {
					pcm16 = downsample2x(pcm16)
				} else if b.outputRate > 16000 {
					pcm16 = downsample3x(pcm16)
				}
				pcmu = encodePCMU(pcm16)
			}
			b.enqueuePCMU(pcmu)

		case "user_transcript":
			var t elUserTranscript
			if err := json.Unmarshal(raw, &t); err == nil {
				text := t.UserTranscriptionEvent.UserTranscript
				if text != "" {
					log.Printf("Remote: %s", text)
					if b.onUserSpeech != nil {
						b.onUserSpeech(text)
					}
				}
			}

		case "agent_response":
			var r elAgentResponse
			if err := json.Unmarshal(raw, &r); err == nil {
				text := r.AgentResponseEvent.AgentResponse
				if text != "" {
					log.Printf("AI: %s", text)
					if b.onAISpeech != nil {
						b.onAISpeech(text)
					}
				}
			}

		case "client_tool_call":
			var tc elToolCall
			if err := json.Unmarshal(raw, &tc); err == nil {
				name := tc.ClientToolCall.ToolName
				callID := tc.ClientToolCall.ToolCallID
				params := tc.ClientToolCall.Parameters
				log.Printf("ElevenLabs raw message: %s", rawStr) // ensure logged for deployment.ts
				if b.onToolCall != nil {
					b.onToolCall(name, callID, params)
				}
			}

		case "ping":
			var ping elPing
			if err := json.Unmarshal(raw, &ping); err == nil {
				pong := map[string]interface{}{
					"type":     "pong",
					"event_id": ping.PingEvent.EventID,
				}
				// Safe: goes through single-writer channel
				if err := b.conn.WriteJSON(pong); err != nil {
					log.Printf("Error sending pong: %v", err)
				}
			}

		case "conversation_ended":
			log.Printf("ElevenLabs raw message: %s", rawStr)
			if b.onConvEnded != nil {
				b.onConvEnded()
			}
			return

		case "interruption":
			// AI was interrupted — no action needed, just continue

		case "conversation_initiation_metadata":
			// Already handled before Start()
		}
	}
}

// rtpToElevenLabs reads RTP packets and sends audio to ElevenLabs.
func (b *ElevenLabsBridge) rtpToElevenLabs(ctx context.Context) {
	buf := make([]byte, 4096)
	count := 0
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		b.rtpConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		payload, pt, err := b.rtpConn.ReadPacket(buf)
		if err != nil {
			if isTimeout(err) {
				continue
			}
			log.Printf("Error sending audio to ElevenLabs: %v", err)
			return
		}

		count++
		if count == 1 || count%100 == 0 {
			log.Printf("Outbound RTP packet #%d from %s, size=%d", count, b.rtpConn.RemoteAddr(), len(payload)+12)
		}

		// Decode G.711 to PCM16
		var pcm16 []byte
		switch pt {
		case 0: // PCMU
			pcm16 = decodePCMU(payload)
		case 8: // PCMA
			pcm16 = decodePCMA(payload)
		default:
			// Unknown codec - skip
			continue
		}

		// Send as user_audio_chunk to ElevenLabs
		msg := map[string]interface{}{
			"type":             "user_audio_chunk",
			"user_audio_chunk": pcm16ToBase64(pcm16),
		}
		if err := b.conn.WriteJSON(msg); err != nil {
			log.Printf("Error sending audio to ElevenLabs: %v", err)
			return
		}
	}
}

// SendToolResult sends a tool result back to ElevenLabs.
func (b *ElevenLabsBridge) SendToolResult(toolCallID string, result interface{}) {
	raw, _ := json.Marshal(result)
	msg := map[string]interface{}{
		"type":        "client_tool_result",
		"tool_call_id": toolCallID,
		"result":      string(raw),
	}
	log.Printf("Sending tool result to ElevenLabs: %s", string(raw))
	b.conn.WriteJSON(msg) //nolint
}

// CloseConnection closes the ElevenLabs WebSocket.
func (b *ElevenLabsBridge) CloseConnection() {
	if b.conn != nil {
		b.conn.Close()
	}
}

// ExecuteTool calls the tools_callback_url and returns the result.
func executeTool(callbackURL, toolName, toolCallID string, params map[string]interface{}) (interface{}, error) {
	body := map[string]interface{}{
		"tool_name":   toolName,
		"tool_call_id": toolCallID,
		"parameters":  params,
	}
	raw, _ := json.Marshal(body)
	resp, err := http.Post(callbackURL, "application/json", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return string(data), nil
	}
	return result, nil
}

// isTimeout checks whether an error is a network timeout.
func isTimeout(err error) bool {
	type timeoutErr interface {
		Timeout() bool
	}
	if te, ok := err.(timeoutErr); ok {
		return te.Timeout()
	}
	return false
}

// downsample3x reduces 24kHz PCM16 to 8kHz by taking every 3rd sample.
func downsample3x(pcm16 []byte) []byte {
	if len(pcm16) < 6 {
		return pcm16
	}
	out := make([]byte, len(pcm16)/3)
	j := 0
	for i := 0; i+1 < len(pcm16) && j+1 < len(out); i += 6 {
		out[j] = pcm16[i]
		out[j+1] = pcm16[i+1]
		j += 2
	}
	return out[:j]
}
