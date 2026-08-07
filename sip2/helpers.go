package main

import (
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"strings"
	"time"
)

func getPublicIP() string {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("http://ipv4.icanhazip.com")
	if err != nil {
		return getLocalIP()
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return getLocalIP()
	}
	ip := strings.TrimSpace(string(body))
	if net.ParseIP(ip) == nil {
		return getLocalIP()
	}
	return ip
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "127.0.0.1"
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return "127.0.0.1"
}

func buildSDPOffer(publicIP string, rtpPort int) string {
	r1 := rand.Int63()
	r2 := rand.Int63()
	return fmt.Sprintf(
		"v=0\r\n"+
			"o=- %d %d IN IP4 %s\r\n"+
			"s=-\r\n"+
			"c=IN IP4 %s\r\n"+
			"t=0 0\r\n"+
			"m=audio %d RTP/AVP 0 8 18 101\r\n"+
			"a=rtpmap:0 PCMU/8000\r\n"+
			"a=rtpmap:8 PCMA/8000\r\n"+
			"a=rtpmap:18 G729/8000\r\n"+
			"a=rtpmap:101 telephone-event/8000\r\n"+
			"a=fmtp:101 0-16\r\n"+
			"a=ptime:20\r\n"+
			"a=sendrecv\r\n",
		r1, r2, publicIP, publicIP, rtpPort,
	)
}

// parseRemoteAudioAddr extracts the remote IP and RTP port from SDP body.
func parseRemoteAudioAddr(sdp string) (string, int, error) {
	var ip string
	var port int
	for _, line := range strings.Split(sdp, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "c=IN IP4 ") {
			ip = strings.TrimPrefix(line, "c=IN IP4 ")
			ip = strings.TrimSpace(ip)
		}
		if strings.HasPrefix(line, "m=audio ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &port)
			}
		}
	}
	if ip == "" || port == 0 {
		return "", 0, fmt.Errorf("could not parse remote audio address from SDP")
	}
	return ip, port, nil
}

// freeUDPPort finds a free UDP port.
func freeUDPPort() (int, error) {
	addr, err := net.ResolveUDPAddr("udp", "0.0.0.0:0")
	if err != nil {
		return 0, err
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return 0, err
	}
	port := conn.LocalAddr().(*net.UDPAddr).Port
	conn.Close()
	return port, nil
}

// parseSIPServer splits "host:port" into host and port (default 5060).
func parseSIPServer(server string) (string, int) {
	host, portStr, err := net.SplitHostPort(server)
	if err != nil {
		return server, 5060
	}
	var port int
	fmt.Sscanf(portStr, "%d", &port)
	return host, port
}

// randomTag generates a random SIP tag.
func randomTag() string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// randomCallID generates a random SIP Call-ID.
func randomCallID() string {
	return fmt.Sprintf("%s-%d", randomTag(), rand.Int63())
}
