module.exports = {
    apps: [{
        name: 'gps-tracker-server',
        script: 'server.js',
        instances: 1,
        exec_mode: 'cluster',
        env: {
            NODE_ENV: 'production',
            PORT: 3000,
            PUBLIC_ORIGIN: 'http://localhost:3000',
            SQLITE_FILE: './data/tracker.sqlite',
            DEVICE_TOKEN: process.env.DEVICE_TOKEN || 'default_token',
            HISTORY_POINTS: 500,
            ONLINE_WINDOW_S: 60,
            MQTT_ENABLED: 'true',
            MQTT_BROKER_HOST: process.env.MQTT_BROKER_HOST || 'localhost',
            MQTT_PORT: 1883,
            MQTT_USERNAME: process.env.MQTT_USERNAME || 'tracker_user',
            MQTT_PASSWORD: process.env.MQTT_PASSWORD || 'abhayd95'
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: 3000,
            PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || 'https://yourdomain.com',
            SQLITE_FILE: './data/tracker.sqlite',
            DEVICE_TOKEN: process.env.DEVICE_TOKEN,
            HISTORY_POINTS: 500,
            ONLINE_WINDOW_S: 60,
            MQTT_ENABLED: 'true',
            MQTT_BROKER_HOST: process.env.MQTT_BROKER_HOST,
            MQTT_PORT: 1883,
            MQTT_USERNAME: process.env.MQTT_USERNAME,
            MQTT_PASSWORD: process.env.MQTT_PASSWORD
        },
        // Logging
        log_file: './logs/combined.log',
        out_file: './logs/out.log',
        error_file: './logs/error.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

        // Process management
        max_memory_restart: '1G',
        min_uptime: '10s',
        max_restarts: 10,

        // Monitoring
        watch: false,
        ignore_watch: ['node_modules', 'logs', 'data'],

        // Auto restart
        autorestart: true,

        // Advanced features
        kill_timeout: 5000,
        listen_timeout: 3000,
        shutdown_with_message: true
    }],

    // Deployment configuration
    deploy: {
        production: {
            user: 'deploy',
            host: ['your-server.com'],
            ref: 'origin/main',
            repo: 'git@github.com:yourusername/gps-tracker.git',
            path: '/var/www/gps-tracker',
            'pre-deploy-local': '',
            'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
            'pre-setup': ''
        }
    }
};