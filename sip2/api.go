package main

import (
	"fmt"
	"log"
	"net/http"
	"sync"
)

// byeHandler is called when POST /bye is received.
var byeHandler func()
var byeHandlerMu sync.Mutex

func setByeHandler(h func()) {
	byeHandlerMu.Lock()
	defer byeHandlerMu.Unlock()
	byeHandler = h
}

func clearByeHandler() {
	byeHandlerMu.Lock()
	defer byeHandlerMu.Unlock()
	byeHandler = nil
}

func startAPIServer(port int) {
	mux := http.NewServeMux()

	mux.HandleFunc("/bye", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		byeHandlerMu.Lock()
		h := byeHandler
		byeHandlerMu.Unlock()
		if h != nil {
			go h()
		}
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"ok":true}`)
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"ok":true}`)
	})

	addr := fmt.Sprintf(":%d", port)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Printf("API server error: %v", err)
	}
}
