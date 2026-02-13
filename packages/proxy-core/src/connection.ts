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

  constructor(clientSocket: net.Socket, options: ConnectionOptions, logger: Logger) {
    super();
    this.clientSocket = clientSocket;
    this.connectionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.startTime = Date.now();
    this.logger = logger.child({ connection_id: this.connectionId });

    this.labels = {
      client_id: options.clientId,
      client_ip: clientSocket.remoteAddress || 'unknown',
      pool_host: options.poolHost,
      pool_port: options.poolPort,
    };

    // Parsers for observing Stratum messages
    this.parser = new StratumParser((msg) => this.handleClientMessage(msg), logger);
    this.responseParser = new StratumParser((msg) => this.handlePoolMessage(msg), logger);

    this.setupClientSocket();
    this.connectToPool(options.poolHost, options.poolPort, options.timeoutMs);
  }

  private setupClientSocket(): void {
    this.clientSocket.on('data', (data) => {
      if (this.closed) return;
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

    this.clientSocket.on('error', (err) => {
      this.logger.error({ err }, 'Client socket error');
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
      this.emitEvent(ProxyEventType.CONNECTION_OPENED, { connect_latency_ms: latency });
    });

    this.poolSocket.on('data', (data) => {
      if (this.closed) return;
      this.bytesReceived += data.length;
      this.emitEvent(ProxyEventType.BYTES_RECEIVED, { bytes: data.length });

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

    this.poolSocket.on('error', (err) => {
      this.logger.error({ err }, 'Pool socket error');
      this.emitEvent(ProxyEventType.ERROR, { error: err.message, source: 'pool' });
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
    this.logger.debug({ message }, 'Received client message');
    this.emitEvent(ProxyEventType.STRATUM_REQUEST, { message });
  }

  private handlePoolMessage(message: StratumMessage): void {
    this.logger.debug({ message }, 'Received pool message');
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

  private close(): void {
    if (this.closed) return;
    this.closed = true;

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
