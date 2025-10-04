/*
 * GPS Tracker Server
 * Real-time GPS tracking with WebSocket and MQTT support
 * 
 * Features:
 * - Express REST API for device communication
 * - WebSocket server for real-time updates
 * - MQTT bridge for ESP32 devices
 * - SQLite database for position history
 * - Security with device tokens and rate limiting
 */

const express = require('express');
const WebSocket = require('ws');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
    port: process.env.PORT || 3000,
    publicOrigin: process.env.PUBLIC_ORIGIN || 'http://localhost:3000',
    sqliteFile: process.env.SQLITE_FILE || './data/tracker.sqlite',
    deviceToken: process.env.DEVICE_TOKEN || 'default_token',
    historyPoints: parseInt(process.env.HISTORY_POINTS) || 500,
    onlineWindowS: parseInt(process.env.ONLINE_WINDOW_S) || 60,
    mqttEnabled: process.env.MQTT_ENABLED === 'true',
    mqttBrokerHost: process.env.MQTT_BROKER_HOST || 'localhost',
    mqttPort: parseInt(process.env.MQTT_PORT) || 1883,
    mqttUsername: process.env.MQTT_USERNAME || '',
    mqttPassword: process.env.MQTT_PASSWORD || ''
};

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

const app = express();
let server;
let wss;
let mqttClient;
let db;

// In-memory storage for real-time data
const devicePositions = new Map(); // device_id -> latest position
const deviceHistory = new Map(); // device_id -> position history array
const wsClients = new Set(); // Connected WebSocket clients

// Server statistics
const serverStats = {
    startTime: Date.now(),
    totalDevices: 0,
    totalPositions: 0,
    wsClients: 0
};

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        // Ensure data directory exists
        const dataDir = path.dirname(config.sqliteFile);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        db = new sqlite3.Database(config.sqliteFile, (err) => {
            if (err) {
                console.error('Error opening database:', err);
                reject(err);
                return;
            }
            console.log('Connected to SQLite database:', config.sqliteFile);
            createTables().then(resolve).catch(reject);
        });
    });
}

function createTables() {
    return new Promise((resolve, reject) => {
        const createDevicesTable = `
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT UNIQUE NOT NULL,
        last_seen INTEGER NOT NULL,
        last_lat REAL,
        last_lng REAL,
        last_speed REAL,
        last_heading INTEGER,
        last_sats INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `;

        const createPositionsTable = `
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        speed REAL,
        heading INTEGER,
        sats INTEGER,
        timestamp INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (device_id) REFERENCES devices (device_id)
      )
    `;

        const createIndexes = [
            'CREATE INDEX IF NOT EXISTS idx_positions_device_id ON positions(device_id)',
            'CREATE INDEX IF NOT EXISTS idx_positions_timestamp ON positions(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen)'
        ];

        db.serialize(() => {
            db.run(createDevicesTable, (err) => {
                if (err) {
                    console.error('Error creating devices table:', err);
                    reject(err);
                    return;
                }
            });

            db.run(createPositionsTable, (err) => {
                if (err) {
                    console.error('Error creating positions table:', err);
                    reject(err);
                    return;
                }
            });

            createIndexes.forEach(indexSQL => {
                db.run(indexSQL, (err) => {
                    if (err) {
                        console.error('Error creating index:', err);
                    }
                });
            });

            console.log('Database tables created successfully');
            resolve();
        });
    });
}

// ============================================================================
// MQTT CLIENT SETUP
// ============================================================================

function initializeMQTT() {
    if (!config.mqttEnabled) {
        console.log('MQTT disabled in configuration');
        return;
    }

    const mqttOptions = {
        host: config.mqttBrokerHost,
        port: config.mqttPort,
        username: config.mqttUsername,
        password: config.mqttPassword,
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 30 * 1000
    };

    console.log('Connecting to MQTT broker:', config.mqttBrokerHost + ':' + config.mqttPort);

    mqttClient = mqtt.connect(mqttOptions);

    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        mqttClient.subscribe('track/#', (err) => {
            if (err) {
                console.error('Error subscribing to track/#:', err);
            } else {
                console.log('Subscribed to track/# topic');
            }
        });
    });

    mqttClient.on('message', (topic, message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log('MQTT received:', topic, data);
            processLocationUpdate(data);
        } catch (error) {
            console.error('Error parsing MQTT message:', error);
        }
    });

    mqttClient.on('error', (error) => {
        console.error('MQTT error:', error);
    });

    mqttClient.on('close', () => {
        console.log('MQTT connection closed');
    });

    mqttClient.on('reconnect', () => {
        console.log('MQTT reconnecting...');
    });
}

// ============================================================================
// WEBSOCKET SERVER SETUP
// ============================================================================

function initializeWebSocket() {
    wss = new WebSocket.Server({
        server,
        path: '/ws'
    });

    wss.on('connection', (ws, req) => {
        console.log('WebSocket client connected from:', req.socket.remoteAddress);
        wsClients.add(ws);
        serverStats.wsClients = wsClients.size;

        // Send current positions to new client
        const currentPositions = Array.from(devicePositions.values());
        if (currentPositions.length > 0) {
            ws.send(JSON.stringify({
                type: 'snapshot',
                devices: currentPositions
            }));
        }

        // Heartbeat to keep connection alive
        ws.isAlive = true;
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
            wsClients.delete(ws);
            serverStats.wsClients = wsClients.size;
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            wsClients.delete(ws);
            serverStats.wsClients = wsClients.size;
        });
    });

    // Heartbeat interval
    const heartbeat = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                ws.terminate();
                wsClients.delete(ws);
                serverStats.wsClients = wsClients.size;
                return;
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(heartbeat);
    });

    console.log('WebSocket server initialized on /ws');
}

// ============================================================================
// LOCATION PROCESSING
// ============================================================================

function processLocationUpdate(data) {
    const { device_id, lat, lng, speed, heading, sats, ts } = data;

    if (!device_id || !lat || !lng) {
        console.error('Invalid location data:', data);
        return;
    }

    const position = {
        device_id,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        speed: parseFloat(speed) || 0,
        heading: parseInt(heading) || 0,
        sats: parseInt(sats) || 0,
        timestamp: ts || Date.now()
    };

    // Update in-memory storage
    devicePositions.set(device_id, position);

    // Update history
    if (!deviceHistory.has(device_id)) {
        deviceHistory.set(device_id, []);
    }

    const history = deviceHistory.get(device_id);
    history.push(position);

    // Prune history to configured limit
    if (history.length > config.historyPoints) {
        history.splice(0, history.length - config.historyPoints);
    }

    // Update database
    updateDatabase(position);

    // Broadcast to WebSocket clients
    broadcastUpdate(position);

    // Update statistics
    serverStats.totalPositions++;
    if (!devicePositions.has(device_id)) {
        serverStats.totalDevices++;
    }

    console.log(`Position updated for ${device_id}: ${lat}, ${lng}`);
}

function updateDatabase(position) {
    const { device_id, lat, lng, speed, heading, sats, timestamp } = position;

    // Update or insert device
    const updateDeviceSQL = `
    INSERT OR REPLACE INTO devices 
    (device_id, last_seen, last_lat, last_lng, last_speed, last_heading, last_sats, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
  `;

    db.run(updateDeviceSQL, [device_id, timestamp, lat, lng, speed, heading, sats], (err) => {
        if (err) {
            console.error('Error updating device:', err);
        }
    });

    // Insert position history
    const insertPositionSQL = `
    INSERT INTO positions (device_id, lat, lng, speed, heading, sats, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

    db.run(insertPositionSQL, [device_id, lat, lng, speed, heading, sats, timestamp], (err) => {
        if (err) {
            console.error('Error inserting position:', err);
        }
    });

    // Clean up old positions (keep only last HISTORY_POINTS per device)
    const cleanupSQL = `
    DELETE FROM positions 
    WHERE device_id = ? AND id NOT IN (
      SELECT id FROM positions 
      WHERE device_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    )
  `;

    db.run(cleanupSQL, [device_id, device_id, config.historyPoints], (err) => {
        if (err) {
            console.error('Error cleaning up old positions:', err);
        }
    });
}

function broadcastUpdate(position) {
    const message = JSON.stringify({
        type: 'update',
        device: position
    });

    wsClients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    });
}

// ============================================================================
// EXPRESS MIDDLEWARE SETUP
// ============================================================================

// Security middleware (relaxed for development)
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for debugging
}));

// CORS configuration
app.use(cors({
    origin: config.publicOrigin,
    credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

const trackLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 200, // limit each IP to 200 requests per minute (allows for more devices)
    message: 'Too many tracking requests from this IP, please try again later.'
});

app.use('/api', apiLimiter);
app.use('/api/track', trackLimiter);

// Serve static files (exclude WebSocket and API paths)
app.use((req, res, next) => {
    if (req.path.startsWith('/ws') || req.path.startsWith('/api')) {
        return next();
    }

    // Set cache control headers to prevent caching issues
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });

    express.static(path.join(__dirname, '../public'))(req, res, next);
});

// ============================================================================
// API ROUTES
// ============================================================================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        uptime: Date.now() - serverStats.startTime,
        version: '1.0.0'
    });
});

// Get current positions
app.get('/api/positions', (req, res) => {
    const positions = Array.from(devicePositions.values());
    res.json({
        success: true,
        count: positions.length,
        devices: positions
    });
});

// Get device statistics
app.get('/api/stats', (req, res) => {
    const now = Date.now();
    const onlineThreshold = now - (config.onlineWindowS * 1000);

    const onlineDevices = Array.from(devicePositions.values())
        .filter(pos => pos.timestamp > onlineThreshold)
        .length;

    res.json({
        success: true,
        stats: {
            totalDevices: serverStats.totalDevices,
            totalPositions: serverStats.totalPositions,
            onlineDevices,
            wsClients: serverStats.wsClients,
            uptime: now - serverStats.startTime,
            historyPoints: config.historyPoints,
            onlineWindowS: config.onlineWindowS
        }
    });
});

// Device position update endpoint
app.post('/api/track', (req, res) => {
    const { device_id, lat, lng, speed, heading, sats, ts } = req.body;

    // Validate required fields
    if (!device_id || !lat || !lng) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: device_id, lat, lng'
        });
    }

    // Validate device token (from header or query parameter)
    const token = req.headers['x-device-token'] || req.query.token;
    if (token !== config.deviceToken) {
        return res.status(401).json({
            success: false,
            error: 'Invalid device token'
        });
    }

    // Process the location update
    processLocationUpdate(req.body);

    res.json({
        success: true,
        message: 'Position updated successfully'
    });
});

// Get device history
app.get('/api/history/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const sql = `
    SELECT lat, lng, speed, heading, sats, timestamp
    FROM positions
    WHERE device_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `;

    db.all(sql, [deviceId, limit], (err, rows) => {
        if (err) {
            console.error('Error fetching device history:', err);
            return res.status(500).json({
                success: false,
                error: 'Database error'
            });
        }

        res.json({
            success: true,
            device_id: deviceId,
            count: rows.length,
            positions: rows
        });
    });
});

// Catch-all route for SPA (exclude API and WebSocket paths)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not found' });
    }
    // Don't interfere with WebSocket paths - let the WebSocket server handle them
    if (req.path.startsWith('/ws')) {
        return next(); // Let the WebSocket server handle the request
    }
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
    try {
        console.log('Starting GPS Tracker Server...');
        console.log('Configuration:', {
            port: config.port,
            publicOrigin: config.publicOrigin,
            mqttEnabled: config.mqttEnabled,
            historyPoints: config.historyPoints,
            onlineWindowS: config.onlineWindowS
        });

        // Initialize database
        await initializeDatabase();

        // Create HTTP server
        server = require('http').createServer(app);

        // Initialize WebSocket
        initializeWebSocket();

        // Initialize MQTT (if enabled)
        if (config.mqttEnabled) {
            initializeMQTT();
        }

        // Start server
        server.listen(config.port, () => {
            console.log(`Server running on port ${config.port}`);
            console.log(`WebSocket available at ws://localhost:${config.port}/ws`);
            console.log(`Public origin: ${config.publicOrigin}`);

            if (config.mqttEnabled) {
                console.log(`MQTT broker: ${config.mqttBrokerHost}:${config.mqttPort}`);
            }
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');

    if (mqttClient) {
        mqttClient.end();
    }

    if (wss) {
        wss.close();
    }

    if (server) {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    }
});

// Start the server
startServer();