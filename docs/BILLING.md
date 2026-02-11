# Billing and Metrics Guide

## Overview

The mining proxy collects comprehensive metrics that can be used for billing customers based on usage. This document outlines billing strategies, metric queries, and implementation guidelines.

## Billing Models

### 1. Per-Bandwidth (GB-based)

**Charge per GB of data transferred.**

**Pros:**
- Simple to calculate and explain
- Fair for variable usage
- Hard to game

**Cons:**
- Doesn't correlate directly with mining value
- Miners with more efficient protocols pay less

**PromQL Query (30-day billing period):**
```promql
sum(
  increase(stratum_bytes_sent_total{client_id="miner-001"}[30d]) + 
  increase(stratum_bytes_received_total{client_id="miner-001"}[30d])
) / 1073741824
```

**Example Pricing:**
```
$0.10 per GB
Average miner usage: 2-5 GB/month
Monthly bill: $0.20 - $0.50
```

### 2. Per-Accepted-Share

**Charge per accepted share submitted.**

**Pros:**
- Directly tied to mining productivity
- Aligns with value generated

**Cons:**
- More complex to explain
- Varies with difficulty and hashrate

**PromQL Query:**
```promql
increase(stratum_accepted_shares_total{client_id="miner-001"}[30d])
```

**Example Pricing:**
```
$0.0001 per accepted share
Average miner: 50,000 shares/month
Monthly bill: $5.00
```

### 3. Hybrid (Base + Usage)

**Monthly subscription + overage charges.**

**Structure:**
```
Base: $5/month (includes 10 GB + 10,000 shares)
Overage: $0.05/GB, $0.00005/share
```

**PromQL Queries:**
```promql
# Check if over GB threshold
sum(increase(stratum_bytes_sent_total{client_id="miner-001"}[30d]) + 
    increase(stratum_bytes_received_total{client_id="miner-001"}[30d])
) / 1073741824 - 10

# Check if over share threshold
increase(stratum_accepted_shares_total{client_id="miner-001"}[30d]) - 10000
```

### 4. Flat-Rate Subscription

**Fixed monthly fee regardless of usage.**

**Pros:**
- Predictable revenue
- Simple for customers

**Cons:**
- Doesn't scale with usage
- Risk of abuse

**Tiers:**
```
Basic: $10/month (1 miner, 50 GB, 100K shares)
Pro: $50/month (5 miners, 300 GB, 1M shares)
Enterprise: Custom pricing
```

## Implementation

### 1. Data Collection

Prometheus scrapes `/metrics` endpoint every 15s. Metrics are stored with labels:
- `client_id` - Unique miner identifier
- `pool_host` - Target pool

### 2. Aggregation

Use Prometheus recording rules to pre-compute billing metrics:

```yaml
# infra/prometheus-recording-rules.yml
groups:
  - name: billing
    interval: 1h
    rules:
      # Daily aggregates
      - record: billing:bytes:daily
        expr: |
          increase(stratum_bytes_sent_total[1d]) + 
          increase(stratum_bytes_received_total[1d])
      
      - record: billing:shares:daily
        expr: increase(stratum_accepted_shares_total[1d])
      
      # Monthly aggregates
      - record: billing:bytes:30d
        expr: |
          increase(stratum_bytes_sent_total[30d]) + 
          increase(stratum_bytes_received_total[30d])
      
      - record: billing:shares:30d
        expr: increase(stratum_accepted_shares_total[30d])
```

### 3. Billing Pipeline

**Option A: Query Prometheus API**

```typescript
import fetch from 'node-fetch';

async function getBillingMetrics(clientId: string, days = 30): Promise<{bytes: number, shares: number}> {
  const promUrl = 'http://prometheus:9090';
  
  // Query bytes
  const bytesQuery = `sum(increase(stratum_bytes_sent_total{client_id="${clientId}"}[${days}d]) + increase(stratum_bytes_received_total{client_id="${clientId}"}[${days}d]))`;
  const bytesRes = await fetch(`${promUrl}/api/v1/query?query=${encodeURIComponent(bytesQuery)}`);
  const bytesData = await bytesRes.json();
  const bytes = parseFloat(bytesData.data.result[0]?.value[1] || '0');
  
  // Query shares
  const sharesQuery = `increase(stratum_accepted_shares_total{client_id="${clientId}"}[${days}d])`;
  const sharesRes = await fetch(`${promUrl}/api/v1/query?query=${encodeURIComponent(sharesQuery)}`);
  const sharesData = await sharesRes.json();
  const shares = parseFloat(sharesData.data.result[0]?.value[1] || '0');
  
  return { bytes, shares };
}

// Calculate bill
async function generateInvoice(clientId: string) {
  const metrics = await getBillingMetrics(clientId, 30);
  const gb = metrics.bytes / 1e9;
  
  const gbCost = gb * 0.10;
  const shareCost = metrics.shares * 0.0001;
  
  return {
    client_id: clientId,
    period: '30d',
    bytes: metrics.bytes,
    gb,
    shares: metrics.shares,
    gb_cost: gbCost,
    share_cost: shareCost,
    total: gbCost + shareCost,
  };
}
```

**Option B: Export to TSDB/Data Warehouse**

Use Prometheus remote write to export metrics to TimescaleDB, BigQuery, or similar for SQL-based billing queries.

### 4. Invoicing

Generate monthly invoices with:
- Period (start/end dates)
- Usage summary (bytes, shares, connections)
- Line items with pricing
- Total amount due
- Dispute instructions

Store raw metrics logs for 90 days for dispute resolution.

## Anti-Fraud Measures

### 1. Client Authentication

Require pre-registration and unique credentials per miner:

```typescript
// In proxy-service
const clients = new Map<string, ClientConfig>();

function authenticateClient(workerId: string): boolean {
  return clients.has(workerId) && clients.get(workerId)!.allowed;
}
```

### 2. Rate Limiting

Detect abnormal submit rates:

```promql
# Alert if submit rate > 200/min
rate(stratum_submits_total{client_id="miner-001"}[1m]) > 200
```

### 3. Correlation Checks

Compare proxy-reported shares with pool-reported shares (out of band).

### 4. Anomaly Detection

Alert on sudden usage spikes:

```promql
# Alert if bytes increase by >10x week-over-week
increase(stratum_bytes_sent_total{client_id="miner-001"}[7d]) / 
increase(stratum_bytes_sent_total{client_id="miner-001"}[7d] offset 7d) > 10
```

## Dispute Resolution

When customers dispute charges:

1. Query Prometheus for detailed time-series data
2. Retrieve structured logs from proxy service
3. Show per-hour/day breakdowns
4. Provide raw evidence (anonymized connection logs)

Example dispute query:
```promql
# Hourly bytes for past 30 days
sum by (client_id) (
  increase(stratum_bytes_sent_total{client_id="miner-001"}[1h])
)
```

## Reporting

### Daily Summary Email

- Active connections today
- Total bytes transferred
- Shares accepted/rejected
- Top 10 miners by usage
- Anomalies detected

### Monthly Invoice

- Customer name and client_id
- Billing period
- Usage metrics (GB, shares, uptime)
- Cost breakdown
- Payment instructions

### Dashboards

Use Grafana to provide real-time usage visibility:
- Current billing period usage
- Projected monthly cost
- Historical trends

See `infra/grafana-dashboard.json` for example dashboard.

## Legal and Compliance

- **Terms of Service**: Define billing model, dispute process, and usage limits
- **Privacy**: Do not log full Stratum payloads (may contain worker credentials)
- **Transparency**: Provide customers with access to their own metrics via Grafana
- **Data Retention**: Keep billing data for tax/legal requirements (7 years typical)

## Recommendations

For initial launch:
1. Start with **flat-rate subscription** (simple, predictable)
2. Add **per-GB overage** for heavy users
3. Monitor metrics and adjust pricing based on actual costs
4. Provide transparent dashboards so customers trust billing

For scale:
1. Move to **hybrid model** (base + usage)
2. Automate invoice generation and payment
3. Implement **tiered pricing** (volume discounts)
4. Offer **prepaid credits** for enterprise customers
