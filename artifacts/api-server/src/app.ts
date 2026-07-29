import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { requireAuth } from "./middlewares/auth.js";
import { logger } from "./lib/logger.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {} from "./types/session.js";

const app: Express = express();

// nginx sits in front of Express; trust its X-Forwarded-* headers
app.set("trust proxy", 1);

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

// In the Replit preview the app runs inside a cross-site iframe (replit.com
// embeds an iframe from replit.dev).  Chrome blocks SameSite=Lax cookies set
// from a cross-site iframe, so the session cookie is never stored and every
// request after login looks unauthenticated.  SameSite=None + Secure opts the
// cookie into cross-site delivery — required for any third-party iframe context.
// On the VPS nginx handles HTTPS termination and forwards X-Forwarded-Proto,
// so req.secure is true there too.  The trust-proxy:1 setting above makes
// Express honour that header.
const inReplit = !!process.env["REPL_ID"];
app.use(session({
  secret: process.env["SESSION_SECRET"] ?? "change-me-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: inReplit,           // true in Replit (HTTPS via proxy); false on plain-HTTP VPS
    sameSite: inReplit ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth gate — public routes are whitelisted inside requireAuth
app.use(requireAuth);

app.use("/api", router);

export default app;
