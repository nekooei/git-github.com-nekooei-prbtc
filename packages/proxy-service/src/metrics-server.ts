import express, { Request, Response } from 'express';
import { ProxyMetrics } from '@mining-proxy/metrics';
import { Logger } from '@mining-proxy/logger';

export class MetricsServer {
  private app: express.Application;
  private metrics: ProxyMetrics;
  private logger: Logger;
  private server?: any;

  constructor(metrics: ProxyMetrics, logger: Logger) {
    this.app = express();
    this.metrics = metrics;
    this.logger = logger;

    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get('/metrics', async (req: Request, res: Response) => {
      try {
        res.set('Content-Type', this.metrics.getRegistry().contentType);
        const metrics = await this.metrics.getMetrics();
        res.end(metrics);
      } catch (err) {
        this.logger.error({ err }, 'Error serving metrics');
        res.status(500).end();
      }
    });

    this.app.get('/healthz', (req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', timestamp: Date.now() });
    });

    this.app.get('/status', (req: Request, res: Response) => {
      res.status(200).json({
        status: 'running',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: Date.now(),
      });
    });
  }

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.logger.info({ port }, 'Metrics server started');
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Metrics server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
