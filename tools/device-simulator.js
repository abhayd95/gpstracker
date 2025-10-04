#!/usr/bin/env node

/*
 * GPS Device Simulator
 * 
 * Simulates multiple GPS devices sending location updates
 * Supports both MQTT and HTTP modes
 * 
 * Usage:
 *   node device-simulator.js --n 10 --interval 1000 --speed 40 --mode mqtt --host localhost
 *   node device-simulator.js --n 5 --interval 2000 --speed 60 --mode http --host 192.168.1.100
 */

let mqtt;
try {
    mqtt = require('mqtt');
} catch (e) {
    console.warn('MQTT module not available. MQTT mode will be disabled.');
    mqtt = null;
}
const http = require('http');
const https = require('https');
const { URL } = require('url');

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG = {
    deviceCount: 5,
    interval: 2000,
    speed: 40,
    mode: 'mqtt', // 'mqtt' or 'http'
    host: 'localhost',
    port: 3000,
    mqttPort: 1883,
    deviceToken: 'simulator_token',
    mqttUsername: 'tracker_user',
    mqttPassword: 'abhayd95'
};

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let config = {...DEFAULT_CONFIG };
let devices = [];
let mqttClient;
let isRunning = false;

// Sample routes for realistic movement
const SAMPLE_ROUTES = [
    // Route 1: City center loop
    [
        { lat: 40.7128, lng: -74.0060 }, // NYC
        { lat: 40.7589, lng: -73.9851 }, // Times Square
        { lat: 40.7505, lng: -73.9934 }, // Empire State
        { lat: 40.7282, lng: -73.7949 }, // Queens
        { lat: 40.7128, lng: -74.0060 } // Back to start
    ],
    // Route 2: Highway simulation
    [
        { lat: 40.7128, lng: -74.0060 },
        { lat: 40.6892, lng: -74.0445 }, // Statue of Liberty
        { lat: 40.6782, lng: -74.0115 }, // Brooklyn Bridge
        { lat: 40.6501, lng: -73.9496 }, // Prospect Park
        { lat: 40.7128, lng: -74.0060 }
    ],
    // Route 3: Residential area
    [
        { lat: 40.7831, lng: -73.9712 }, // Central Park
        { lat: 40.7614, lng: -73.9776 }, // Lincoln Center
        { lat: 40.7505, lng: -73.9934 }, // Empire State
        { lat: 40.7282, lng: -73.7949 }, // Queens
        { lat: 40.7831, lng: -73.9712 }
    ]
];

// ============================================================================
// COMMAND LINE PARSING
// ============================================================================

function parseArguments() {
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i += 2) {
        const flag = args[i];
        const value = args[i + 1];

        switch (flag) {
            case '--n':
            case '--devices':
                config.deviceCount = parseInt(value) || 5;
                break;
            case '--interval':
                config.interval = parseInt(value) || 2000;
                break;
            case '--speed':
                config.speed = parseInt(value) || 40;
                break;
            case '--mode':
                config.mode = value || 'mqtt';
                break;
            case '--host':
                config.host = value || 'localhost';
                break;
            case '--port':
                config.port = parseInt(value) || 3000;
                break;
            case '--mqtt-port':
                config.mqttPort = parseInt(value) || 1883;
                break;
            case '--token':
                config.deviceToken = value || 'simulator_token';
                break;
            case '--mqtt-username':
                config.mqttUsername = value || 'tracker_user';
                break;
            case '--mqtt-password':
                config.mqttPassword = value || 'abhayd95';
                break;
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
                break;
        }
    }
}

function showHelp() {
    console.log(`
GPS Device Simulator

Usage: node device-simulator.js [options]

Options:
  --n, --devices <number>     Number of devices to simulate (default: 5)
  --interval <ms>             Update interval in milliseconds (default: 2000)
  --speed <kmh>               Average speed in km/h (default: 40)
  --mode <mqtt|http>          Communication mode (default: mqtt)
  --host <hostname>           Server hostname (default: localhost)
  --port <port>               HTTP server port (default: 3000)
  --mqtt-port <port>          MQTT broker port (default: 1883)
  --token <token>             Device authentication token (default: simulator_token)
  --mqtt-username <username>  MQTT username (default: tracker_user)
  --mqtt-password <password>  MQTT password (default: abhayd95)
  --help, -h                  Show this help message

Examples:
  node device-simulator.js --n 10 --interval 1000 --speed 40 --mode mqtt
  node device-simulator.js --n 5 --interval 2000 --speed 60 --mode http --host 192.168.1.100
  `);
}

// ============================================================================
// DEVICE SIMULATION
// ============================================================================

class SimulatedDevice {
    constructor(id, route) {
        this.id = `SIM_${id.toString().padStart(3, '0')}`;
        this.route = route;
        this.currentIndex = 0;
        this.progress = 0; // 0-1 along current segment
        this.speed = config.speed + (Math.random() - 0.5) * 20; // ±10 km/h variation
        this.heading = 0;
        this.satellites = 8 + Math.floor(Math.random() * 8); // 8-15 satellites
        this.lastUpdate = Date.now();
    }

    getCurrentPosition() {
        const route = this.route;
        const currentIndex = this.currentIndex;
        const nextIndex = (currentIndex + 1) % route.length;

        const current = route[currentIndex];
        const next = route[nextIndex];

        // Interpolate between current and next point
        const lat = current.lat + (next.lat - current.lat) * this.progress;
        const lng = current.lng + (next.lng - current.lng) * this.progress;

        // Calculate heading
        const deltaLat = next.lat - current.lat;
        const deltaLng = next.lng - current.lng;
        this.heading = Math.atan2(deltaLng, deltaLat) * (180 / Math.PI);

        return { lat, lng };
    }

    update() {
        const now = Date.now();
        const deltaTime = (now - this.lastUpdate) / 1000; // seconds
        this.lastUpdate = now;

        // Calculate distance moved (speed in km/h, convert to degrees)
        const speedMs = (this.speed * 1000) / 3600; // m/s
        const distanceDegrees = (speedMs * deltaTime) / 111000; // rough conversion

        // Update progress along route
        const route = this.route;
        const currentIndex = this.currentIndex;
        const nextIndex = (currentIndex + 1) % route.length;

        const current = route[currentIndex];
        const next = route[nextIndex];

        const segmentDistance = Math.sqrt(
            Math.pow(next.lat - current.lat, 2) + Math.pow(next.lng - current.lng, 2)
        );

        this.progress += distanceDegrees / segmentDistance;

        // Move to next segment if needed
        if (this.progress >= 1) {
            this.progress = 0;
            this.currentIndex = nextIndex;
        }

        // Add some random variation to speed
        this.speed = Math.max(5, this.speed + (Math.random() - 0.5) * 2);

        // Update satellite count (simulate GPS signal changes)
        this.satellites = Math.max(4, this.satellites + Math.floor((Math.random() - 0.5) * 2));
    }

    getLocationData() {
        const position = this.getCurrentPosition();

        return {
            device_id: this.id,
            lat: position.lat,
            lng: position.lng,
            speed: this.speed,
            heading: Math.round(this.heading),
            sats: this.satellites,
            ts: Date.now()
        };
    }
}

// ============================================================================
// MQTT FUNCTIONS
// ============================================================================

function initializeMQTT() {
    const mqttOptions = {
        host: config.host,
        port: config.mqttPort,
        username: config.mqttUsername,
        password: config.mqttPassword,
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 30 * 1000
    };

    if (!mqtt) {
        console.error('MQTT module not available. Cannot run in MQTT mode.');
        process.exit(1);
    }

    console.log(`Connecting to MQTT broker: ${config.host}:${config.mqttPort}`);

    mqttClient = mqtt.connect(mqttOptions);

    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker');
        startSimulation();
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

function sendMQTTUpdate(device) {
    if (!mqttClient || !mqttClient.connected) {
        console.warn('MQTT client not connected');
        return;
    }

    const data = device.getLocationData();
    const topic = `track/${device.id}`;
    const payload = JSON.stringify(data);

    mqttClient.publish(topic, payload, (error) => {
        if (error) {
            console.error(`Failed to publish for ${device.id}:`, error);
        } else {
            console.log(`MQTT: ${device.id} -> ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)} (${data.speed.toFixed(1)} km/h)`);
        }
    });
}

// ============================================================================
// HTTP FUNCTIONS
// ============================================================================

function sendHTTPUpdate(device) {
    const data = device.getLocationData();
    const url = new URL(`http://${config.host}:${config.port}/api/track`);

    const postData = JSON.stringify(data);

    const options = {
        hostname: config.host,
        port: config.port,
        path: '/api/track',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-Device-Token': config.deviceToken
        }
    };

    const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
            responseData += chunk;
        });

        res.on('end', () => {
            if (res.statusCode === 200) {
                console.log(`HTTP: ${device.id} -> ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)} (${data.speed.toFixed(1)} km/h)`);
            } else {
                console.error(`HTTP error for ${device.id}: ${res.statusCode} - ${responseData}`);
            }
        });
    });

    req.on('error', (error) => {
        console.error(`HTTP request failed for ${device.id}:`, error);
    });

    req.write(postData);
    req.end();
}

// ============================================================================
// SIMULATION CONTROL
// ============================================================================

function initializeDevices() {
    devices = [];

    for (let i = 0; i < config.deviceCount; i++) {
        const routeIndex = i % SAMPLE_ROUTES.length;
        const device = new SimulatedDevice(i + 1, SAMPLE_ROUTES[routeIndex]);
        devices.push(device);
    }

    console.log(`Initialized ${devices.length} simulated devices`);
}

function startSimulation() {
    if (isRunning) {
        console.log('Simulation already running');
        return;
    }

    isRunning = true;
    console.log(`Starting simulation with ${devices.length} devices`);
    console.log(`Mode: ${config.mode.toUpperCase()}`);
    console.log(`Interval: ${config.interval}ms`);
    console.log(`Average speed: ${config.speed} km/h`);
    console.log('Press Ctrl+C to stop\n');

    const interval = setInterval(() => {
        if (!isRunning) {
            clearInterval(interval);
            return;
        }

        devices.forEach(device => {
            device.update();

            if (config.mode === 'mqtt') {
                sendMQTTUpdate(device);
            } else {
                sendHTTPUpdate(device);
            }
        });
    }, config.interval);
}

function stopSimulation() {
    console.log('\nStopping simulation...');
    isRunning = false;

    if (mqttClient) {
        mqttClient.end();
    }

    console.log('Simulation stopped');
    process.exit(0);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

function main() {
    console.log('GPS Device Simulator');
    console.log('====================\n');

    parseArguments();

    console.log('Configuration:');
    console.log(`  Devices: ${config.deviceCount}`);
    console.log(`  Interval: ${config.interval}ms`);
    console.log(`  Speed: ${config.speed} km/h`);
    console.log(`  Mode: ${config.mode.toUpperCase()}`);
    console.log(`  Host: ${config.host}`);
    if (config.mode === 'mqtt') {
        console.log(`  MQTT Port: ${config.mqttPort}`);
    } else {
        console.log(`  HTTP Port: ${config.port}`);
    }
    console.log('');

    initializeDevices();

    if (config.mode === 'mqtt') {
        initializeMQTT();
    } else {
        startSimulation();
    }

    // Handle graceful shutdown
    process.on('SIGINT', stopSimulation);
    process.on('SIGTERM', stopSimulation);
}

// Run the simulator
if (require.main === module) {
    main();
}

module.exports = {
    SimulatedDevice,
    SAMPLE_ROUTES,
    DEFAULT_CONFIG
};