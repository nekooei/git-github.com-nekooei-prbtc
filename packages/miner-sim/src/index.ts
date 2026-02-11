import * as net from 'net';
import { Logger, createLogger } from '@mining-proxy/logger';

export interface MinerSimOptions {
  host: string;
  port: number;
  workerId: string;
  submitIntervalMs?: number;
}

/**
 * Simple miner simulator for testing
 * Sends realistic Stratum messages
 */
export class MinerSimulator {
  private socket?: net.Socket;
  private logger: Logger;
  private options: MinerSimOptions;
  private messageId = 1;
  private connected = false;
  private submitTimer?: NodeJS.Timeout;

  constructor(options: MinerSimOptions, logger?: Logger) {
    this.options = options;
    this.logger = logger || createLogger({ level: 'info' });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(
        { host: this.options.host, port: this.options.port },
        () => {
          this.logger.info('Connected to pool/proxy');
          this.connected = true;
          this.setupSocket();
          resolve();
        }
      );

      this.socket.on('error', (err) => {
        this.logger.error({ err }, 'Socket error');
        reject(err);
      });
    });
  }

  private setupSocket(): void {
    if (!this.socket) return;

    this.socket.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line) => {
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch (err) {
          // Ignore malformed
        }
      });
    });

    this.socket.on('close', () => {
      this.logger.info('Disconnected');
      this.connected = false;
      if (this.submitTimer) {
        clearInterval(this.submitTimer);
      }
    });

    // Send subscribe
    this.send({
      id: this.messageId++,
      method: 'mining.subscribe',
      params: ['MinerSim/1.0.0'],
    });

    // Send authorize
    this.send({
      id: this.messageId++,
      method: 'mining.authorize',
      params: [this.options.workerId, 'x'],
    });

    // Start submitting shares
    if (this.options.submitIntervalMs) {
      this.submitTimer = setInterval(() => {
        this.submitShare();
      }, this.options.submitIntervalMs);
    }
  }

  private handleMessage(msg: any): void {
    this.logger.debug({ msg }, 'Received message');

    if (msg.method === 'mining.notify') {
      this.logger.info('Received mining.notify');
    } else if (msg.method === 'mining.set_difficulty') {
      this.logger.info({ difficulty: msg.params?.[0] }, 'Received set_difficulty');
    } else if (msg.id && msg.result !== undefined) {
      if (msg.result === true) {
        this.logger.info({ id: msg.id }, 'Share accepted');
      } else if (msg.error) {
        this.logger.warn({ id: msg.id, error: msg.error }, 'Share rejected');
      }
    }
  }

  private submitShare(): void {
    if (!this.connected) return;

    const share = {
      id: this.messageId++,
      method: 'mining.submit',
      params: [
        this.options.workerId,
        'job_' + Date.now(),
        '00000000',
        Math.floor(Date.now() / 1000).toString(16),
        Math.random().toString(16).substr(2, 8),
      ],
    };

    this.send(share);
    this.logger.debug({ id: share.id }, 'Submitted share');
  }

  private send(msg: any): void {
    if (this.socket && this.connected) {
      this.socket.write(JSON.stringify(msg) + '\n');
    }
  }

  disconnect(): void {
    if (this.submitTimer) {
      clearInterval(this.submitTimer);
    }
    if (this.socket) {
      this.socket.destroy();
    }
  }
}
