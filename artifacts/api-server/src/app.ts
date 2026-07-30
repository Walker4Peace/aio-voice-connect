import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { requireAuth } from "./middlewares/auth.js";
import { logger } from "./lib/logger.js";
import { addSystemLog } from "./services/deployment.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {} from "./types/session.js";

// In the Replit preview the app runs inside a cross-site iframe (replit.com
// embeds an iframe from *.replit.dev).  Chrome blocks SameSite=Lax cookies in
// that context, so the session cookie is never stored and every request after
// login appears unauthenticated.
//
// Fix: use SameSite=None + Secure in Replit, which opts the cookie into
// cross-site delivery.  We also force req.secure=true via middleware because
// Replit's internal container router (the extra hop between the HTTPS edge
// proxy and Express) doesn't reliably forward X-Forwarded-Proto.
const inReplit = !!process.env["REPL_ID"];

const app: Express = express();

// Trust all proxy hops in Replit (edge proxy + internal container router).
// On the VPS trust exactly one hop (nginx).
app.set("trust proxy", inReplit ? true : 1);

// In Replit, inject X-Forwarded-Proto: https before session middleware runs.
// express-session's issecure() reads this header directly (not req.secure), so
// without it the Secure cookie is never set even when trust proxy is enabled.
// Replit's edge proxy terminates HTTPS but the internal container router does
// not reliably forward X-Forwarded-Proto to Express.
if (inReplit) {
  app.use((req, _res, next) => {
    req.headers["x-forwarded-proto"] = "https";
    next();
  });
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// CORS — allow credentials so session cookies work with the Vite dev proxy
app.use(cors({
  origin: true,
  credentials: true,
}));

// Session middleware
app.use(session({
  secret: process.env["SESSION_SECRET"] ?? "change-me-in-production",
  resave: false,
  saveUninitialized: false,
  proxy: inReplit ? true : undefined, // tell express-session to trust the proxy for secure cookies
  cookie: {
    httpOnly: true,
    secure: inReplit,                   // Secure flag required for SameSite=None
    sameSite: inReplit ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,   // 7 days
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log mutating HTTP requests to the system log buffer (skip polls/healthz)
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    res.on("finish", () => {
      const url = (req.originalUrl ?? req.path).split("?")[0];
      addSystemLog(`${method} ${url} → ${res.statusCode}`, "HTTP");
    });
  }
  next();
});

// Auth gate — public routes are whitelisted inside requireAuth
app.use(requireAuth);

app.use("/api", router);

export default app;
