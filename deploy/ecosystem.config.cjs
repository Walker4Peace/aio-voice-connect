/**
 * PM2 ecosystem config for AIO Voice Connect API server.
 *
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save              # persist across reboots
 *   pm2 startup           # install PM2 startup script
 *
 * Logs:
 *   pm2 logs api-server
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: "api-server",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/opt/aio-voice-connect",   // ← change to your deploy path

      // Environment variables — set in .env or directly here.
      // Do NOT commit real secrets; use pm2 env or a .env file loaded below.
      env_production: {
        NODE_ENV: "production",
        PORT: "8080",
        // DATABASE_URL and SESSION_SECRET must be set in your shell env
        // or via: pm2 set api-server:DATABASE_URL "postgresql://..."
      },

      // Restart policy
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,

      // Logging
      out_file: "./logs/api-server-out.log",
      error_file: "./logs/api-server-err.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
