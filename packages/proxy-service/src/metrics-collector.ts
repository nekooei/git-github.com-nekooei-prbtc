import { ProxyMetrics } from '@mining-proxy/metrics';
import { ProxyEvent, ProxyEventType, StratumMessage } from '@mining-proxy/shared-types';
import { Logger } from '@mining-proxy/logger';

/**
 * Collector subscribes to proxy events and updates Prometheus metrics
 */
export class MetricsCollector {
  private metrics: ProxyMetrics;
  private logger: Logger;
  private pendingRequests = new Map<string, { timestamp: number; labels: any }>();

  constructor(metrics: ProxyMetrics, logger: Logger) {
    this.metrics = metrics;
    this.logger = logger;
  }

  handleEvent(event: ProxyEvent): void {
    const labels = {
      client_id: event.labels.client_id,
      pool_host: event.labels.pool_host,
    };

    switch (event.type) {
      case ProxyEventType.CONNECTION_OPENED:
        this.metrics.activeConnections.inc(labels);
        this.metrics.connectionsTotal.inc(labels);
        if (event.data && typeof event.data === 'object' && 'connect_latency_ms' in event.data) {
          this.metrics.connectLatency
            .labels({ pool_host: event.labels.pool_host })
            .observe((event.data.connect_latency_ms as number) / 1000);
        }
        break;

      case ProxyEventType.CONNECTION_CLOSED:
        this.metrics.activeConnections.dec(labels);
        if (event.data && typeof event.data === 'object' && 'duration_ms' in event.data) {
          this.metrics.connectionDuration
            .labels(labels)
            .observe((event.data.duration_ms as number) / 1000);
        }
        break;

      case ProxyEventType.BYTES_SENT:
        if (event.data && typeof event.data === 'object' && 'bytes' in event.data) {
          this.metrics.bytesSent.inc(labels, event.data.bytes as number);
        }
        break;

      case ProxyEventType.BYTES_RECEIVED:
        if (event.data && typeof event.data === 'object' && 'bytes' in event.data) {
          this.metrics.bytesReceived.inc(labels, event.data.bytes as number);
        }
        break;

      case ProxyEventType.STRATUM_REQUEST:
        this.handleStratumRequest(event);
        break;

      case ProxyEventType.STRATUM_RESPONSE:
        this.handleStratumResponse(event);
        break;

      case ProxyEventType.STRATUM_NOTIFICATION:
        this.handleStratumNotification(event);
        break;

      case ProxyEventType.ERROR:
        if (event.data && typeof event.data === 'object' && 'error' in event.data) {
          this.metrics.connectionErrors.inc({
            ...labels,
            reason: (event.data as any).source || 'unknown',
          });
        }
        break;
    }
  }

  private handleStratumRequest(event: ProxyEvent): void {
    if (!event.data || typeof event.data !== 'object' || !('message' in event.data)) return;
    const msg = (event.data as any).message as StratumMessage;
    const labels = {
      client_id: event.labels.client_id,
      pool_host: event.labels.pool_host,
    };

    if ('method' in msg && msg.method === 'mining.submit') {
      this.metrics.submitsTotal.inc(labels);
      // Track for latency measurement
      if (msg.id !== null) {
        const key = `${event.connection_id}-${msg.id}`;
        this.pendingRequests.set(key, { timestamp: event.timestamp, labels });
      }
    }
  }

  private handleStratumResponse(event: ProxyEvent): void {
    if (!event.data || typeof event.data !== 'object' || !('message' in event.data)) return;
    const msg = (event.data as any).message as StratumMessage;
    const labels = {
      client_id: event.labels.client_id,
      pool_host: event.labels.pool_host,
    };

    if ('id' in msg && msg.id !== null) {
      const key = `${event.connection_id}-${msg.id}`;
      const pending = this.pendingRequests.get(key);
      if (pending) {
        const latency = (event.timestamp - pending.timestamp) / 1000;
        this.metrics.requestResponseLatency.labels(labels).observe(latency);
        this.pendingRequests.delete(key);
      }

      // Check if accepted or rejected
      if ('result' in msg) {
        if (msg.result === true || msg.result === null) {
          this.metrics.acceptedShares.inc(labels);
        }
      }
      if ('error' in msg && msg.error !== null) {
        this.metrics.rejectedShares.inc(labels);
      }
    }
  }

  private handleStratumNotification(event: ProxyEvent): void {
    if (!event.data || typeof event.data !== 'object' || !('message' in event.data)) return;
    const msg = (event.data as any).message as StratumMessage;
    const labels = {
      client_id: event.labels.client_id,
      pool_host: event.labels.pool_host,
    };

    if ('method' in msg && msg.method) {
      this.metrics.notificationsTotal.inc({ ...labels, method: msg.method });

      if (msg.method === 'mining.set_difficulty' && Array.isArray(msg.params) && msg.params[0]) {
        this.metrics.currentDifficulty.set(labels, msg.params[0] as number);
      }
    }
  }
}
