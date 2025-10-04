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
    updated_at INTEGER DEFAULT (strftime('%s', 'now')
);

-- Positions table - stores position history
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
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_positions_device_id ON positions(device_id);
CREATE INDEX IF NOT EXISTS idx_positions_timestamp ON positions(timestamp);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);

-- Triggers to automatically update the updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_devices_timestamp 
    AFTER UPDATE ON devices
    FOR EACH ROW
    BEGIN
        UPDATE devices SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
    END;

-- View for online devices (last seen within 60 seconds)
CREATE VIEW IF NOT EXISTS online_devices AS
SELECT 
    device_id,
    last_lat,
    last_lng,
    last_speed,
    last_heading,
    last_sats,
    last_seen,
    (strftime('%s', 'now') - last_seen) as seconds_ago
FROM devices 
WHERE last_seen > (strftime('%s', 'now') - 60);

-- View for device statistics
CREATE VIEW IF NOT EXISTS device_stats AS
SELECT 
    d.device_id,
    d.last_seen,
    d.last_lat,
    d.last_lng,
    d.last_speed,
    d.last_heading,
    d.last_sats,
    COUNT(p.id) as total_positions,
    MIN(p.timestamp) as first_seen,
    MAX(p.timestamp) as last_position,
    AVG(p.speed) as avg_speed,
    MAX(p.speed) as max_speed
FROM devices d
LEFT JOIN positions p ON d.device_id = p.device_id
GROUP BY d.device_id;

