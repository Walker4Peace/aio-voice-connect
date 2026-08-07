package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/emiago/sipgo"
	"github.com/emiago/sipgo/sip"
)

// runOutboundMode places an outbound call and bridges to the AI provider.
func runOutboundMode(ctx context.Context, sipClient *SIPClient, cfg *Config, apiKey string) error {
	ob := cfg.Outbound
	if ob == nil {
		return fmt.Errorf("outbound config required")
	}

	log.Printf("=== OUTBOUND CALLING MODE ===")
	log.Printf("Target: %s", ob.TargetNumber)
	log.Printf("Task: %s", ob.TaskDescription)
	if cfg.ResultWebhook != "" {
		log.Printf("Result webhook: %s", cfg.ResultWebhook)
	}

	// Open RTP socket
	rtpConn, err := OpenRTPConn()
	if err != nil {
		return fmt.Errorf("failed to open RTP: %w", err)
	}
	defer rtpConn.Close()

	// Build SDP offer
	sdpOffer := buildSDPOffer(sipClient.publicIP, rtpConn.Port)

	log.Printf("Initiating outbound call to %s", ob.TargetNumber)
	log.Printf("Sending INVITE to sip:%s@%s", ob.TargetNumber, sipClient.cfg.domain)
	log.Printf("SDP Offer:")
	for _, line := range strings.Split(strings.TrimRight(sdpOffer, "\r\n"), "\n") {
		log.Printf("%s", strings.TrimRight(line, "\r"))
	}
	if sipClient.cfg.outboundProxy != "" {
		log.Printf("Using outbound proxy: %s", sipClient.cfg.outboundProxy)
	}

	// Build the INVITE request
	inviteReq := buildInviteRequest(sipClient, ob.TargetNumber, ob.CallerID, sdpOffer, cfg)

	// Use Dialog API for INVITE (handles auth automatically via WaitAnswer).
	// ClientRequestBuild adds CSeq, CallID, Max-Forwards if missing.
	session, err := sipClient.dialogUA.WriteInvite(ctx, inviteReq, sipgo.ClientRequestBuild)
	if err != nil {
		return fmt.Errorf("INVITE failed: %w", err)
	}

	// WaitAnswer: handles 100/183/401/200 automatically
	// Username/Password enables automatic 401 digest auth
	err = session.WaitAnswer(ctx, sipgo.AnswerOptions{
		Username: sipClient.cfg.authID,
		Password: sipClient.cfg.password,
		OnResponse: func(resp *sip.Response) error {
			switch resp.StatusCode {
			case 100:
				log.Printf("Received 100 Trying")
				log.Printf("Call progress: Trying")
			case 180:
				log.Printf("Received 180 Ringing")
				log.Printf("Call progress: Ringing")
			case 183:
				log.Printf("Received 183 Session Progress")
				log.Printf("Call progress: Session Progress")
			case 401, 407:
				log.Printf("Received 401 Unauthorized")
				log.Printf("First 401 received. Response:")
				logSIPResponse(resp)
			case 200:
				log.Printf("Received 200 OK")
			}
			return nil
		},
	})
	if err != nil {
		return fmt.Errorf("call failed: %w", err)
	}

	log.Printf("Call answered!")

	// Parse remote RTP address from 200 OK SDP
	remoteSDP := string(session.InviteResponse.Body())
	remoteIP, remotePort, err := parseRemoteAudioAddr(remoteSDP)
	if err != nil {
		return fmt.Errorf("parse SDP: %w", err)
	}
	log.Printf("Remote RTP address: %s:%d", remoteIP, remotePort)
	rtpConn.SetRemote(remoteIP, remotePort)

	// Send ACK
	if err := session.Ack(ctx); err != nil {
		log.Printf("ACK error: %v", err)
	}
	log.Printf("ACK sent")

	// NAT hole-punch
	log.Printf("Sending NAT hole-punch packets to %s:%d", remoteIP, remotePort)
	rtpConn.NATHolePunch()

	// Set up BYE handler for /bye HTTP endpoint and inbound BYE
	callCtx, cancelCall := context.WithCancel(ctx)
	defer cancelCall()

	setByeHandler(func() {
		log.Printf("BYE received via /bye endpoint")
		cancelCall()
	})
	defer clearByeHandler()

	// Also handle inbound BYE from the remote party
	sipClient.server.OnBye(func(req *sip.Request, tx sip.ServerTransaction) {
		callID := ""
		if h := req.CallID(); h != nil {
			callID = h.Value()
		}
		log.Printf("BYE received for call: %s", callID)
		resp := sip.NewResponseFromRequest(req, 200, "OK", nil)
		tx.Respond(resp)
		cancelCall()
	})

	// Extract call ID for tracking
	callID := ""
	if h := session.InviteResponse.CallID(); h != nil {
		callID = h.Value()
	}
	if callID == "" {
		callID = fmt.Sprintf("outbound-%s", ob.TargetNumber)
	}

	// Run AI provider bridge
	if err := runOutboundElevenLabs(callCtx, session, cfg, apiKey, rtpConn, callID); err != nil {
		log.Printf("Provider error: %v", err)
	}

	// Send BYE if we haven't received one.
	// Use a short timeout so the binary doesn't block for SIP Timer H (~32 s)
	// if Yeastar is slow to respond.  context.Background() is intentional as
	// the base so SIGTERM (which cancels the main ctx) doesn't race here —
	// we want exactly 5 s regardless of external signals.
	if callCtx.Err() == nil || ob.HangupOnTaskComplete {
		byeCtx, byeCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer byeCancel()
		if err := session.Bye(byeCtx); err != nil {
			log.Printf("BYE send error (ignored): %v", err)
		}
	}

	log.Printf("Outbound call completed. Task completed: %v", true)
	log.Printf("Outbound call completed.")
	return nil
}

func runOutboundElevenLabs(ctx context.Context, session *sipgo.DialogClientSession, cfg *Config, apiKey string, rtpConn *RTPConn, callID string) error {
	if cfg.ElevenLabs == nil {
		return fmt.Errorf("elevenlabs config missing")
	}

	bridge := NewElevenLabsBridge(cfg.ElevenLabs, apiKey, rtpConn, callID)
	taskComplete := false

	bridge.onConvID = func(convID string) {
		log.Printf("ElevenLabs outbound conversation: %s", convID)
	}

	bridge.onToolCall = func(name, tcID string, params map[string]interface{}) {
		if name == "end_call" {
			taskComplete = true
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

	bridge.onConvEnded = func() {
		_ = taskComplete
	}

	if err := bridge.Connect(ctx); err != nil {
		return fmt.Errorf("ElevenLabs connect: %w", err)
	}

	log.Printf("Registered bridge for call: %s", callID)
	log.Printf("Outbound call active - AI is now talking to remote party")
	log.Printf("Starting outbound ElevenLabs to RTP bridge...")
	log.Printf("Starting outbound RTP to ElevenLabs bridge...")

	bridge.Start(ctx)
	bridge.CloseConnection()
	log.Printf("Unregistered bridge for call: %s", callID)
	return nil
}

// buildInviteRequest creates the INVITE request.
func buildInviteRequest(c *SIPClient, target, callerID, sdpOffer string, cfg *Config) *sip.Request {
	host, _ := parseSIPServer(c.cfg.server)

	targetURI := sip.Uri{User: target, Host: c.cfg.domain}
	callID := randomCallID()
	fromTag := randomTag()

	callerDisplay := callerID
	if callerDisplay == "" {
		callerDisplay = c.cfg.username
	}

	req := sip.NewRequest(sip.INVITE, targetURI)
	req.SetTransport(strings.ToUpper(c.cfg.transport))
	req.AppendHeader(sip.NewHeader("From", fmt.Sprintf(`"%s" <sip:%s@%s>;tag=%s`, callerDisplay, c.cfg.username, c.cfg.domain, fromTag)))
	req.AppendHeader(sip.NewHeader("To", fmt.Sprintf("<sip:%s@%s>", target, c.cfg.domain)))
	req.AppendHeader(sip.NewHeader("Call-ID", callID))
	req.AppendHeader(&sip.ContactHeader{
		Address: sip.Uri{User: c.cfg.username, Host: c.publicIP, Port: c.cfg.listenPort},
	})
	req.AppendHeader(sip.NewHeader("Content-Type", "application/sdp"))

	req.SetBody([]byte(sdpOffer))
	// Route through outbound proxy (transparent UDP relay) when configured,
	// otherwise send directly to the PBX. No Route header needed — the proxy
	// relays transparently at the UDP layer.
	if c.cfg.outboundProxy != "" {
		req.SetDestination(c.cfg.outboundProxy)
	} else {
		req.SetDestination(fmt.Sprintf("%s:5060", host))
	}

	return req
}
