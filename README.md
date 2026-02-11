# Mining Proxy Monorepo

A transparent Stratum mining proxy with comprehensive metrics and billing support, built with TypeScript in a pnpm monorepo.

## Features

- **Transparent TCP relay**: Forwards Stratum traffic without modification
- **Prometheus metrics**: Comprehensive observability (connections, bytes, shares, latency)
- **Stratum protocol parsing**: Non-invasive inspection for metrics only
- **Billing-ready**: Track bytes transferred and accepted shares per client
- **Production-grade**: Structured logging, graceful shutdown, health checks
- **Type-safe**: Full TypeScript with strict typing
- **Testable**: Includes miner simulator and integration tests

## Architecture

```
packages/
├── shared-types      # Common TypeScript interfaces
├── logger           # Pino logging wrapper
├── config           # Config loader with Zod validation
├── metrics          # Prometheus metrics definitions
├── proxy-core       # TCP relay + Stratum parser
├── proxy-service    # Main runtime (wires everything)
├── miner-sim        # Miner simulator for testing
└── integration-tests # End-to-end tests
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- pnpm 8+

### Installation

```bash
pnpm install
pnpm build
```

### Configuration

Create `config.json`:

```json
{
  "proxy": {
    "bind_address": "0.0.0.0",
    "bind_port": 3333,
    "pool_host": "pool.example.com",
    "pool_port": 3333,
    "metrics_port": 9090,
    "log_level": "info",
    "max_connections": 100,
    "connection_timeout_ms": 30000,
    "idle_timeout_ms": 300000
  },
  "clients": []
}
```

Or use environment variables:

```bash
export POOL_HOST=pool.example.com
export POOL_PORT=3333
export BIND_PORT=3333
export METRICS_PORT=9090
export LOG_LEVEL=info
```

### Run

```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start

# Or with explicit config
CONFIG_FILE=./config.json pnpm start
```

### Access Metrics

```bash
# Prometheus metrics
curl http://localhost:9090/metrics

# Health check
curl http://localhost:9090/healthz

# Status
curl http://localhost:9090/status
```

## Metrics & Billing

### Key Metrics

**Connection metrics:**
- `stratum_active_connections` - Current active connections
- `stratum_connections_total` - Total connections count
- `stratum_connection_duration_seconds` - Connection duration histogram

**Throughput metrics:**
- `stratum_bytes_sent_total` - Bytes sent to pool (per client_id, pool_host)
- `stratum_bytes_received_total` - Bytes received from pool
  
**Stratum metrics:**
- `stratum_submits_total` - Total submit requests
- `stratum_accepted_shares_total` - Accepted shares
- `stratum_rejected_shares_total` - Rejected shares
- `stratum_notifications_total` - Notifications from pool

**Latency metrics:**
- `stratum_connect_latency_seconds` - Pool connection latency
- `stratum_request_response_seconds` - Request-response roundtrip

### Billing Queries (PromQL)

**Bytes transferred (30d):**
```promql
sum(increase(stratum_bytes_sent_total{client_id="miner1"}[30d]) + 
    increase(stratum_bytes_received_total{client_id="miner1"}[30d]))
```

**Accepted shares (30d):**
```promql
increase(stratum_accepted_shares_total{client_id="miner1"}[30d])
```

**Reject rate:**
```promql
rate(stratum_rejected_shares_total[5m]) / rate(stratum_submits_total[5m])
```

## Development

### Workspace Commands

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint

# Format
pnpm format

# Type check
pnpm typecheck

# Clean
pnpm clean
```

### Package Commands

```bash
# Work on specific package
pnpm --filter proxy-core build
pnpm --filter proxy-service dev

# Add dependency to package
pnpm --filter proxy-core add lodash
```

### Testing

```bash
# Unit tests
pnpm test

# Integration tests (requires test pool)
export TEST_POOL_HOST=pool.example.com
export TEST_POOL_PORT=3333
pnpm test:integration

# Miner simulator
pnpm --filter miner-sim build
node packages/miner-sim/dist/index.js
```

## Deployment

### Docker

```bash
docker build -t mining-proxy -f docker/Dockerfile .
docker run -p 3333:3333 -p 9090:9090 \
  -e POOL_HOST=pool.example.com \
  -e POOL_PORT=3333 \
  mining-proxy
```

### systemd

```bash
sudo cp infra/mining-proxy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mining-proxy
sudo journalctl -u mining-proxy -f
```

## Production Checklist

- [ ] Set appropriate `max_connections` based on expected load
- [ ] Tune OS limits: `ulimit -n 65535`
- [ ] Configure Prometheus scraping
- [ ] Set up Grafana dashboards
- [ ] Enable log rotation
- [ ] Configure alerts (high reject rate, connection errors)
- [ ] Test failover scenarios
- [ ] Document billing procedures

## Monitoring & Alerts

**Recommended Prometheus recording rules:**

```yaml
groups:
  - name: mining_proxy
    interval: 60s
    rules:
      - record: mining:bytes_total:30d
        expr: increase(stratum_bytes_sent_total[30d]) + increase(stratum_bytes_received_total[30d])
      
      - record: mining:accepted_shares:30d
        expr: increase(stratum_accepted_shares_total[30d])
```

**Recommended alerts:**
- High reject rate (>5%)
- High connection error rate
- P95 latency > 500ms
- Active connections > 90% of max

## License

MIT

## Support

For issues and questions, see the project repository.
