/*
 * ESP32 GPS Tracker with SIM7600 4G LTE Module
 * Primary device implementation using MQTT
 * 
 * Hardware:
 * - ESP32 Dev Board
 * - SIM7600 4G LTE Module with internal GNSS
 * - Optional: External NEO-6M GPS module
 * 
 * Features:
 * - Real-time GPS tracking via MQTT
 * - Automatic reconnection with exponential backoff
 * - Configurable reporting intervals (moving: 15s, idle: 60s)
 * - Internal GNSS preferred, external NEO-6M fallback
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>

// ============================================================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================================================

// MQTT Configuration
#define MQTT_BROKER_HOST "<MQTT_BROKER_HOST>"  // e.g., "broker.hivemq.com"
#define MQTT_PORT <MQTT_PORT>                  // e.g., 1883
#define MQTT_USERNAME "<MQTT_USERNAME>"        // e.g., "tracker_user"
#define MQTT_PASSWORD "<MQTT_PASSWORD>"        // e.g., "abhayd95"
#define DEVICE_ID "<DEVICE_ID>"                // e.g., "ESP32_001"

// SIM7600 Configuration
#define APN "<APN>"                            // e.g., "internet" or "data"

// Reporting Intervals (milliseconds)
#define MOVING_INTERVAL 15000    // 15 seconds when moving
#define IDLE_INTERVAL 60000      // 60 seconds when idle
#define MIN_SPEED_KMH 2.0        // Speed threshold for "moving" status

// Hardware Pins
#define SIM7600_TX_PIN 16
#define SIM7600_RX_PIN 17
#define NEO6M_TX_PIN 18         // Only if using external NEO-6M
#define NEO6M_RX_PIN 19         // Only if using external NEO-6M

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
HardwareSerial simSerial(2);    // UART2 for SIM7600
HardwareSerial gpsSerial(1);    // UART1 for external NEO-6M (if used)

TinyGPSPlus gps;                // For external NEO-6M only
bool useExternalGPS = false;    // Set to true if using external NEO-6M

// Tracking variables
unsigned long lastReport = 0;
unsigned long lastPositionUpdate = 0;
float lastLat = 0, lastLng = 0;
float currentSpeed = 0;
int currentHeading = 0;
int satelliteCount = 0;
bool isMoving = false;

// Connection management
unsigned long lastReconnectAttempt = 0;
unsigned long reconnectDelay = 1000;
const unsigned long maxReconnectDelay = 30000;

// ============================================================================
// SETUP FUNCTION
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("ESP32 GPS Tracker Starting...");
  Serial.println("Device ID: " + String(DEVICE_ID));
  
  // Initialize SIM7600 UART
  simSerial.begin(115200, SERIAL_8N1, SIM7600_TX_PIN, SIM7600_RX_PIN);
  
  // Initialize external GPS UART (if using NEO-6M)
  if (useExternalGPS) {
    gpsSerial.begin(9600, SERIAL_8N1, NEO6M_TX_PIN, NEO6M_RX_PIN);
    Serial.println("External NEO-6M GPS initialized");
  }
  
  // Initialize SIM7600 module
  initializeSIM7600();
  
  // Initialize MQTT
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  
  Serial.println("Setup complete. Starting main loop...");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // Maintain MQTT connection
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();
  
  // Process GPS data
  if (useExternalGPS) {
    processExternalGPS();
  } else {
    processSIM7600GPS();
  }
  
  // Check if it's time to report
  unsigned long currentTime = millis();
  unsigned long reportInterval = isMoving ? MOVING_INTERVAL : IDLE_INTERVAL;
  
  if (currentTime - lastReport >= reportInterval) {
    if (hasValidGPS()) {
      sendLocationUpdate();
      lastReport = currentTime;
    }
  }
  
  delay(100);
}

// ============================================================================
// SIM7600 FUNCTIONS
// ============================================================================

void initializeSIM7600() {
  Serial.println("Initializing SIM7600...");
  
  // Power on sequence
  sendATCommand("AT");
  delay(1000);
  
  // Check SIM card
  sendATCommand("AT+CPIN?");
  delay(2000);
  
  // Set APN
  String apnCmd = "AT+CGDCONT=1,\"IP\",\"" + String(APN) + "\"";
  sendATCommand(apnCmd);
  delay(2000);
  
  // Activate PDP context
  sendATCommand("AT+CGACT=1,1");
  delay(5000);
  
  // Check network registration
  sendATCommand("AT+CREG?");
  delay(2000);
  
  // Check signal quality
  sendATCommand("AT+CSQ");
  delay(2000);
  
  // Enable GNSS
  sendATCommand("AT+CGNSPWR=1");
  delay(2000);
  
  Serial.println("SIM7600 initialization complete");
}

void sendATCommand(String command) {
  Serial.println("Sending: " + command);
  simSerial.println(command);
  delay(500);
  
  String response = "";
  unsigned long timeout = millis() + 5000;
  
  while (millis() < timeout) {
    if (simSerial.available()) {
      char c = simSerial.read();
      response += c;
      if (response.endsWith("OK") || response.endsWith("ERROR")) {
        break;
      }
    }
  }
  
  Serial.println("Response: " + response);
}

void processSIM7600GPS() {
  if (simSerial.available()) {
    String response = simSerial.readString();
    
    // Parse GNSS response
    if (response.indexOf("+CGNSINF:") >= 0) {
      parseSIM7600GPS(response);
    }
  }
}

void parseSIM7600GPS(String response) {
  // Parse +CGNSINF response format
  // +CGNSINF: <run>,<fix>,<utc>,<lat>,<lon>,<alt>,<speed>,<course>,<fix_mode>,<reserved1>,<hdop>,<pdop>,<vdop>,<reserved2>,<gps_sat>,<glonass_sat>,<reserved3>,<c_n0_max>,<hpa>,<vpa>
  
  int startIndex = response.indexOf("+CGNSINF:") + 9;
  String data = response.substring(startIndex);
  
  // Split by comma
  int commaIndex = 0;
  int fieldIndex = 0;
  String fields[20];
  
  for (int i = 0; i < data.length(); i++) {
    if (data.charAt(i) == ',') {
      fields[fieldIndex] = data.substring(commaIndex, i);
      commaIndex = i + 1;
      fieldIndex++;
    }
  }
  fields[fieldIndex] = data.substring(commaIndex);
  
  // Extract relevant data
  if (fieldIndex >= 6) {
    int fixStatus = fields[1].toInt();
    
    if (fixStatus == 1) {  // Valid fix
      lastLat = fields[3].toFloat();
      lastLng = fields[4].toFloat();
      currentSpeed = fields[6].toFloat() * 3.6; // Convert m/s to km/h
      currentHeading = fields[7].toInt();
      satelliteCount = fields[14].toInt() + fields[15].toInt(); // GPS + GLONASS
      
      isMoving = (currentSpeed > MIN_SPEED_KMH);
      lastPositionUpdate = millis();
      
      Serial.println("GPS: " + String(lastLat, 6) + "," + String(lastLng, 6) + 
                    " Speed: " + String(currentSpeed, 1) + " km/h");
    }
  }
}

// ============================================================================
// EXTERNAL GPS FUNCTIONS (NEO-6M)
// ============================================================================

void processExternalGPS() {
  while (gpsSerial.available() > 0) {
    if (gps.encode(gpsSerial.read())) {
      if (gps.location.isValid()) {
        lastLat = gps.location.lat();
        lastLng = gps.location.lng();
        currentSpeed = gps.speed.kmph();
        currentHeading = gps.course.deg();
        satelliteCount = gps.satellites.value();
        
        isMoving = (currentSpeed > MIN_SPEED_KMH);
        lastPositionUpdate = millis();
        
        Serial.println("GPS: " + String(lastLat, 6) + "," + String(lastLng, 6) + 
                      " Speed: " + String(currentSpeed, 1) + " km/h");
      }
    }
  }
}

// ============================================================================
// MQTT FUNCTIONS
// ============================================================================

void reconnectMQTT() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastReconnectAttempt >= reconnectDelay) {
    Serial.println("Attempting MQTT connection...");
    
    if (mqttClient.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
      Serial.println("MQTT connected");
      reconnectDelay = 1000; // Reset delay on successful connection
    } else {
      Serial.println("MQTT connection failed, rc=" + String(mqttClient.state()));
      lastReconnectAttempt = currentTime;
      
      // Exponential backoff
      reconnectDelay *= 2;
      if (reconnectDelay > maxReconnectDelay) {
        reconnectDelay = maxReconnectDelay;
      }
    }
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  
  Serial.println("MQTT received: " + String(topic) + " - " + message);
}

void sendLocationUpdate() {
  if (!mqttClient.connected()) {
    Serial.println("MQTT not connected, skipping update");
    return;
  }
  
  // Create JSON payload
  DynamicJsonDocument doc(512);
  doc["device_id"] = DEVICE_ID;
  doc["lat"] = lastLat;
  doc["lng"] = lastLng;
  doc["speed"] = currentSpeed;
  doc["heading"] = currentHeading;
  doc["sats"] = satelliteCount;
  doc["ts"] = millis();
  
  String payload;
  serializeJson(doc, payload);
  
  // Publish to MQTT topic
  String topic = "track/" + String(DEVICE_ID);
  bool success = mqttClient.publish(topic.c_str(), payload.c_str());
  
  if (success) {
    Serial.println("Location sent: " + payload);
  } else {
    Serial.println("Failed to send location");
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

bool hasValidGPS() {
  return (lastLat != 0 && lastLng != 0 && 
          (millis() - lastPositionUpdate) < 300000); // 5 minutes timeout
}

// ============================================================================
// CONFIGURATION FOR EXTERNAL NEO-6M GPS
// ============================================================================

/*
 * To use external NEO-6M GPS module instead of SIM7600 internal GNSS:
 * 
 * 1. Set useExternalGPS = true at the top of this file
 * 2. Wire NEO-6M as follows:
 *    - VCC → 3.3V
 *    - GND → GND
 *    - TX → GPIO 19 (NEO6M_TX_PIN)
 *    - RX → GPIO 18 (NEO6M_RX_PIN)
 * 
 * 3. Install TinyGPSPlus library in Arduino IDE:
 *    - Tools → Manage Libraries → Search "TinyGPSPlus" → Install
 * 
 * 4. The code will automatically use external GPS when useExternalGPS = true
 * 
 * Note: External GPS may provide better accuracy in some environments
 * but requires additional hardware and wiring.
 */
