# Docker Setup for Mining Proxy

This directory contains Docker configuration for running the mining proxy with monitoring.

## Services

### mining-proxy
The main proxy service that forwards Stratum mining traffic.
- **Port 3333**: Stratum protocol (miners connect here)
- **Port 9090**: Prometheus metrics endpoint

### prometheus
Metrics collection and storage.
- **Port 9091**: Prometheus web UI
- Access: http://localhost:9091

### grafana
Visualization and dashboards for metrics.
- **Port 3000**: Grafana web UI  
- Access: http://localhost:3000
- Default credentials: `admin` / `admin`
- Pre-configured with Mining Proxy dashboard

### dozzle
Real-time log viewer with web UI.
- **Port 8080**: Dozzle web interface
- Access: http://localhost:8080
- Features:
  - Real-time log streaming
  - Multi-container view
  - Search and filter logs
  - Dark/light theme
  - Mobile responsive

## Quick Start

```bash
# Start all services
docker compose up -d

# View dashboards
open http://localhost:3000  # Grafana (admin/admin)
open http://localhost:8080  # Dozzle (logs)
open http://localhost:9091  # Prometheus

# Stop all services
docker compose down

# Rebuild and restart
docker compose up -d --build
```

## Environment Variables

Create a `.env` file in the docker directory:

```env
POOL_HOST=btc.viabtc.io
POOL_PORT=3333
LOG_LEVEL=info
MAX_CONNECTIONS=100
```

## Accessing Services

| Service | URL | Credentials | Description |
|---------|-----|-------------|-------------|
| Mining Proxy (Stratum) | `localhost:3333` | N/A | Point your miners here |
| **Grafana Dashboard** | http://localhost:3000 | admin/admin | **Main monitoring UI** |
| Dozzle (Logs) | http://localhost:8080 | None | Real-time log viewer |
| Prometheus UI | http://localhost:9091 | None | Raw metrics query |
| Metrics Endpoint | http://localhost:9090/metrics | None | Prometheus scrape target |

## Grafana Dashboard

The pre-configured dashboard includes:

- **Connection Metrics**: Active connections, rates, duration
- **Performance**: Bytes sent/received, share rates
- **Latency**: P50/P95/P99 latency metrics
- **Mining Stats**: Hashrate, difficulty, acceptance rate

### First Time Access

1. Open http://localhost:3000
2. Login: `admin` / `admin`
3. Change password (or skip)
4. Dashboard auto-loads on homepage

## Dozzle Features

### Real-time Logs
- View logs from all containers in one place
- Auto-scrolling with pause functionality
- Timestamp filtering

### Search & Filter
- Full-text search across logs
- Filter by log level (info, warn, error)
- Filter by container

### Multi-container View
- Split screen to view multiple containers
- Quickly switch between containers
- Container status indicators

### Advanced Features
- Download logs as files
- Copy log entries
- Light/dark theme toggle
- Responsive design for mobile

## Monitoring Workflow

1. **Deploy**: `docker compose up -d`
2. **Main Dashboard**: Open http://localhost:3000 - see all metrics
3. **Check Logs**: Open http://localhost:8080 - view container logs  
4. **Deep Dive**: Open http://localhost:9091 - custom PromQL queries
5. **Connect Miners**: Point to `localhost:3333`

## Production Notes

### Security
- **Change Grafana admin password immediately in production**
- Dozzle has read-only access to Docker socket
- Add reverse proxy with SSL/TLS for production
- Consider firewall rules for exposed ports

### Performance
- Grafana: ~100MB RAM
- Dozzle: ~10MB RAM
- Prometheus: Scales with data retention

### Log Rotation
The proxy container has log rotation configured:
- Max size: 10MB per file
- Max files: 3
- Total max storage: ~30MB

## Troubleshooting

### Grafana shows "No data"
```bash
# Check Prometheus connection
docker compose logs grafana
# In Grafana: Configuration → Data Sources → Prometheus → Test
```

### Dashboard not loading
```bash
# Check dashboard provisioning
docker compose exec grafana ls -l /var/lib/grafana/dashboards
docker compose restart grafana
```

### Dozzle shows no containers
```bash
# Check Docker socket access
docker compose exec dozzle ls -l /var/run/docker.sock
```

### Prometheus not scraping metrics
```bash
# Check if metrics endpoint is accessible
curl http://localhost:9090/metrics
```

### Logs not appearing
```bash
# Check container status
docker compose ps

# View raw logs
docker compose logs mining-proxy
```

## Useful URLs

### Grafana
- Main Dashboard: http://localhost:3000
- Data Sources: http://localhost:3000/datasources
- Explore Metrics: http://localhost:3000/explore

### Dozzle
- All logs: http://localhost:8080
- Mining proxy: http://localhost:8080/show/mining-proxy
- Grafana logs: http://localhost:8080/show/grafana

### Prometheus
- Targets: http://localhost:9091/targets
- Query: http://localhost:9091/graph
