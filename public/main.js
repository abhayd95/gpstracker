/*
 * GPS Tracker Frontend - Real-time Map Application
 * Fixed WebSocket connection and live data display
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    POLL_INTERVAL_MS: 5000,
    RECONNECT_DELAY_MS: 1000,
    MAX_RECONNECT_DELAY_MS: 30000,
    HISTORY_POINTS: 500,
    ONLINE_WINDOW_S: 60
};

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

let map;
let markersGroup;
let clusterGroup;
let trailsLayer;
let ws;
let reconnectTimeout;
let pollInterval;
let statsInterval;

// Device registry
const deviceRegistry = new Map(); // device_id -> { marker, lastPoints[], polyline }

// UI state
let isTrailsEnabled = false;
let isClustersEnabled = false;
let isFullscreen = false;
let reconnectDelay = CONFIG.RECONNECT_DELAY_MS;

// ============================================================================
// INITIALIZATION
// ============================================================================

// Add immediate debug log
console.log('Main.js loaded successfully');

document.addEventListener('DOMContentLoaded', () => {
    console.log('GPS Tracker Frontend Initializing...');
    console.log('DOM Content Loaded event fired');

    try {
        console.log('Starting map initialization...');
        initializeMap();
        console.log('Map initialized');

        console.log('Starting WebSocket initialization...');
        initializeWebSocket();
        console.log('WebSocket initialized');

        console.log('Starting event listeners initialization...');
        initializeEventListeners();
        console.log('Event listeners initialized');

        // Add test connection button listener
        const testBtn = document.getElementById('testConnection');
        if (testBtn) {
            testBtn.addEventListener('click', () => {
                console.log('=== MANUAL CONNECTION TEST ===');
                console.log('Current WebSocket state:', ws ? ws.readyState : 'null');
                console.log('Forcing WebSocket reconnection...');
                initializeWebSocket();

                // Also fetch fresh data and populate map
                setTimeout(() => {
                    console.log('Fetching fresh data...');
                    fetchPositions();
                    fetchStats();

                    // Force map population
                    setTimeout(() => {
                        console.log('Force populating map with existing data...');
                        fetchPositions();
                    }, 500);
                }, 1000);
            });
        }

        console.log('Starting stats initialization...');
        initializeStats();
        console.log('Stats initialized');

        // Fetch initial data
        console.log('Fetching initial data...');
        fetchPositions();
        fetchStats();
        console.log('Initial data fetched');

        // Force a test WebSocket connection after everything is loaded
        setTimeout(() => {
            console.log('=== FORCING WEBSOCKET CONNECTION TEST ===');
            if (ws && ws.readyState === WebSocket.CONNECTING) {
                console.log('WebSocket is still connecting...');
            } else if (ws && ws.readyState === WebSocket.OPEN) {
                console.log('WebSocket is connected!');
            } else if (ws && ws.readyState === WebSocket.CLOSED) {
                console.log('WebSocket is closed, attempting reconnect...');
                initializeWebSocket();
            } else {
                console.log('WebSocket state unknown:', ws ? ws.readyState : 'ws is null');
            }

            // Force populate map with existing data regardless of WebSocket status
            console.log('=== FORCE POPULATING MAP WITH EXISTING DATA ===');
            fetchPositions();
            fetchStats();
        }, 2000);

        console.log('Frontend initialized successfully');
    } catch (error) {
        console.error('Error during initialization:', error);
        console.error('Error stack:', error.stack);
    }
});

// ============================================================================
// MAP INITIALIZATION
// ============================================================================

function initializeMap() {
    try {
        console.log('Starting map initialization...');
        console.log('Leaflet available:', typeof L !== 'undefined');
        console.log('Map container exists:', document.getElementById('map'));

        if (typeof L === 'undefined') {
            throw new Error('Leaflet library not loaded');
        }

        const mapContainer = document.getElementById('map');
        if (!mapContainer) {
            throw new Error('Map container not found');
        }

        // Ensure map container has proper dimensions
        mapContainer.style.height = '100%';
        mapContainer.style.width = '100%';
        console.log('Map container dimensions set');
        console.log('Map container offsetWidth:', mapContainer.offsetWidth);
        console.log('Map container offsetHeight:', mapContainer.offsetHeight);

        // Wait a moment for layout to settle
        setTimeout(() => {
            // Create map centered on a default location
            map = L.map('map', {
                center: [40.7128, -74.0060], // New York City
                zoom: 10,
                zoomControl: true,
                attributionControl: true
            });

            console.log('Map object created');

            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);

            console.log('Tile layer added');

            // Initialize marker groups
            markersGroup = L.layerGroup().addTo(map);
            console.log('Markers group created');

            // Initialize cluster group (if available)
            if (typeof L.markerClusterGroup !== 'undefined') {
                clusterGroup = L.markerClusterGroup({
                    chunkedLoading: true,
                    maxClusterRadius: 50
                });
                console.log('Cluster group created');
            } else {
                console.warn('MarkerClusterGroup not available - clustering disabled');
                const clustersBtn = document.getElementById('clustersBtn');
                if (clustersBtn) {
                    clustersBtn.disabled = true;
                }
            }

            // Initialize trails layer
            trailsLayer = L.layerGroup();
            console.log('Trails layer created');

            // Store map reference globally
            window.__MAP__ = map;

            // Trigger map resize to ensure proper rendering
            setTimeout(() => {
                if (map) {
                    console.log('Map container final dimensions:', mapContainer.offsetWidth, 'x', mapContainer.offsetHeight);
                    map.invalidateSize();
                    console.log('Map size invalidated');

                    // Force a redraw
                    setTimeout(() => {
                        map.invalidateSize();
                        console.log('Map size invalidated again');
                    }, 100);
                }
            }, 200);

            console.log('Map initialized successfully');

            // Load existing data once map is ready
            setTimeout(() => {
                console.log('Loading existing data into map...');
                fetchPositions();

                // Set up periodic data refresh as fallback
                setInterval(() => {
                    console.log('Periodic data refresh...');
                    fetchPositions();
                    fetchStats();
                }, 5000); // Refresh every 5 seconds
            }, 500);
        }, 100); // Small delay to ensure layout is ready
    } catch (error) {
        console.error('Error initializing map:', error);
    }
}

// ============================================================================
// WEBSOCKET MANAGEMENT
// ============================================================================

function initializeWebSocket() {
    try {
        console.log('initializeWebSocket function called');
        console.log('location.protocol:', location.protocol);
        console.log('location.host:', location.host);

        // Close existing connection if any
        if (ws) {
            console.log('Closing existing WebSocket connection...');
            ws.close();
            ws = null;
        }

        // Derive WebSocket URL as required
        const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

        console.log('Connecting to WebSocket:', WS_URL);
        updateConnectionStatus('connecting', 'Connecting...');

        console.log('Creating WebSocket object...');
        ws = new WebSocket(WS_URL);
        console.log('WebSocket object created:', ws);

        ws.onopen = onWebSocketOpen;
        ws.onmessage = onWebSocketMessage;
        ws.onclose = onWebSocketClose;
        ws.onerror = onWebSocketError;

        console.log('WebSocket event handlers attached, waiting for connection...');

        // Set a timeout to detect if connection takes too long
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.CONNECTING) {
                console.warn('WebSocket connection taking too long, starting fallback...');
                updateConnectionStatus('disconnected', 'Connection Timeout');
                startPollingFallback();
            }
        }, 5000);

    } catch (error) {
        console.error('WebSocket connection failed:', error);
        console.error('Error details:', error.message, error.stack);
        updateConnectionStatus('disconnected', 'Connection Failed');
        startPollingFallback();
    }
}

function onWebSocketOpen() {
    console.log('=== WebSocket OPENED ===');
    console.log('WebSocket connected successfully');
    console.log('WebSocket readyState:', ws.readyState);
    console.log('WebSocket URL:', ws.url);

    updateConnectionStatus('connected', 'Connected');
    reconnectDelay = CONFIG.RECONNECT_DELAY_MS;

    // Clear any existing polling
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log('Cleared polling interval');
    }

    console.log('WebSocket connection fully established');
}

function onWebSocketMessage(event) {
    try {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        handleWebSocketMessage(data);
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
}

function onWebSocketClose(event) {
    console.log('=== WebSocket CLOSED ===');
    console.log('WebSocket closed with code:', event.code);
    console.log('Close reason:', event.reason || 'No reason provided');
    console.log('Close event wasClean:', event.wasClean);
    console.log('WebSocket URL was:', ws ? ws.url : 'unknown');

    // Provide specific error messages based on close codes
    let errorMessage = 'Disconnected';
    if (event.code === 1006) {
        errorMessage = 'Connection Lost';
    } else if (event.code === 1000) {
        errorMessage = 'Normal Closure';
    } else if (event.code === 1001) {
        errorMessage = 'Going Away';
    } else if (event.code === 1002) {
        errorMessage = 'Protocol Error';
    } else if (event.code === 1003) {
        errorMessage = 'Unsupported Data';
    } else if (event.code === 1011) {
        errorMessage = 'Server Error';
    }

    updateConnectionStatus('disconnected', errorMessage);

    // Attempt reconnection with exponential backoff
    scheduleReconnect();
}

function onWebSocketError(error) {
    console.log('=== WebSocket ERROR ===');
    console.error('WebSocket error occurred:', error);
    console.error('Error type:', error.type);
    console.error('Error target:', error.target);
    console.error('WebSocket readyState:', ws ? ws.readyState : 'ws is null');
    console.error('WebSocket URL:', ws ? ws.url : 'unknown');

    // Try to get more error details
    if (error.message) {
        console.error('Error message:', error.message);
    }
    if (error.stack) {
        console.error('Error stack:', error.stack);
    }

    updateConnectionStatus('disconnected', 'Connection Error');
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'snapshot':
            console.log('Received snapshot with', data.devices ? .length || 0, 'devices');
            handleSnapshot(data.devices);
            break;
        case 'update':
            console.log('Received device update:', data.device);
            handleDeviceUpdate(data.device);
            break;
        default:
            console.warn('Unknown WebSocket message type:', data.type);
    }
}

function scheduleReconnect() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }

    console.log(`Scheduling reconnect in ${reconnectDelay}ms`);
    updateConnectionStatus('connecting', `Reconnecting in ${Math.ceil(reconnectDelay / 1000)}s...`);

    // Start polling immediately as fallback
    startPollingFallback();

    reconnectTimeout = setTimeout(() => {
        console.log('Attempting WebSocket reconnection...');
        initializeWebSocket();

        // Exponential backoff
        reconnectDelay = Math.min(reconnectDelay * 2, CONFIG.MAX_RECONNECT_DELAY_MS);
    }, reconnectDelay);
}

function startPollingFallback() {
    console.log('Starting polling fallback');
    updateConnectionStatus('disconnected', 'Polling Mode');

    // Fetch initial data
    fetchPositions();

    // Set up polling interval
    pollInterval = setInterval(fetchPositions, CONFIG.POLL_INTERVAL_MS);
}

// ============================================================================
// DATA FETCHING
// ============================================================================

async function fetchPositions() {
    try {
        console.log('Fetching positions via API...');
        const response = await fetch('/api/positions');
        console.log('Positions response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('API response:', data);
        if (data.success && data.devices) {
            console.log('Processing', data.devices.length, 'devices');
            handleSnapshot(data.devices);
        }
    } catch (error) {
        console.error('Error fetching positions:', error);
    }
}

async function fetchStats() {
    try {
        console.log('Fetching stats via API...');
        const response = await fetch('/api/stats');
        console.log('Stats response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('Stats API response:', data);
        if (data.success && data.stats) {
            console.log('Updating stats display');
            updateStatsDisplay(data.stats);
        }
    } catch (error) {
        console.error('Error fetching stats:', error);
    }
}

// ============================================================================
// DATA HANDLING
// ============================================================================

function handleSnapshot(devices) {
    console.log('Processing snapshot:', devices.length, 'devices');

    // Clear existing markers
    clearAllMarkers();

    // Add all devices
    devices.forEach(device => {
        handleDeviceUpdate(device);
    });

    // Update device list
    updateDevicesList();
}

function handleDeviceUpdate(device) {
    const { device_id, lat, lng, speed, heading, sats, timestamp } = device;

    if (!device_id || !lat || !lng) {
        console.warn('Invalid device data:', device);
        return;
    }

    // Get or create device registry entry
    let deviceData = deviceRegistry.get(device_id);
    if (!deviceData) {
        deviceData = {
            marker: null,
            lastPoints: [],
            polyline: null
        };
        deviceRegistry.set(device_id, deviceData);
    }

    // Update position history
    deviceData.lastPoints.push({ lat, lng, timestamp });

    // Prune history
    if (deviceData.lastPoints.length > CONFIG.HISTORY_POINTS) {
        deviceData.lastPoints.splice(0, deviceData.lastPoints.length - CONFIG.HISTORY_POINTS);
    }

    // Create or update marker
    updateDeviceMarker(device_id, device, deviceData);

    // Update trails if enabled
    if (isTrailsEnabled) {
        updateDeviceTrail(device_id, deviceData);
    }

    console.log(`Updated device ${device_id}: ${lat}, ${lng}`);
}

function updateDeviceMarker(deviceId, device, deviceData) {
    const { lat, lng, speed, heading, sats, timestamp } = device;

    // Create popup content
    const popupContent = `
    <div class="device-popup">
      <h3>${deviceId}</h3>
      <p><strong>Position:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}</p>
      <p><strong>Speed:</strong> ${speed.toFixed(1)} km/h</p>
      <p><strong>Heading:</strong> ${heading}°</p>
      <p><strong>Satellites:</strong> ${sats}</p>
      <p><strong>Last Update:</strong> ${new Date(timestamp).toLocaleString()}</p>
    </div>
  `;

    // Create custom icon with device ID
    const icon = L.divIcon({
        className: 'device-marker',
        html: `
      <div class="marker-container" style="
        background: #d4af37;
        color: white;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        border: 2px solid white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      ">
        ${deviceId.slice(-2)}
      </div>
    `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    // Remove existing marker
    if (deviceData.marker) {
        if (isClustersEnabled && clusterGroup) {
            clusterGroup.removeLayer(deviceData.marker);
        } else {
            markersGroup.removeLayer(deviceData.marker);
        }
    }

    // Create new marker
    const marker = L.marker([lat, lng], { icon })
        .bindPopup(popupContent);

    // Add to appropriate group
    if (isClustersEnabled && clusterGroup) {
        clusterGroup.addLayer(marker);
    } else {
        markersGroup.addLayer(marker);
    }

    deviceData.marker = marker;
}

function updateDeviceTrail(deviceId, deviceData) {
    if (deviceData.lastPoints.length < 2) return;

    // Remove existing polyline
    if (deviceData.polyline) {
        trailsLayer.removeLayer(deviceData.polyline);
    }

    // Create new polyline
    const coordinates = deviceData.lastPoints.map(point => [point.lat, point.lng]);
    const polyline = L.polyline(coordinates, {
        color: '#d4af37',
        weight: 3,
        opacity: 0.7
    });

    trailsLayer.addLayer(polyline);
    deviceData.polyline = polyline;
}

function clearAllMarkers() {
    if (markersGroup) markersGroup.clearLayers();
    if (clusterGroup) clusterGroup.clearLayers();
    if (trailsLayer) trailsLayer.clearLayers();
    deviceRegistry.clear();
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateConnectionStatus(status, text) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    if (statusDot) {
        statusDot.className = `status-dot ${status}`;
    }
    if (statusText) {
        statusText.textContent = text;
    }
}

function updateStatsDisplay(stats) {
    const elements = {
        totalDevices: document.getElementById('totalDevices'),
        onlineDevices: document.getElementById('onlineDevices'),
        totalPositions: document.getElementById('totalPositions'),
        wsClients: document.getElementById('wsClients'),
        uptime: document.getElementById('uptime')
    };

    if (elements.totalDevices) elements.totalDevices.textContent = stats.totalDevices || 0;
    if (elements.onlineDevices) elements.onlineDevices.textContent = stats.onlineDevices || 0;
    if (elements.totalPositions) elements.totalPositions.textContent = stats.totalPositions || 0;
    if (elements.wsClients) elements.wsClients.textContent = stats.wsClients || 0;
    if (elements.uptime) elements.uptime.textContent = formatUptime(stats.uptime || 0);
}

function updateDevicesList() {
    const devicesList = document.getElementById('devicesList');
    const searchInput = document.getElementById('deviceSearch');

    if (!devicesList) return;

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    const devices = Array.from(deviceRegistry.entries())
        .filter(([deviceId]) => deviceId.toLowerCase().includes(searchTerm))
        .map(([deviceId, deviceData]) => {
            const latestPoint = deviceData.lastPoints[deviceData.lastPoints.length - 1];
            const isOnline = latestPoint && (Date.now() - latestPoint.timestamp) < (CONFIG.ONLINE_WINDOW_S * 1000);

            return {
                id: deviceId,
                isOnline,
                coords: latestPoint ? `${latestPoint.lat.toFixed(4)}, ${latestPoint.lng.toFixed(4)}` : 'N/A',
                lastSeen: latestPoint ? new Date(latestPoint.timestamp).toLocaleString() : 'Never'
            };
        });

    if (devices.length === 0) {
        devicesList.innerHTML = '<div class="no-devices">No devices found</div>';
        return;
    }

    devicesList.innerHTML = devices.map(device => `
    <div class="device-item" data-device-id="${device.id}">
      <div class="device-info">
        <div class="device-id">${device.id}</div>
        <div class="device-status ${device.isOnline ? 'online' : 'offline'}">
          ${device.isOnline ? 'Online' : 'Offline'}
        </div>
        <div class="device-coords">${device.coords}</div>
      </div>
    </div>
  `).join('');
}

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function initializeEventListeners() {
    // Map control buttons
    const centerAllBtn = document.getElementById('centerAllBtn');
    const trailsBtn = document.getElementById('trailsBtn');
    const clustersBtn = document.getElementById('clustersBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');

    if (centerAllBtn) centerAllBtn.addEventListener('click', centerAllDevices);
    if (trailsBtn) trailsBtn.addEventListener('click', toggleTrails);
    if (clustersBtn) clustersBtn.addEventListener('click', toggleClusters);
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);

    // Device search
    const deviceSearch = document.getElementById('deviceSearch');
    if (deviceSearch) {
        deviceSearch.addEventListener('input', updateDevicesList);
    }

    // Device list clicks
    const devicesList = document.getElementById('devicesList');
    if (devicesList) {
        devicesList.addEventListener('click', (e) => {
            const deviceItem = e.target.closest('.device-item');
            if (deviceItem) {
                const deviceId = deviceItem.dataset.deviceId;
                focusDevice(deviceId);
            }
        });
    }

    // Fullscreen change events
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

function centerAllDevices() {
    if (!map || deviceRegistry.size === 0) {
        console.log('No devices to center');
        return;
    }

    const bounds = L.latLngBounds();
    deviceRegistry.forEach((deviceData) => {
        if (deviceData.marker) {
            bounds.extend(deviceData.marker.getLatLng());
        }
    });

    if (!bounds.isValid()) {
        console.log('Invalid bounds for centering');
        return;
    }

    map.fitBounds(bounds, { padding: [20, 20] });
}

function toggleTrails() {
    isTrailsEnabled = !isTrailsEnabled;
    const btn = document.getElementById('trailsBtn');

    if (btn) {
        if (isTrailsEnabled) {
            btn.classList.add('active');
            if (map && trailsLayer) map.addLayer(trailsLayer);

            // Update all existing trails
            deviceRegistry.forEach((deviceData, deviceId) => {
                updateDeviceTrail(deviceId, deviceData);
            });
        } else {
            btn.classList.remove('active');
            if (map && trailsLayer) map.removeLayer(trailsLayer);
        }
    }
}

function toggleClusters() {
    if (!clusterGroup || !map) {
        console.warn('Clustering not available');
        return;
    }

    isClustersEnabled = !isClustersEnabled;
    const btn = document.getElementById('clustersBtn');

    if (!btn) return;

    if (isClustersEnabled) {
        btn.classList.add('active');
        map.removeLayer(markersGroup);
        map.addLayer(clusterGroup);

        // Move all markers to cluster group
        deviceRegistry.forEach((deviceData) => {
            if (deviceData.marker) {
                markersGroup.removeLayer(deviceData.marker);
                clusterGroup.addLayer(deviceData.marker);
            }
        });
    } else {
        btn.classList.remove('active');
        map.removeLayer(clusterGroup);
        map.addLayer(markersGroup);

        // Move all markers back to regular group
        deviceRegistry.forEach((deviceData) => {
            if (deviceData.marker) {
                clusterGroup.removeLayer(deviceData.marker);
                markersGroup.addLayer(deviceData.marker);
            }
        });
    }
}

function toggleFullscreen() {
    const mapContainer = document.querySelector('.map-container');

    if (!mapContainer) return;

    if (!isFullscreen) {
        if (mapContainer.requestFullscreen) {
            mapContainer.requestFullscreen();
        } else if (mapContainer.webkitRequestFullscreen) {
            mapContainer.webkitRequestFullscreen();
        } else if (mapContainer.mozRequestFullScreen) {
            mapContainer.mozRequestFullScreen();
        } else if (mapContainer.msRequestFullscreen) {
            mapContainer.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

function handleFullscreenChange() {
    const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );

    isFullscreen = isCurrentlyFullscreen;
    const btn = document.getElementById('fullscreenBtn');

    if (btn) {
        if (isFullscreen) {
            btn.classList.add('active');
            document.body.classList.add('fullscreen');
        } else {
            btn.classList.remove('active');
            document.body.classList.remove('fullscreen');
        }
    }

    // Trigger map resize
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
}

function focusDevice(deviceId) {
    const deviceData = deviceRegistry.get(deviceId);
    if (!deviceData || !deviceData.marker || !map) {
        console.warn('Device not found:', deviceId);
        return;
    }

    const latLng = deviceData.marker.getLatLng();
    map.setView(latLng, Math.max(map.getZoom(), 15));

    // Open popup
    deviceData.marker.openPopup();
}

// ============================================================================
// STATISTICS
// ============================================================================

function initializeStats() {
    // Fetch initial stats
    fetchStats();

    // Update stats every 5 seconds
    statsInterval = setInterval(fetchStats, 5000);
}

// ============================================================================
// CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }
    if (pollInterval) {
        clearInterval(pollInterval);
    }
    if (statsInterval) {
        clearInterval(statsInterval);
    }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});