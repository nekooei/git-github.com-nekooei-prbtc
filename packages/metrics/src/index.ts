import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { MetricLabels } from '@mining-proxy/shared-types';

export class ProxyMetrics {
  private registry: Registry;

  // Connection metrics
  public activeConnections: Gauge<'client_id' | 'pool_host'>;
  public connectionsTotal: Counter<'client_id' | 'pool_host'>;
  public connectionErrors: Counter<'client_id' | 'pool_host' | 'reason'>;
  public connectionDuration: Histogram<'client_id' | 'pool_host'>;

  // Throughput metrics
  public bytesSent: Counter<'client_id' | 'pool_host'>;
  public bytesReceived: Counter<'client_id' | 'pool_host'>;

  // Stratum-level metrics
  public submitsTotal: Counter<'client_id' | 'pool_host'>;
  public acceptedShares: Counter<'client_id' | 'pool_host'>;
  public rejectedShares: Counter<'client_id' | 'pool_host'>;
  public notificationsTotal: Counter<'client_id' | 'pool_host' | 'method'>;
  public currentDifficulty: Gauge<'client_id' | 'pool_host'>;
  public malformedRpc: Counter<'client_id' | 'pool_host'>;

  // Latency metrics
  public connectLatency: Histogram<'pool_host'>;
  public requestResponseLatency: Histogram<'client_id' | 'pool_host'>;

  constructor() {
    this.registry = new Registry();

    // Enable default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register: this.registry });

    // Connection metrics
    this.activeConnections = new Gauge({
      name: 'stratum_active_connections',
      help: 'Number of active client connections',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.connectionsTotal = new Counter({
      name: 'stratum_connections_total',
      help: 'Total number of connections established',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.connectionErrors = new Counter({
      name: 'stratum_connection_errors_total',
      help: 'Total connection errors',
      labelNames: ['client_id', 'pool_host', 'reason'],
      registers: [this.registry],
    });

    this.connectionDuration = new Histogram({
      name: 'stratum_connection_duration_seconds',
      help: 'Connection duration in seconds',
      labelNames: ['client_id', 'pool_host'],
      buckets: [1, 10, 60, 300, 600, 1800, 3600, 7200],
      registers: [this.registry],
    });

    // Throughput
    this.bytesSent = new Counter({
      name: 'stratum_bytes_sent_total',
      help: 'Total bytes sent to pool',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.bytesReceived = new Counter({
      name: 'stratum_bytes_received_total',
      help: 'Total bytes received from pool',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    // Stratum-level
    this.submitsTotal = new Counter({
      name: 'stratum_submits_total',
      help: 'Total mining submit requests',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.acceptedShares = new Counter({
      name: 'stratum_accepted_shares_total',
      help: 'Total accepted shares',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.rejectedShares = new Counter({
      name: 'stratum_rejected_shares_total',
      help: 'Total rejected shares',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.notificationsTotal = new Counter({
      name: 'stratum_notifications_total',
      help: 'Total Stratum notifications received',
      labelNames: ['client_id', 'pool_host', 'method'],
      registers: [this.registry],
    });

    this.currentDifficulty = new Gauge({
      name: 'stratum_current_difficulty',
      help: 'Current mining difficulty',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    this.malformedRpc = new Counter({
      name: 'stratum_malformed_rpc_total',
      help: 'Total malformed JSON-RPC messages',
      labelNames: ['client_id', 'pool_host'],
      registers: [this.registry],
    });

    // Latency
    this.connectLatency = new Histogram({
      name: 'stratum_connect_latency_seconds',
      help: 'Time to establish pool connection',
      labelNames: ['pool_host'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.requestResponseLatency = new Histogram({
      name: 'stratum_request_response_seconds',
      help: 'Request-response latency',
      labelNames: ['client_id', 'pool_host'],
      buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2],
      registers: [this.registry],
    });
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
