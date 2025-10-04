# GPS Tracker Hardware Wiring Guide

## ESP32 + SIM7600 4G LTE Setup (Primary Device)

### Pin Connections

| ESP32 Pin | SIM7600 Pin | Description |
|-----------|-------------|-------------|
| GPIO 16   | TX          | SIM7600 Transmit |
| GPIO 17   | RX          | SIM7600 Receive |
| 3.3V      | VCC         | Power (3.3V) |
| GND       | GND         | Ground |
| GPIO 2    | PWR         | Power control (optional) |

### Optional External NEO-6M GPS

| ESP32 Pin | NEO-6M Pin | Description |
|-----------|------------|-------------|
| GPIO 18   | TX         | NEO-6M Transmit |
| GPIO 19   | RX         | NEO-6M Receive |
| 3.3V      | VCC        | Power (3.3V) |
| GND       | GND        | Ground |

### Power Requirements

```
Vehicle 12V → Buck Converter 5V → ESP32 (3.3V regulator)
                    ↓
              SIM7600 (4.0-4.2V)
                    ↓
              2200µF Capacitor (near modem)
                    ↓
              2A Fuse + Common GND
```

### ASCII Wiring Diagram

```
ESP32 Dev Board
┌─────────────────┐
│ 3.3V  GND  GPIO16│
│ 5V    GND  GPIO17│
│ GND   GPIO2 GPIO18│
│ GND   GPIO3 GPIO19│
└─────────────────┘
    │    │    │    │
    │    │    │    └─── NEO-6M TX (if using external GPS)
    │    │    └─────── NEO-6M RX (if using external GPS)
    │    └──────────── SIM7600 RX
    └───────────────── SIM7600 TX

SIM7600 Module
┌─────────────────┐
│ VCC  GND  TX  RX│
│ PWR  RST  ANT   │
└─────────────────┘
    │    │    │    │
    │    │    │    └─── ESP32 GPIO17
    │    │    └──────── ESP32 GPIO16
    │    └───────────── GND
    └────────────────── 3.3V

NEO-6M GPS (Optional)
┌─────────────────┐
│ VCC  GND  TX  RX│
└─────────────────┘
    │    │    │    │
    │    │    │    └─── ESP32 GPIO18
    │    │    └──────── ESP32 GPIO19
    │    └───────────── GND
    └────────────────── 3.3V
```

## Arduino Mega + SIM800L 2G Setup (Fallback Device)

### Pin Connections

| Arduino Mega Pin | SIM800L Pin | Description |
|------------------|-------------|-------------|
| Digital 10       | TX          | SIM800L Transmit |
| Digital 11       | RX          | SIM800L Receive |
| 5V               | VCC         | Power (5V) |
| GND              | GND         | Ground |
| Digital 2        | PWR         | Power control (optional) |

### NEO-6M GPS Module

| Arduino Mega Pin | NEO-6M Pin | Description |
|------------------|------------|-------------|
| Digital 8        | TX         | NEO-6M Transmit |
| Digital 9        | RX         | NEO-6M Receive |
| 5V               | VCC        | Power (5V) |
| GND              | GND        | Ground |

### Power Requirements

```
Vehicle 12V → Buck Converter 5V → Arduino Mega
                    ↓
              SIM800L (3.7-4.2V)
                    ↓
              2200µF Capacitor (near modem)
                    ↓
              2A Fuse + Common GND
```

### ASCII Wiring Diagram

```
Arduino Mega 2560
┌─────────────────┐
│ 5V   GND  D8  D9│
│ 3.3V GND  D10 D11│
│ GND  D2   D12 D13│
└─────────────────┘
    │    │    │    │
    │    │    │    └─── SIM800L TX
    │    │    └──────── SIM800L RX
    │    └───────────── NEO-6M TX
    └────────────────── NEO-6M RX

SIM800L Module
┌─────────────────┐
│ VCC  GND  TX  RX│
│ PWR  RST  ANT   │
└─────────────────┘
    │    │    │    │
    │    │    │    └─── Arduino D10
    │    │    └──────── Arduino D11
    │    └───────────── GND
    └────────────────── 5V

NEO-6M GPS
┌─────────────────┐
│ VCC  GND  TX  RX│
└─────────────────┘
    │    │    │    │
    │    │    │    └─── Arduino D8
    │    │    └──────── Arduino D9
    │    └───────────── GND
    └────────────────── 5V
```

## Power Supply Considerations

### ESP32 + SIM7600 Power Requirements
- **ESP32**: 3.3V, ~240mA (active), ~10mA (sleep)
- **SIM7600**: 4.0-4.2V, ~2A peak (transmit), ~1mA (idle)
- **Total Peak**: ~2.25A
- **Recommended**: 3A buck converter with 2200µF capacitor

### Arduino Mega + SIM800L Power Requirements
- **Arduino Mega**: 5V, ~200mA (active)
- **SIM800L**: 3.7-4.2V, ~2A peak (transmit), ~1mA (idle)
- **Total Peak**: ~2.2A
- **Recommended**: 3A buck converter with 2200µF capacitor

### Power Supply Circuit

```
Vehicle 12V Battery
        │
        ├── 2A Fuse
        │
        └── Buck Converter (12V → 5V/3.3V)
                    │
                    ├── 2200µF Capacitor (near modem)
                    │
                    ├── ESP32/Arduino (3.3V/5V)
                    │
                    └── SIM Module (4.0-4.2V)
```

## Antenna Considerations

### SIM7600 Antennas
- **4G LTE Antenna**: External antenna recommended for better signal
- **GPS Antenna**: Internal GNSS antenna (or external if using NEO-6M)
- **Placement**: Mount antennas outside metal enclosures for best performance

### SIM800L Antennas
- **2G Antenna**: External antenna required for reliable connection
- **GPS Antenna**: External NEO-6M antenna
- **Placement**: Mount antennas outside metal enclosures for best performance

## Important Notes

### Network Configuration
- **Device cannot reach "localhost"** - Use LAN IP address or public DNS
- **Example**: `192.168.1.100:3000` or `yourdomain.com:3000`
- **Firewall**: Ensure server ports are accessible from device network

### GPS Performance
- **Cold Start**: 30-60 seconds for first fix
- **Warm Start**: 5-15 seconds
- **Hot Start**: 1-3 seconds
- **Sky View**: GPS requires clear view of sky for best performance
- **Indoor**: GPS may not work indoors or in tunnels

### SIM Card Configuration
- **APN Settings**: Contact carrier for correct APN
- **Data Plan**: Ensure sufficient data allowance
- **Roaming**: Check roaming settings if traveling

### Troubleshooting

#### No GPS Signal
1. Check antenna connections
2. Ensure clear sky view
3. Wait for cold start (up to 60 seconds)
4. Check GPS module power

#### No Network Connection
1. Check SIM card insertion
2. Verify APN settings
3. Check signal strength (`AT+CSQ`)
4. Verify network registration (`AT+CREG?`)

#### Power Issues
1. Check fuse rating (2A minimum)
2. Verify capacitor placement (near modem)
3. Check voltage levels with multimeter
4. Ensure common ground connections

### Safety Considerations
- **Fuse Protection**: Always use appropriate fuses
- **Ground Isolation**: Consider opto-isolation for vehicle integration
- **EMI Shielding**: Shield sensitive electronics from vehicle EMI
- **Heat Management**: Ensure adequate ventilation for buck converters
- **Waterproofing**: Use appropriate enclosures for outdoor installation
