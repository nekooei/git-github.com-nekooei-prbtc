import * as net from 'net';
import { EventEmitter } from 'events';
import { Logger } from '@mining-proxy/logger';
import { ProxyEvent } from '@mining-proxy/shared-types';
import { ProxyConnection } from './connection';

export interface ProxyServerOptions {
  bindAddress: string;
  bindPort: number;
  poolHost: string;
  poolPort: number;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export class ProxyServer extends EventEmitter {
  private server: net.Server;
  private logger: Logger;
  private options: ProxyServerOptions;
  private connections = new Map<string, ProxyConnection>();
  private clientCounter = 0;
  private recentConnections = new Map<string, number[]>();
  private readonly CONNECTION_THROTTLE_MS = 5000; // 5 seconds
  private readonly MAX_CONNECTIONS_PER_WINDOW = 1; // Max 1 new connection per IP per window

  constructor(options: ProxyServerOptions, logger: Logger) {
    super();
    this.options = options;
    this.logger = logger;
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('error', (err) => {
        this.logger.error({ err }, 'Server error');
        reject(err);
      });

      this.server.listen(this.options.bindPort, this.options.bindAddress, () => {
        this.logger.info(
          { bind: `${this.options.bindAddress}:${this.options.bindPort}` },
          'Proxy server started'
        );
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all connections
      for (const conn of this.connections.values()) {
        conn.removeAllListeners();
      }
      this.connections.clear();

      this.server.close(() => {
        this.logger.info('Proxy server stopped');
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    const clientId = `miner-${++this.clientCounter}`;
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    const clientIp = socket.remoteAddress || 'unknown';

    // Check connection throttling (Fix #1)
    if (this.isThrottled(clientIp)) {
      this.logger.warn({ clientId, clientIp, remoteAddr }, '⚠️  Connection throttled - too many reconnects');
      socket.destroy();
      return;
    }

    // Check max connections
    if (
      this.options.maxConnections &&
      this.connections.size >= this.options.maxConnections
    ) {
      this.logger.warn({ clientId, remoteAddr }, 'Max connections reached, rejecting');
      socket.destroy();
      return;
    }

    // Track this connection attempt
    this.trackConnection(clientIp);

    this.logger.info({ clientId, remoteAddr }, 'New connection');

    const connection = new ProxyConnection(
      socket,
      {
        poolHost: this.options.poolHost,
        poolPort: this.options.poolPort,
        clientId,
        timeoutMs: this.options.connectionTimeoutMs,
        idleTimeoutMs: this.options.idleTimeoutMs,
      },
      this.logger
    );

    this.connections.set(clientId, connection);

    connection.on('event', (event: ProxyEvent) => {
      this.emit('event', event);

      if (event.type === 'connection_closed') {
        this.connections.delete(clientId);
      }
    });
  }

  private isThrottled(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.recentConnections.get(ip) || [];
    
    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(
      (ts) => now - ts < this.CONNECTION_THROTTLE_MS
    );
    
    // Update the map
    if (validTimestamps.length > 0) {
      this.recentConnections.set(ip, validTimestamps);
    } else {
      this.recentConnections.delete(ip);
    }
    
    return validTimestamps.length >= this.MAX_CONNECTIONS_PER_WINDOW;
  }

  private trackConnection(ip: string): void {
    const now = Date.now();
    const timestamps = this.recentConnections.get(ip) || [];
    timestamps.push(now);
    this.recentConnections.set(ip, timestamps);
  }

  getActiveConnections(): number {
    return this.connections.size;
  }
}
