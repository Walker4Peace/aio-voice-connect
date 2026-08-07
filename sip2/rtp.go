package main

import (
	"fmt"
	"net"
	"time"

	"github.com/pion/rtp"
)

// RTPConn wraps a UDP conn for RTP send/receive.
type RTPConn struct {
	conn     *net.UDPConn
	Port     int
	remoteIP string
	remotePort int
	seq      uint16
	ts       uint32
	ssrc     uint32
}

// OpenRTPConn binds a UDP socket for RTP on a free port.
func OpenRTPConn() (*RTPConn, error) {
	addr, err := net.ResolveUDPAddr("udp4", "0.0.0.0:0")
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp4", addr)
	if err != nil {
		return nil, err
	}
	port := conn.LocalAddr().(*net.UDPAddr).Port
	fmt.Printf("RTP listener created on 0.0.0.0:%d\n", port)
	return &RTPConn{
		conn: conn,
		Port: port,
		ssrc: 12345678,
	}, nil
}

func (r *RTPConn) SetRemote(ip string, port int) {
	r.remoteIP = ip
	r.remotePort = port
}

func (r *RTPConn) RemoteAddr() string {
	return fmt.Sprintf("%s:%d", r.remoteIP, r.remotePort)
}

// NATHolePunch sends empty packets to open the NAT hole.
func (r *RTPConn) NATHolePunch() error {
	addr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("%s:%d", r.remoteIP, r.remotePort))
	if err != nil {
		return err
	}
	for i := 0; i < 5; i++ {
		r.conn.WriteTo([]byte{0x80, 0x00, 0x00, 0x00}, addr)
		time.Sleep(20 * time.Millisecond)
	}
	return nil
}

// ReadPacket reads one RTP packet. Returns payload and payload type.
func (r *RTPConn) ReadPacket(buf []byte) (payload []byte, pt uint8, err error) {
	n, _, err := r.conn.ReadFromUDP(buf)
	if err != nil {
		return nil, 0, err
	}
	var pkt rtp.Packet
	if err := pkt.Unmarshal(buf[:n]); err != nil {
		return nil, 0, fmt.Errorf("rtp unmarshal: %w", err)
	}
	return pkt.Payload, pkt.PayloadType, nil
}

// SendPacket sends PCM16 data as PCMU RTP.
func (r *RTPConn) SendPacket(pcmuPayload []byte) error {
	addr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("%s:%d", r.remoteIP, r.remotePort))
	if err != nil {
		return err
	}
	pkt := &rtp.Packet{
		Header: rtp.Header{
			Version:        2,
			PayloadType:    0, // PCMU
			SequenceNumber: r.seq,
			Timestamp:      r.ts,
			SSRC:           r.ssrc,
		},
		Payload: pcmuPayload,
	}
	r.seq++
	r.ts += uint32(len(pcmuPayload)) // 8kHz: 1 sample = 1 byte PCMU = 1 timestamp unit

	raw, err := pkt.Marshal()
	if err != nil {
		return err
	}
	_, err = r.conn.WriteTo(raw, addr)
	return err
}

func (r *RTPConn) Close() {
	r.conn.Close()
}

func (r *RTPConn) SetReadDeadline(t time.Time) {
	r.conn.SetReadDeadline(t)
}
