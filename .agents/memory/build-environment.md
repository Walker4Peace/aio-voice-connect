---
name: Artifact build environment
description: Required environment variables for this workspace's Vite artifact builds
---

Vite artifact builds in this workspace require the same `PORT` and `BASE_PATH` environment variables that their managed workflows provide. A root build without those variables can fail even when the application typechecks and the managed artifact build is healthy.

**Why:** Artifact Vite configs intentionally validate their runtime routing configuration at load time.

**How to apply:** Use the artifact's configured values for standalone verification, such as `PORT=23208 BASE_PATH=/` for the SIP Agent manager and a dedicated port/base path for Canvas.