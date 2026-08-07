package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/emiago/sipgo"
	"github.com/emiago/sipgo/sip"
	"github.com/icholy/digest"
)

// SIPClient wraps sipgo UA + Client + Server for our use.
type SIPClient struct {
	cfg       *sipCfg
	ua        *sipgo.UserAgent
	client    *sipgo.Client
	server    *sipgo.Server
	dialogUA  *sipgo.DialogUA
	publicIP  string
	mu        sync.Mutex
	registered bool
}

type sipCfg struct {
	username      string
	authID        string
	password      string
	domain        string
	server        string
	listenPort    int
	outboundProxy string
	transport     string
}

func NewSIPClient(cfg *Config, publicIP string) (*SIPClient, error) {
	transport := strings.ToLower(cfg.SIP.Transport)
	if transport == "" {
		transport = "udp"
	}
	authID := cfg.SIP.AuthID
	if authID == "" {
		authID = cfg.SIP.Username
	}
	return &SIPClient{
		cfg: &sipCfg{
			username:      cfg.SIP.Username,
			authID:        authID,
			password:      cfg.SIP.Password,
			domain:        cfg.SIP.Domain,
			server:        cfg.SIP.Server,
			listenPort:    cfg.SIP.Listen,
			outboundProxy: cfg.SIP.OutboundProxy,
			transport:     transport,
		},
		publicIP: publicIP,
	}, nil
}

// Start sets up the SIP UA, client, and server and begins listening.
func (c *SIPClient) Start(ctx context.Context) error {
	listenAddr := fmt.Sprintf("0.0.0.0:%d", c.cfg.listenPort)

	ua, err := sipgo.NewUA(
		sipgo.WithUserAgent("sip4ai"),
		sipgo.WithUserAgentHostname(c.publicIP),
	)
	if err != nil {
		return fmt.Errorf("UA creation failed: %w", err)
	}
	c.ua = ua

	client, err := sipgo.NewClient(ua,
		sipgo.WithClientAddr(fmt.Sprintf("%s:%d", c.publicIP, c.cfg.listenPort)),
	)
	if err != nil {
		return fmt.Errorf("client creation failed: %w", err)
	}
	c.client = client

	server, err := sipgo.NewServer(ua)
	if err != nil {
		return fmt.Errorf("server creation failed: %w", err)
	}
	c.server = server

	c.dialogUA = &sipgo.DialogUA{
		Client: client,
		ContactHDR: sip.ContactHeader{
			Address: sip.Uri{
				User: c.cfg.username,
				Host: c.publicIP,
				Port: c.cfg.listenPort,
			},
		},
	}

	// Register OPTIONS handler (SIP keep-alive / ping)
	server.OnOptions(func(req *sip.Request, tx sip.ServerTransaction) {
		resp := sip.NewResponseFromRequest(req, 200, "OK", nil)
		tx.Respond(resp)
	})

	// Start listening
	go func() {
		if err := server.ListenAndServe(ctx, strings.ToUpper(c.cfg.transport), listenAddr); err != nil && ctx.Err() == nil {
			log.Printf("error in SIP server: %v", err)
		}
	}()

	time.Sleep(200 * time.Millisecond) // allow server to bind

	log.Printf("Starting SIP client with configuration:")
	log.Printf("Username: %s, Domain: %s, Server: %s, Transport: %s",
		c.cfg.username, c.cfg.domain, c.cfg.server, strings.ToUpper(c.cfg.transport))
	if c.cfg.authID != c.cfg.username {
		log.Printf("Auth ID: %s (using separate authorization ID)", c.cfg.authID)
	}
	if c.cfg.outboundProxy != "" {
		log.Printf("Outbound Proxy: %s", c.cfg.outboundProxy)
	}
	return nil
}

// buildRegisterRequest builds a SIP REGISTER request.
func (c *SIPClient) buildRegisterRequest() *sip.Request {
	host, port := parseSIPServer(c.cfg.server)
	_ = port
	registrarURI := sip.Uri{Host: host, Port: 5060}
	fromTag := randomTag()

	req := sip.NewRequest(sip.REGISTER, registrarURI)
	req.SetTransport(strings.ToUpper(c.cfg.transport))
	req.AppendHeader(sip.NewHeader("From", fmt.Sprintf("<sip:%s@%s>;tag=%s", c.cfg.username, c.cfg.domain, fromTag)))
	req.AppendHeader(sip.NewHeader("To", fmt.Sprintf("<sip:%s@%s>", c.cfg.username, c.cfg.domain)))
	req.AppendHeader(&sip.ContactHeader{
		Address: sip.Uri{
			User: c.cfg.username,
			Host: c.publicIP,
			Port: c.cfg.listenPort,
		},
	})
	req.AppendHeader(sip.NewHeader("Expires", "3600"))
	req.AppendHeader(sip.NewHeader("Content-Length", "0"))

	if c.cfg.outboundProxy != "" {
		req.AppendHeader(sip.NewHeader("Route", fmt.Sprintf("<sip:%s;lr>", c.cfg.outboundProxy)))
	}
	return req
}

// Register sends SIP REGISTER with digest auth handling.
func (c *SIPClient) Register(ctx context.Context) error {
	host, _ := parseSIPServer(c.cfg.server)
	if c.cfg.outboundProxy != "" {
		log.Printf("REGISTER via outbound proxy: %s", c.cfg.outboundProxy)
	}
	log.Printf("Sending REGISTER request via sipgo client.")

	req := c.buildRegisterRequest()
	req.SetDestination(fmt.Sprintf("%s:5060", host))

	// ClientRequestRegisterBuild adds all mandatory SIP headers (CSeq, CallID,
	// Max-Forwards, Via) if missing. It also handles CSeq increment on re-sends.
	resp, err := c.client.Do(ctx, req, sipgo.ClientRequestRegisterBuild)
	if err != nil {
		return fmt.Errorf("REGISTER failed: %w", err)
	}

	if resp.StatusCode == 200 {
		log.Printf("Registration successful!")
		log.Printf("Registered with SIP provider")
		c.mu.Lock()
		c.registered = true
		c.mu.Unlock()
		c.scheduleReregister(ctx, 3600)
		return nil
	}

	if resp.StatusCode != 401 && resp.StatusCode != 407 {
		return fmt.Errorf("registration failed: %d %s", resp.StatusCode, resp.Reason)
	}

	log.Printf("First 401 received. Response:")
	logSIPResponse(resp)

	// Extract auth info for logging
	wwwH := resp.GetHeader("WWW-Authenticate")
	if wwwH == nil {
		wwwH = resp.GetHeader("Proxy-Authenticate")
	}
	if wwwH != nil {
		chal, err := digest.ParseChallenge(wwwH.Value())
		if err == nil {
			registerURI := fmt.Sprintf("sip:%s", c.cfg.domain)
			log.Printf("Auth: digestUsername=%s, realm=%s, uri=%s, password=%s",
				c.cfg.authID, chal.Realm, registerURI, c.cfg.password)
		}
	}

	log.Printf("Resending REGISTER with Authorization header (CSeq=2).")

	// Use built-in digest auth handler
	resp2, err := c.client.DoDigestAuth(ctx, req, resp, sipgo.DigestAuth{
		Username: c.cfg.authID,
		Password: c.cfg.password,
	})
	if err != nil {
		return fmt.Errorf("auth REGISTER failed: %w", err)
	}

	if resp2.StatusCode != 200 {
		return fmt.Errorf("registration failed: %d %s", resp2.StatusCode, resp2.Reason)
	}

	log.Printf("Received REGISTER response: SIP/2.0 200 OK")
	logSIPResponse(resp2)
	log.Printf("Registration successful!")
	log.Printf("Registered with SIP provider")

	c.mu.Lock()
	c.registered = true
	c.mu.Unlock()

	exp := 3600
	if expH := resp2.GetHeader("Expires"); expH != nil {
		fmt.Sscanf(expH.Value(), "%d", &exp)
	}
	c.scheduleReregister(ctx, exp)
	return nil
}

func (c *SIPClient) scheduleReregister(ctx context.Context, expiresSec int) {
	if expiresSec < 60 {
		expiresSec = 60
	}
	delay := time.Duration(expiresSec-30) * time.Second
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
			log.Printf("Re-registering with SIP server...")
			if err := c.Register(ctx); err != nil {
				log.Printf("Error during re-registration: %v", err)
				c.scheduleReregister(ctx, 60)
			} else {
				log.Printf("Re-registration successful")
			}
		}
	}()
}

// SetInviteHandler registers the inbound INVITE handler.
func (c *SIPClient) SetInviteHandler(h func(req *sip.Request, tx sip.ServerTransaction)) {
	c.server.OnInvite(h)
}

// SetByeHandlerGlobal registers the inbound BYE handler at the server level.
func (c *SIPClient) SetByeHandlerGlobal(h func(req *sip.Request, tx sip.ServerTransaction)) {
	c.server.OnBye(h)
}

// WaitForInbound blocks until ctx is cancelled.
func (c *SIPClient) WaitForInbound(ctx context.Context) {
	log.Printf("Initial REGISTER request sent.")
	log.Printf("SIP server is now listening for incoming messages.")
	<-ctx.Done()
}

func logSIPResponse(resp *sip.Response) {
	log.Printf("SIP/2.0 %d %s", resp.StatusCode, resp.Reason)
	for _, h := range resp.Headers() {
		log.Printf("  %s: %s", h.Name(), h.Value())
	}
}

// runInboundMode registers handlers and serves inbound calls.
func runInboundMode(ctx context.Context, sipClient *SIPClient, cfg *Config, apiKey string) {
	sipClient.SetInviteHandler(func(req *sip.Request, tx sip.ServerTransaction) {
		handleInboundCall(ctx, sipClient, req, tx, cfg, apiKey)
	})

	sipClient.SetByeHandlerGlobal(func(req *sip.Request, tx sip.ServerTransaction) {
		callID := ""
		if h := req.CallID(); h != nil {
			callID = h.Value()
		}
		log.Printf("BYE received for call: %s", callID)
		resp := sip.NewResponseFromRequest(req, 200, "OK", nil)
		tx.Respond(resp)
		// Invoke registered handler if any
		byeHandlerMu.Lock()
		h := byeHandler
		byeHandlerMu.Unlock()
		if h != nil {
			go h()
		}
	})

	sipClient.WaitForInbound(ctx)
}

func handleInboundCall(ctx context.Context, sipClient *SIPClient, req *sip.Request, tx sip.ServerTransaction, cfg *Config, apiKey string) {
	callID := ""
	if h := req.CallID(); h != nil {
		callID = h.Value()
	}
	log.Printf("INVITE received for call: %s, auto-answering using sipgo.", callID)

	if from := req.From(); from != nil {
		log.Printf("Stored remote Contact for dialog: sip:%s@%s", from.Address.User, from.Address.Host)
	}

	// Open RTP socket for this call
	rtpConn, err := OpenRTPConn()
	if err != nil {
		log.Printf("Failed to open RTP socket: %v", err)
		resp := sip.NewResponseFromRequest(req, 503, "Service Unavailable", nil)
		tx.Respond(resp)
		return
	}

	// Build SDP answer
	remoteSDP := string(req.Body())
	sdpAnswer := buildSDPOffer(sipClient.publicIP, rtpConn.Port)

	// Parse remote RTP address from INVITE SDP
	if remoteSDP != "" {
		rip, rport, err := parseRemoteAudioAddr(remoteSDP)
		if err == nil {
			rtpConn.SetRemote(rip, rport)
		}
	}

	// Send 100 Trying
	trying := sip.NewResponseFromRequest(req, 100, "Trying", nil)
	tx.Respond(trying)

	// Send 200 OK
	ok := sip.NewResponseFromRequest(req, 200, "OK", nil)
	ok.AppendHeader(sip.NewHeader("Content-Type", "application/sdp"))
	ok.SetBody([]byte(sdpAnswer))
	tx.Respond(ok)

	// Bridge audio in a goroutine
	callCtx, cancelCall := context.WithCancel(ctx)
	setByeHandler(func() {
		cancelCall()
	})

	go func() {
		defer cancelCall()
		defer rtpConn.Close()
		defer clearByeHandler()
		defer log.Printf("Call ended: %s", callID)

		if err := runProvider(callCtx, cfg, apiKey, rtpConn, callID); err != nil {
			log.Printf("Provider error for call %s: %v", callID, err)
		}
		log.Printf("Unregistered bridge for call: %s", callID)
	}()
}

// runProvider starts the appropriate AI provider.
func runProvider(ctx context.Context, cfg *Config, apiKey string, rtpConn *RTPConn, callID string) error {
	switch cfg.Provider {
	case "elevenlabs":
		if cfg.ElevenLabs == nil {
			return fmt.Errorf("elevenlabs config missing")
		}
		bridge := NewElevenLabsBridge(cfg.ElevenLabs, apiKey, rtpConn, callID)
		bridge.onConvID = func(convID string) {
			log.Printf("ElevenLabs outbound conversation: %s", convID)
		}
		bridge.onToolCall = func(name, tcID string, params map[string]interface{}) {
			if name == "end_call" {
				return
			}
			if cfg.ToolsCallbackURL != "" {
				result, err := executeTool(cfg.ToolsCallbackURL, name, tcID, params)
				if err != nil {
					bridge.SendToolResult(tcID, map[string]string{"error": err.Error()})
				} else {
					bridge.SendToolResult(tcID, result)
				}
			} else {
				bridge.SendToolResult(tcID, map[string]string{"error": "tool not configured"})
			}
		}
		if err := bridge.Connect(ctx); err != nil {
			return err
		}
		log.Printf("Registered bridge for call: %s", callID)
		bridge.Start(ctx)
		bridge.CloseConnection()
		return nil
	case "openai":
		return runOpenAI(ctx, cfg, apiKey, rtpConn, callID)
	case "gemini":
		return runGemini(ctx, cfg, apiKey, rtpConn, callID)
	case "deepgram":
		return runDeepgram(ctx, cfg, apiKey, rtpConn, callID)
	case "cartesia":
		return runCartesia(ctx, cfg, apiKey, rtpConn, callID)
	default:
		return fmt.Errorf("unknown provider: %s", cfg.Provider)
	}
}
