import { ConfigLoader } from '@mining-proxy/config';
import { Logger, createLogger } from '@mining-proxy/logger';
import { ProxyMetrics } from '@mining-proxy/metrics';
import { ProxyServer } from '@mining-proxy/proxy-core';
import { MetricsServer } from './metrics-server';
import { MetricsCollector } from './metrics-collector';

async function main() {
  // Load config
  const config = ConfigLoader.load();
  const logger = createLogger({ level: config.proxy.log_level });

  logger.info({ config: config.proxy }, 'Starting mining proxy service');

  // Initialize metrics
  const metrics = new ProxyMetrics();
  const metricsCollector = new MetricsCollector(metrics, logger);

  // Start proxy server
  const proxyServer = new ProxyServer(
    {
      bindAddress: config.proxy.bind_address,
      bindPort: config.proxy.bind_port,
      poolHost: config.proxy.pool_host,
      poolPort: config.proxy.pool_port,
      maxConnections: config.proxy.max_connections,
      connectionTimeoutMs: config.proxy.connection_timeout_ms,
    },
    logger
  );

  // Subscribe to proxy events
  proxyServer.on('event', (event) => {
    metricsCollector.handleEvent(event);
  });

  // Start metrics HTTP server
  const metricsServer = new MetricsServer(metrics, logger);
  await metricsServer.start(config.proxy.metrics_port);

  // Start proxy
  await proxyServer.start();

  logger.info('Mining proxy service running');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await proxyServer.stop();
    await metricsServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
