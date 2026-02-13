/**
 * Core Stratum protocol types
 */

export interface StratumRequest {
  id: string | number | null;
  method: string;
  params: unknown[];
}

export interface StratumResponse {
  id: string | number | null;
  result: unknown;
  error: StratumError | null;
}

export interface StratumError {
  code: number;
  message: string;
}

export interface StratumNotification {
  id: null;
  method: string;
  params: unknown[];
}

export type StratumMessage = StratumRequest | StratumResponse | StratumNotification;

/**
 * Mining-specific message types
 */

export interface MiningSubmit {
  method: 'mining.submit';
  params: [string, string, string, string, string]; // [worker, job_id, extranonce2, ntime, nonce]
  id: string | number;
}

export interface MiningNotify {
  method: 'mining.notify';
  params: [string, string, string, string, string[], string, string, string, boolean];
}

export interface MiningSetDifficulty {
  method: 'mining.set_difficulty';
  params: [number];
}

/**
 * Connection and metrics labels
 */

export interface ConnectionLabels {
  client_id: string;
  client_ip: string;
  pool_host: string;
  pool_port: number;
}

export interface MetricLabels {
  client_id: string;
  pool_host: string;
}

/**
 * Configuration schemas
 */

export interface ProxyConfig {
  bind_address: string;
  bind_port: number;
  pool_host: string;
  pool_port: number;
  metrics_port: number;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  max_connections?: number;
  connection_timeout_ms?: number;
  idle_timeout_ms?: number;
}

export interface ClientConfig {
  client_id: string;
  allowed: boolean;
  rate_limit_submits_per_minute?: number;
}

/**
 * Proxy events
 */

export enum ProxyEventType {
  CONNECTION_OPENED = 'connection_opened',
  CONNECTION_CLOSED = 'connection_closed',
  BYTES_SENT = 'bytes_sent',
  BYTES_RECEIVED = 'bytes_received',
  STRATUM_REQUEST = 'stratum_request',
  STRATUM_RESPONSE = 'stratum_response',
  STRATUM_NOTIFICATION = 'stratum_notification',
  SHARE_ACCEPTED = 'share_accepted',
  SHARE_REJECTED = 'share_rejected',
  ERROR = 'error',
}

export interface ProxyEvent {
  type: ProxyEventType;
  timestamp: number;
  connection_id: string;
  labels: ConnectionLabels;
  data?: unknown;
}

export interface ConnectionOpenedEvent extends ProxyEvent {
  type: ProxyEventType.CONNECTION_OPENED;
}

export interface ConnectionClosedEvent extends ProxyEvent {
  type: ProxyEventType.CONNECTION_CLOSED;
  data: {
    duration_ms: number;
    bytes_sent: number;
    bytes_received: number;
  };
}

export interface BytesEvent extends ProxyEvent {
  type: ProxyEventType.BYTES_SENT | ProxyEventType.BYTES_RECEIVED;
  data: {
    bytes: number;
  };
}

export interface StratumEvent extends ProxyEvent {
  type:
    | ProxyEventType.STRATUM_REQUEST
    | ProxyEventType.STRATUM_RESPONSE
    | ProxyEventType.STRATUM_NOTIFICATION;
  data: {
    message: StratumMessage;
  };
}
