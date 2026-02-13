import * as net from 'net';
import { EventEmitter } from 'events';
import { Logger } from '@mining-proxy/logger';
import {
  ProxyEvent,
  ProxyEventType,
  ConnectionLabels,
  StratumMessage,
} from '@mining-proxy/shared-types';
import { StratumParser } from './stratum-parser';

export interface ConnectionOptions {
  poolHost: string;
  poolPort: number;
  clientId: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
}

export class ProxyConnection extends EventEmitter {
  private clientSocket: net.Socket;
  private poolSocket?: net.Socket;
  private connectionId: string;
  private labels: ConnectionLabels;
  private logger: Logger;
  private startTime: number;
  private bytesSent = 0;
  private bytesReceived = 0;
  private parser: StratumParser;
  private responseParser: StratumParser;
  private closed = false;
  private idleTimeoutMs: number;
  private idleTimer?: NodeJS.Timeout;
  private lastActivityTime: number;
  private workerName?: string;

  // Expected network errors that shouldn't be logged as errors
  private static readonly EXPECTED_ERROR_CODES = new Set([
    'ECONNRESET',   // Client disconnected abruptly
    'ETIMEDOUT',    // Connection timeout
    'EPIPE',        // Broken pipe
    'ECONNREFUSED', // Pool refused connection
    'EHOSTUNREACH', // Network unreachable
  ]);

  constructor(clientSocket: net.Socket, options: ConnectionOptions, logger: Logger) {
    super();
    this.clientSocket = clientSocket;
    this.connectionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.startTime = Date.now();
    this.lastActivityTime = Date.now();
    this.idleTimeoutMs = options.idleTimeoutMs || 1800000; // 30 minutes (increased from 5)
    this.logger = logger.child({ connection_id: this.connectionId });

    this.labels = {
      client_id: options.clientId,
      client_ip: clientSocket.remoteAddress || 'unknown',
      pool_host: options.poolHost,
      pool_port: options.poolPort,
    };

    this.logger.info({
      client_id: options.clientId,
      client_ip: clientSocket.remoteAddress,
      pool: `${options.poolHost}:${options.poolPort}`,
      idle_timeout_minutes: this.idleTimeoutMs / 60000
    }, '🔌 New connection established');

    // Parsers for observing Stratum messages
    this.parser = new StratumParser((msg) => this.handleClientMessage(msg), logger);
    this.responseParser = new StratumParser((msg) => this.handlePoolMessage(msg), logger);

    // Enable TCP keepalive on client socket
    this.clientSocket.setKeepAlive(true, 60000); // Send keepalive after 60s idle
    this.clientSocket.setNoDelay(true); // Disable Nagle's algorithm for low latency

    this.setupClientSocket();
    this.connectToPool(options.poolHost, options.poolPort, options.timeoutMs);
    this.startIdleTimer();
  }

  private setupClientSocket(): void {
    this.clientSocket.on('data', (data) => {
      if (this.closed) return;
      this.resetIdleTimer(); // Activity detected
      this.bytesSent += data.length;
      this.emitEvent(ProxyEventType.BYTES_SENT, { bytes: data.length });

      // Parse for metrics
      this.parser.write(data);

      // Forward to pool with backpressure handling
      if (this.poolSocket && !this.poolSocket.destroyed) {
        const canWrite = this.poolSocket.write(data);
        if (!canWrite) {
          // Pool socket buffer is full, pause client
          this.clientSocket.pause();
          this.logger.debug('Client paused due to pool backpressure');
        }
      }
    });

    this.clientSocket.on('error', (err: NodeJS.ErrnoException) => {
      const isExpected = err.code && ProxyConnection.EXPECTED_ERROR_CODES.has(err.code);
      if (isExpected) {
        this.logger.debug({ err: err.message, code: err.code }, 'Client disconnected');
      } else {
        this.logger.error({ err }, 'Client socket error');
      }
      this.close();
    });

    this.clientSocket.on('drain', () => {
      // Client socket buffer drained, resume pool
      if (this.poolSocket && !this.poolSocket.destroyed && this.poolSocket.isPaused()) {
        this.poolSocket.resume();
        this.logger.debug('Pool resumed after client drain');
      }
    });

    this.clientSocket.on('close', () => {
      this.logger.debug('Client socket closed');
      this.close();
    });
  }

  private connectToPool(host: string, port: number, timeoutMs = 10000): void {
    const connectStart = Date.now();
    this.poolSocket = net.createConnection({ host, port, timeout: timeoutMs });

    this.poolSocket.on('connect', () => {
      const latency = Date.now() - connectStart;
      this.logger.info({ latency, pool: `${host}:${port}` }, 'Connected to pool');
      
      // Enable TCP keepalive on pool socket
      this.poolSocket!.setKeepAlive(true, 60000);
      this.poolSocket!.setNoDelay(true);
      
      this.emitEvent(ProxyEventType.CONNECTION_OPENED, { connect_latency_ms: latency });
    });

    this.poolSocket.on('data', (data) => {
      if (this.closed) return;
      this.resetIdleTimer(); // Activity detected
      this.bytesReceived += data.length;
      this.emitEvent(ProxyEventType.BYTES_RECEIVED, { bytes: data.length });

      // Log raw data from pool for debugging
      const preview = data.toString('utf-8', 0, Math.min(200, data.length));
      const hasNewline = data.includes(0x0a); // Check for \n
      this.logger.debug({ 
        bytes: data.length, 
        has_newline: hasNewline,
        preview 
      }, '📥 Raw pool data');

      // Parse for metrics
      this.responseParser.write(data);

      // Forward to client with backpressure handling
      if (!this.clientSocket.destroyed) {
        const canWrite = this.clientSocket.write(data);
        if (!canWrite && this.poolSocket && !this.poolSocket.destroyed) {
          // Client socket buffer is full, pause pool
          this.poolSocket.pause();
          this.logger.debug('Pool paused due to client backpressure');
        }
      }
    });

    this.poolSocket.on('drain', () => {
      // Pool socket buffer drained, resume client
      if (!this.clientSocket.destroyed && this.clientSocket.isPaused()) {
        this.clientSocket.resume();
        this.logger.debug('Client resumed after pool drain');
      }
    });

    this.poolSocket.on('error', (err: NodeJS.ErrnoException) => {
      const isExpected = err.code && ProxyConnection.EXPECTED_ERROR_CODES.has(err.code);
      if (isExpected) {
        this.logger.info({ err: err.message, code: err.code }, 'Pool connection error');
      } else {
        this.logger.error({ err }, 'Pool socket error');
      }
      this.emitEvent(ProxyEventType.ERROR, { error: err.message, source: 'pool', code: err.code });
      this.close();
    });

    this.poolSocket.on('timeout', () => {
      this.logger.warn('Pool socket timeout');
      this.close();
    });

    this.poolSocket.on('close', () => {
      this.logger.debug('Pool socket closed');
      this.close();
    });
  }

  private handleClientMessage(message: StratumMessage): void {
    // Log ALL client messages for protocol debugging
    this.logger.info({ 
      message,
      worker: this.workerName || 'unknown',
      current_client_id: this.labels.client_id 
    }, 'CLIENT→POOL');
    
    // Extract worker name from mining.authorize BEFORE emitting event
    if ('method' in message && message.method === 'mining.authorize' && Array.isArray(message.params) && message.params[0]) {
      const newWorkerName = String(message.params[0]);
      if (!this.workerName && newWorkerName) {
        this.workerName = newWorkerName;
        const oldClientId = this.labels.client_id;
        this.labels.client_id = newWorkerName;
        this.logger = this.logger.child({ worker: newWorkerName });
        this.logger.info({ 
          old_id: oldClientId,
          new_id: newWorkerName,
          method: 'mining.authorize'
        }, '🎯 Worker identified - updating all future events');
      }
    }

    // Log mining.submit with details
    if ('method' in message && message.method === 'mining.submit') {
      this.logger.info({
        id: 'id' in message ? message.id : null,
        worker: Array.isArray(message.params) && message.params[0] ? message.params[0] : 'unknown',
        job_id: Array.isArray(message.params) && message.params[1] ? message.params[1] : 'unknown',
      }, '⛏️  Share submitted');
    }

    // Log mining.subscribe
    if ('method' in message && message.method === 'mining.subscribe') {
      this.logger.info({ 
        id: 'id' in message ? message.id : null,
        params: message.params
      }, '📡 Mining subscribe');
    }
    
    this.emitEvent(ProxyEventType.STRATUM_REQUEST, { message });
  }

  private handlePoolMessage(message: StratumMessage): void {
    // Log ALL pool messages for protocol debugging
    this.logger.info({ 
      message,
      worker: this.workerName || 'unknown',
      current_client_id: this.labels.client_id
    }, 'POOL→CLIENT');

    // Log mining.set_difficulty
    if ('method' in message && message.method === 'mining.set_difficulty') {
      const difficulty = Array.isArray(message.params) && message.params[0] ? message.params[0] : 'unknown';
      this.logger.info({ difficulty }, '🎯 Difficulty set');
    }

    // Log mining.notify (new job)
    if ('method' in message && message.method === 'mining.notify') {
      const jobId = Array.isArray(message.params) && message.params[0] ? message.params[0] : 'unknown';
      this.logger.info({ job_id: jobId }, '📋 New mining job');
    }

    // Log subscribe response
    if ('result' in message && 'id' in message && message.id !== null) {
      const result = message.result;
      if (Array.isArray(result) && result.length >= 2) {
        // Looks like subscribe response
        this.logger.info({ 
          id: message.id,
          session_id: result[0],
          extranonce1: result[1]
        }, '✅ Subscribe response');
      } else if (result === true) {
        this.logger.info({ id: message.id }, '✅ Request accepted');
      } else if (result === false) {
        this.logger.warn({ id: message.id }, '❌ Request rejected');
      }
    }

    // Log errors
    if ('error' in message && message.error !== null) {
      this.logger.warn({ 
        id: 'id' in message ? message.id : null,
        error: message.error 
      }, '❌ Error response');
    }
    
    if ('method' in message && message.method) {
      this.emitEvent(ProxyEventType.STRATUM_NOTIFICATION, { message });
    } else {
      this.emitEvent(ProxyEventType.STRATUM_RESPONSE, { message });
    }
  }

  private emitEvent(type: ProxyEventType, data?: unknown): void {
    const event: ProxyEvent = {
      type,
      timestamp: Date.now(),
      connection_id: this.connectionId,
      labels: this.labels,
      data,
    };
    this.emit('event', event);
  }

  private startIdleTimer(): void {
    this.idleTimer = setTimeout(() => {
      const idleTime = Date.now() - this.lastActivityTime;
      this.logger.warn({ 
        idle_ms: idleTime,
        idle_minutes: (idleTime / 60000).toFixed(2),
        worker: this.workerName || 'unknown',
        shares_period: 'Low hashrate miner - increase idle_timeout_ms if needed'
      }, '⏰ Idle timeout - closing connection');
      this.close();
    }, this.idleTimeoutMs);
  }

  private resetIdleTimer(): void {
    this.lastActivityTime = Date.now();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (!this.closed) {
      this.startIdleTimer();
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;

    // Clear idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    const duration = Date.now() - this.startTime;

    if (!this.clientSocket.destroyed) {
      this.clientSocket.destroy();
    }
    if (this.poolSocket && !this.poolSocket.destroyed) {
      this.poolSocket.destroy();
    }

    this.emitEvent(ProxyEventType.CONNECTION_CLOSED, {
      duration_ms: duration,
      bytes_sent: this.bytesSent,
      bytes_received: this.bytesReceived,
    });

    this.logger.info(
      { duration_ms: duration, bytes_sent: this.bytesSent, bytes_received: this.bytesReceived },
      'Connection closed'
    );

    this.removeAllListeners();
  }

  public getLabels(): ConnectionLabels {
    return { ...this.labels };
  }
}
