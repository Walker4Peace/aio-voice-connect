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
  cookie: {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth gate — public routes are whitelisted inside requireAuth
app.use(requireAuth);

app.use("/api", router);

export default app;
