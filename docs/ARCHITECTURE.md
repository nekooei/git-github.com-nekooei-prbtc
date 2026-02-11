# Architecture Overview

## System Design

### High-Level Architecture

```
┌─────────────┐          ┌─────────────────┐          ┌──────────────┐
│   Miners    │─────────▶│  Mining Proxy   │─────────▶│ Mining Pool  │
│  (Stratum)  │  TCP     │   (Relay)       │  TCP     │  (External)  │
└─────────────┘  3333    └─────────────────┘  3333    └──────────────┘
                                 │
                                 │ Metrics
                                 ▼
                          ┌─────────────┐
                          │ Prometheus  │
                          │  :9090      │
                          └─────────────┘
                                 │
                                 ▼
                          ┌─────────────┐
                          │  Grafana    │
                          │  Dashboard  │
                          └─────────────┘
```

## Components

### 1. shared-types

**Purpose:** Common TypeScript interfaces and types used across all packages.

**Key Types:**
- `StratumMessage` - JSON-RPC protocol types
- `ProxyEvent` - Event bus for internal communication
- `ProxyConfig` - Configuration schema
- `ConnectionLabels` - Metric label types

**Why separate:** Type definitions change infrequently and are imported by many packages. Separating prevents circular dependencies and improves build caching.

### 2. logger

**Purpose:** Structured logging with pino.

**Features:**
- JSON structured logs in production
- Pretty-printed logs in development
- Child loggers with bound context
- Minimal overhead

**Why pino:** Fastest Node.js logger, production-proven.

### 3. config

**Purpose:** Type-safe configuration loading with validation.

**Features:**
- Zod schema validation
- Environment variable support
- JSON config file support
- Sensible defaults

**Loading priority:**
1. CONFIG_FILE env var → load JSON
2. Individual env vars (POOL_HOST, etc.)
3. Defaults from schema

### 4. metrics

**Purpose:** Prometheus metrics definitions and registry.

**Metrics Schema:**
```
Counters (monotonic):
- stratum_connections_total
- stratum_bytes_sent_total
- stratum_bytes_received_total
- stratum_submits_total
- stratum_accepted_shares_total
- stratum_rejected_shares_total

Gauges (current value):
- stratum_active_connections
- stratum_current_difficulty

Histograms (distribution):
- stratum_connection_duration_seconds
- stratum_connect_latency_seconds
- stratum_request_response_seconds
```

**Label Cardinality:** Limited to `client_id`, `pool_host`, `method` to prevent metric explosion.

### 5. proxy-core

**Purpose:** Core TCP relay and Stratum protocol parsing logic.

**Key Classes:**

#### ProxyServer
- Listens for miner connections
- Spawns ProxyConnection per client
- Manages connection pool and limits
- Emits lifecycle events

#### ProxyConnection
- Bidirectional TCP relay (miner ↔ pool)
- Non-blocking streaming parser
- Observes Stratum messages for metrics
- Does NOT modify payloads
- Emits events for bytes, messages, errors

#### StratumParser
- Streaming JSON-RPC parser (uses `jsonparse`)
- Handles fragmented/concatenated messages
- Pass-through transform (observes, doesn't mutate)
- Tolerates malformed JSON

**Design Principle:** Core has zero dependencies on HTTP, metrics, or config. It's a pure relay with an event bus. This makes it testable and replaceable.

### 6. proxy-service

**Purpose:** Runtime glue - wires core, metrics, config, HTTP.

**Key Classes:**

#### MetricsServer
- Express HTTP server
- Exposes `/metrics` (Prometheus scrape target)
- Exposes `/healthz` and `/status`
- Runs on separate port from proxy

#### MetricsCollector
- Subscribes to ProxyServer events
- Updates Prometheus counters/gauges/histograms
- Correlates submit requests with responses for latency
- Tracks pending requests by connection_id + request_id

#### Main (index.ts)
- Loads config
- Creates logger, metrics, collector
- Starts ProxyServer and MetricsServer
- Handles graceful shutdown (SIGINT/SIGTERM)

### 7. miner-sim

**Purpose:** Miner simulator for integration testing.

**Features:**
- Connects to proxy or pool
- Sends realistic Stratum messages (subscribe, authorize, submit)
- Configurable submit rate
- Parses responses and logs accepted/rejected

**Use Case:** End-to-end testing without real miners.

### 8. integration-tests

**Purpose:** End-to-end tests using miner-sim and proxy-core.

**Test Strategy:**
- Start ProxyServer in-process
- Connect MinerSimulator
- Verify connection succeeds
- Check metrics are emitted

**Limitation:** Requires a real pool or pool simulator for full validation.

## Data Flow

### Connection Lifecycle

```
1. Miner connects to ProxyServer (port 3333)
2. ProxyServer accepts socket, creates ProxyConnection
3. ProxyConnection opens outbound socket to pool
4. Emits CONNECTION_OPENED event
   └─> MetricsCollector increments active_connections
5. Bidirectional relay begins:
   - Miner data → parse → forward to pool → emit BYTES_SENT
   - Pool data → parse → forward to miner → emit BYTES_RECEIVED
6. StratumParser observes messages:
   - mining.submit → emit STRATUM_REQUEST
   - pool response → emit STRATUM_RESPONSE
   - mining.notify → emit STRATUM_NOTIFICATION
7. MetricsCollector updates Prometheus metrics
8. On disconnect:
   - Emit CONNECTION_CLOSED with duration and totals
   - MetricsCollector decrements active_connections
```

### Metrics Collection

```
ProxyConnection (core)
   │
   ├─ emits ProxyEvent ───────┐
   │                          │
ProxyServer (core)            │
   │                          │
   └─ forwards event ─────────┤
                              │
                              ▼
                     MetricsCollector (service)
                              │
                              ├─ updates Counter
                              ├─ updates Gauge
                              └─ observes Histogram
                              │
                              ▼
                        ProxyMetrics (prom-client)
                              │
                              ▼
                     HTTP /metrics endpoint
                              │
                              ▼
                         Prometheus scrape
```

## Scalability

### Current Limits

- **Single-threaded Node.js:** ~10k concurrent connections per process
- **Memory:** ~100 KB per connection (buffers + parser state)
- **CPU:** Minimal (TCP relay + JSON parsing is I/O-bound)

### Scaling Strategies

**Horizontal (multiple processes):**
1. Run multiple proxy-service instances
2. Load-balance miner connections (DNS round-robin or L4 LB)
3. Each instance exports metrics; Prometheus federates

**Vertical (same process, more capacity):**
1. Use Node.js cluster module (one process per CPU core)
2. Share listening socket across workers
3. Aggregate metrics in parent process

**Replace core with native:**
- If CPU becomes bottleneck, replace `proxy-core` with a Go/Rust binary
- Keep same event API so service layer is unchanged

### Bottlenecks

1. **File descriptors:** Increase `ulimit -n 65535`
2. **TCP buffer memory:** Tune `net.core.rmem_max`, `net.core.wmem_max`
3. **Connection tracking:** Increase `nf_conntrack_max` if firewall is enabled
4. **Prometheus cardinality:** Avoid high-cardinality labels (per-connection IDs)

## Security

### Attack Vectors

1. **Connection flood:** Limit max_connections, rate-limit new connections
2. **Slowloris:** Set connection timeouts and idle timeouts
3. **Malformed payloads:** Parser tolerates bad JSON, continues forwarding
4. **Credential theft:** Do NOT log full Stratum messages (may contain passwords)

### Mitigations

- Run as non-root user
- Restrict file system access (systemd `ProtectSystem=strict`)
- Use private networks for pool connections
- TLS termination (optional, for encrypting miner→proxy)

## Observability

### Logs (pino)

- Structured JSON in production
- Log levels: debug, info, warn, error
- Each log has `connection_id` for tracing
- Rotate logs daily (logrotate)

### Metrics (Prometheus)

- Scraped every 15s
- Retention: 15 days in Prometheus, longer in Thanos/Mimir
- Recording rules pre-compute billing aggregates
- Alerts on high reject rate, connection errors, latency

### Tracing (optional)

- Add OpenTelemetry spans for connection lifecycle
- Trace submit → response roundtrip
- Export to Jaeger/Tempo for deep debugging

## Future Enhancements

1. **Multi-pool support:** Route miners to different pools based on config
2. **Failover:** Automatically switch to backup pool on failure
3. **Load balancing:** Distribute miners across multiple pools
4. **TLS termination:** Decrypt miner TLS for deeper inspection
5. **Stratum V2 support:** Parse and proxy Stratum V2 protocol
6. **Worker authentication:** Validate worker credentials before proxying
7. **Admin API:** REST API for runtime config changes
8. **Web UI:** Real-time dashboard without Grafana
