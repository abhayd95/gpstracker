# GPS Tracker - Real-time Tracking System

A complete, production-minded, real-time GPS tracking system with WebSocket support, MQTT integration, and mobile-first web interface.

## 🚀 Quick Start

### 1. **Start the Server**
```bash
cd server
npm install
node server.js
```

### 2. **Access Dashboard**
Open your browser to: `http://localhost:3000`

### 3. **Test with Sample Data**
```bash
# Add test device via API
curl -X POST http://localhost:3000/api/track \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: test_token_123" \
  -d '{"device_id":"TEST_001","lat":40.7128,"lng":-74.0060,"speed":25.5,"heading":45,"sats":12,"ts":1640995200000}'
```

### 4. **Test MQTT Publisher (One-liner)**
```bash
# Install mosquitto client: brew install mosquitto (macOS) or apt-get install mosquitto-clients (Ubuntu)
echo '{"device_id":"MQTT_TEST","lat":40.7589,"lng":-73.9851,"speed":30.2,"heading":90,"sats":10,"ts":'$(date +%s000)'}' | mosquitto_pub -h broker.hivemq.com -t track/MQTT_TEST -l
```

## 🔧 Configuration

### Server Configuration (.env)
```bash
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
SQLITE_FILE=./data/tracker.sqlite
DEVICE_TOKEN=test_token_123
HISTORY_POINTS=500
ONLINE_WINDOW_S=60
MQTT_ENABLED=true
MQTT_BROKER_HOST=broker.hivemq.com
MQTT_PORT=1883
MQTT_USERNAME=tracker_user
MQTT_PASSWORD=abhayd95
```

## 📡 API Endpoints

### Health Check
```bash
curl http://localhost:3000/api/health
```
**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1640995200000,
  "uptime": 3600000,
  "version": "1.0.0"
}
```

### Get Positions
```bash
curl http://localhost:3000/api/positions
```

### Get Statistics
```bash
curl http://localhost:3000/api/stats
```

### Submit Device Position
```bash
curl -X POST http://localhost:3000/api/track \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: test_token_123" \
  -d '{"device_id":"DEVICE_001","lat":40.7128,"lng":-74.0060,"speed":25.5,"heading":45,"sats":12,"ts":1640995200000}'
```

## 🌐 WebSocket Connection

The dashboard automatically connects to WebSocket at:
- **Local**: `ws://localhost:3000/ws`
- **HTTPS**: `wss://yourdomain.com/ws`

**WebSocket Messages:**
```javascript
// Snapshot (initial data)
{
  "type": "snapshot",
  "devices": [...]
}

// Real-time updates
{
  "type": "update", 
  "device": {
    "device_id": "DEVICE_001",
    "lat": 40.7128,
    "lng": -74.0060,
    "speed": 25.5,
    "heading": 45,
    "sats": 12,
    "ts": 1640995200000
  }
}
```

## 🔌 MQTT Integration

### MQTT Topic Structure
```
track/<DEVICE_ID>
```

### MQTT Message Format
```json
{
  "device_id": "DEVICE_001",
  "lat": 40.7128,
  "lng": -74.0060,
  "speed": 25.5,
  "heading": 45,
  "sats": 12,
  "ts": 1640995200000
}
```

### Test MQTT Publisher
```bash
# Simple MQTT test
mosquitto_pub -h broker.hivemq.com -t track/TEST_DEVICE -m '{"device_id":"TEST_DEVICE","lat":40.7128,"lng":-74.0060,"speed":25.5,"heading":45,"sats":12,"ts":'$(date +%s000)'}'

# Continuous MQTT publisher
while true; do
  LAT=$(echo "40.7128 + (RANDOM-16384)/100000" | bc -l)
  LNG=$(echo "-74.0060 + (RANDOM-16384)/100000" | bc -l)
  mosquitto_pub -h broker.hivemq.com -t track/MOVING_DEVICE -m "{\"device_id\":\"MOVING_DEVICE\",\"lat\":$LAT,\"lng\":$LNG,\"speed\":25.5,\"heading\":45,\"sats\":12,\"ts\":$(date +%s000)}"
  sleep 5
done
```

## 📱 Features

### ✅ Working Features
- **Real-time WebSocket** connection with auto-reconnect
- **Interactive Map** with Leaflet and device markers
- **Device Management** with search and focus
- **System Statistics** updating live
- **Map Controls**: Center All, Trails, Clusters, Fullscreen
- **Mobile Responsive** design
- **PWA Ready** with manifest
- **MQTT Bridge** for ESP32 devices
- **HTTP API** for Arduino devices
- **SQLite Database** with position history

### 🎯 Dashboard Controls
- **Center All**: Fit map to show all devices
- **Trails**: Toggle historical position trails
- **Clusters**: Toggle marker clustering
- **Fullscreen**: Enter fullscreen map mode
- **Search**: Filter devices by name
- **Click Device**: Focus map on specific device

## 🔧 Hardware Integration

### ESP32 + SIM7600 (Primary)
```cpp
// Update in esp32_gps_fetch.ino
#define SERVER_HOST "192.168.1.100"    // Your server IP
#define DEVICE_ID "ESP32_001"          // Unique device name
#define DEVICE_TOKEN "test_token_123"  // Same as server token
```

### Arduino Mega + SIM800L (Fallback)
```cpp
// Update in mega_gps_fetch.ino
#define SERVER_HOST "192.168.1.100"    // Your server IP
#define DEVICE_ID "MEGA_001"           // Unique device name
#define DEVICE_TOKEN "test_token_123"  // Same as server token
```

## 🚀 Deployment

### Docker Deployment
```bash
docker-compose up -d
```

### PM2 Deployment
```bash
npm install -g pm2
pm2 start pm2.config.cjs --env production
```

### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## 🧪 Testing

### Manual Testing Commands
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Test positions endpoint
curl http://localhost:3000/api/positions

# Test stats endpoint
curl http://localhost:3000/api/stats

# Test device submission
curl -X POST http://localhost:3000/api/track \
  -H "Content-Type: application/json" \
  -H "X-Device-Token: test_token_123" \
  -d '{"device_id":"TEST_001","lat":40.7128,"lng":-74.0060,"speed":25.5,"heading":45,"sats":12,"ts":1640995200000}'

# Test MQTT
mosquitto_pub -h broker.hivemq.com -t track/TEST -m '{"device_id":"TEST","lat":40.7128,"lng":-74.0060,"speed":25.5,"heading":45,"sats":12,"ts":1640995200000}'
```

### Device Simulator
```bash
# HTTP mode
node tools/device-simulator.js --n 5 --interval 2000 --mode http --host localhost

# MQTT mode  
node tools/device-simulator.js --n 5 --interval 2000 --mode mqtt --host broker.hivemq.com
```

## 🔒 Security

- **Device Token Authentication**: All API requests require valid token
- **Rate Limiting**: Prevents abuse with configurable limits
- **CORS Protection**: Restricted to configured origins
- **Helmet Security**: Security headers enabled
- **Input Validation**: All inputs validated and sanitized

## 📊 Monitoring

### Health Checks
```bash
# Server health
curl http://localhost:3000/api/health

# System stats
curl http://localhost:3000/api/stats

# Database size
ls -lh server/data/tracker.sqlite
```

### Logs
```bash
# PM2 logs
pm2 logs gps-tracker-server

# Docker logs
docker-compose logs -f tracker-server
```

## 🛠️ Troubleshooting

### WebSocket Not Connecting
1. Check server is running: `curl http://localhost:3000/api/health`
2. Verify WebSocket endpoint: `curl -I http://localhost:3000/ws`
3. Check browser console for errors (F12)
4. Ensure CORS settings match your origin

### No Devices Showing
1. Test API directly: `curl http://localhost:3000/api/positions`
2. Submit test device: Use curl POST command above
3. Check device token matches server configuration
4. Verify database has data: Check SQLite file

### Map Not Loading
1. Hard refresh browser: `Ctrl+F5` or `Cmd+Shift+R`
2. Check CSS loading: `curl http://localhost:3000/styles.css`
3. Clear browser cache
4. Check for JavaScript errors in console

### MQTT Not Working
1. Test MQTT connection: `mosquitto_pub -h broker.hivemq.com -t test/topic -m "test"`
2. Check server MQTT logs
3. Verify broker host and port settings
4. Ensure firewall allows MQTT traffic (port 1883)

## 📄 License

MIT License - see LICENSE file for details.

## ⚠️ Legal Notice

**Install only on owned or consented vehicles. Unauthorized tracking may be illegal in your jurisdiction. Always comply with local privacy laws and regulations.**

---

**Built with ❤️ for real-time GPS tracking**