import { z } from 'zod';
import { ProxyConfig, ClientConfig } from '@mining-proxy/shared-types';

const ProxyConfigSchema = z.object({
  bind_address: z.string().default('0.0.0.0'),
  bind_port: z.number().int().min(1).max(65535).default(3333),
  pool_host: z.string(),
  pool_port: z.number().int().min(1).max(65535),
  metrics_port: z.number().int().min(1).max(65535).default(9090),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  max_connections: z.number().int().positive().optional().default(100),
  connection_timeout_ms: z.number().int().positive().optional().default(30000),
  idle_timeout_ms: z.number().int().positive().optional().default(300000),
});

const ClientConfigSchema = z.object({
  client_id: z.string(),
  allowed: z.boolean().default(true),
  rate_limit_submits_per_minute: z.number().int().positive().optional(),
});

const ConfigSchema = z.object({
  proxy: ProxyConfigSchema,
  clients: z.array(ClientConfigSchema).optional().default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ValidatedProxyConfig = z.infer<typeof ProxyConfigSchema>;

export class ConfigLoader {
  static fromEnv(): ValidatedProxyConfig {
    return ProxyConfigSchema.parse({
      bind_address: process.env.BIND_ADDRESS,
      bind_port: process.env.BIND_PORT ? parseInt(process.env.BIND_PORT, 10) : undefined,
      pool_host: process.env.POOL_HOST,
      pool_port: process.env.POOL_PORT ? parseInt(process.env.POOL_PORT, 10) : undefined,
      metrics_port: process.env.METRICS_PORT
        ? parseInt(process.env.METRICS_PORT, 10)
        : undefined,
      log_level: process.env.LOG_LEVEL,
      max_connections: process.env.MAX_CONNECTIONS
        ? parseInt(process.env.MAX_CONNECTIONS, 10)
        : undefined,
      connection_timeout_ms: process.env.CONNECTION_TIMEOUT_MS
        ? parseInt(process.env.CONNECTION_TIMEOUT_MS, 10)
        : undefined,
      idle_timeout_ms: process.env.IDLE_TIMEOUT_MS
        ? parseInt(process.env.IDLE_TIMEOUT_MS, 10)
        : undefined,
    });
  }

  static fromJSON(obj: unknown): Config {
    return ConfigSchema.parse(obj);
  }

  static load(): Config {
    if (process.env.CONFIG_FILE) {
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE, 'utf-8'));
      return ConfigSchema.parse(data);
    }

    // Fallback to env
    return {
      proxy: this.fromEnv(),
      clients: [],
    };
  }
}
