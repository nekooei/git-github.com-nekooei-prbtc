#!/bin/bash
set -e

echo "🚀 Starting Mining Proxy with Monitoring Stack..."
echo ""

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running"
    exit 1
fi

# Change to docker directory
cd "$(dirname "$0")"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
fi

# Build and start services
echo "🔨 Building and starting services..."
docker compose up -d --build

# Wait for services to be healthy
echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check service status
echo ""
echo "📊 Service Status:"
docker compose ps

echo ""
echo "✅ Mining Proxy Stack is running!"
echo ""
echo "🌐 Access your dashboards:"
echo "   • Grafana Dashboard: http://localhost:3000 (admin/admin)"
echo "   • Dozzle Logs:       http://localhost:8080"
echo "   • Prometheus:        http://localhost:9091"
echo ""
echo "⛏️  Connect your miners to: localhost:3333"
echo ""
echo "📚 View logs: docker compose logs -f"
echo "🛑 Stop stack: docker compose down"
