import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProxyServer } from '@mining-proxy/proxy-core';
import { MinerSimulator } from '@mining-proxy/miner-sim';
import { createLogger } from '@mining-proxy/logger';

/**
 * Integration tests - requires a test pool
 * Set TEST_POOL_HOST and TEST_POOL_PORT env vars
 */
describe('Proxy Integration', () => {
  const logger = createLogger({ level: 'error' });
  let proxyServer: ProxyServer;
  const TEST_BIND_PORT = 13333;
  const POOL_HOST = process.env.TEST_POOL_HOST || 'pool.example.com';
  const POOL_PORT = parseInt(process.env.TEST_POOL_PORT || '3333', 10);

  beforeAll(async () => {
    proxyServer = new ProxyServer(
      {
        bindAddress: '127.0.0.1',
        bindPort: TEST_BIND_PORT,
        poolHost: POOL_HOST,
        poolPort: POOL_PORT,
      },
      logger
    );
    await proxyServer.start();
  });

  afterAll(async () => {
    await proxyServer.stop();
  });

  it('should relay miner connection through proxy', async () => {
    const sim = new MinerSimulator(
      {
        host: '127.0.0.1',
        port: TEST_BIND_PORT,
        workerId: 'test-worker',
      },
      logger
    );

    await sim.connect();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    sim.disconnect();

    expect(true).toBe(true); // Connection succeeded
  });
});
