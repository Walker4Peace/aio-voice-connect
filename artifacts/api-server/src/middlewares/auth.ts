import type { Request, Response, NextFunction } from "express";

// Routes that don't require authentication
const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/setup",
  "/api/auth",
  // Outbound call trigger — uses X-Api-Key instead of session auth
  "/api/outbound/call",
  // Context endpoint consumed by sip-agent at call start (internal)
  "/api/outbound/context/",
  // Tool execution callback from sip-agent during a call (internal)
  "/api/tools/execute",
];

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const isPublic = PUBLIC_PREFIXES.some(p => req.path.startsWith(p));
  if (isPublic) { next(); return; }

  if (!req.session?.adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
