package main

import (
	"encoding/base64"

	"github.com/zaf/g711"
)

// decodePCMU decodes μ-law bytes to PCM16 little-endian bytes.
func decodePCMU(ulaw []byte) []byte {
	return g711.DecodeUlaw(ulaw)
}

// decodePCMA decodes A-law bytes to PCM16 little-endian bytes.
func decodePCMA(alaw []byte) []byte {
	return g711.DecodeAlaw(alaw)
}

// encodePCMU encodes PCM16 little-endian bytes to μ-law bytes.
func encodePCMU(pcm16 []byte) []byte {
	return g711.EncodeUlaw(pcm16)
}

// pcm16ToBase64 returns base64-encoded PCM16 for sending to ElevenLabs.
func pcm16ToBase64(pcm []byte) string {
	return base64.StdEncoding.EncodeToString(pcm)
}

// base64ToPCM16 decodes base64-encoded PCM16 from ElevenLabs.
func base64ToPCM16(b64 string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(b64)
}

// downsample2x halves the sample rate of PCM16 LE data by averaging pairs.
// Use when ElevenLabs outputs 16kHz and we need 8kHz for RTP.
func downsample2x(pcm16 []byte) []byte {
	if len(pcm16) < 4 {
		return pcm16
	}
	out := make([]byte, len(pcm16)/2)
	j := 0
	for i := 0; i+3 < len(pcm16); i += 4 {
		// Average two consecutive 16-bit samples
		s1 := int16(pcm16[i]) | int16(pcm16[i+1])<<8
		s2 := int16(pcm16[i+2]) | int16(pcm16[i+3])<<8
		avg := (int32(s1) + int32(s2)) / 2
		out[j] = byte(avg)
		out[j+1] = byte(avg >> 8)
		j += 2
	}
	return out[:j]
}
