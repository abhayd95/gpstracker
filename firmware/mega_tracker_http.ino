/*
 * Arduino Mega GPS Tracker with SIM800L 2G Module
 * Fallback device implementation using HTTP POST
 * 
 * Hardware:
 * - Arduino Mega 2560
 * - SIM800L 2G Module
 * - NEO-6M GPS Module
 * 
 * Features:
 * - Real-time GPS tracking via HTTP POST
 * - Automatic reconnection with exponential backoff
 * - Configurable reporting intervals
 * - External NEO-6M GPS module
 */

#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <ArduinoJson.h>

// ============================================================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================================================

// Server Configuration
#define SERVER_HOST "<SERVER_HOST>"           // e.g., "192.168.1.100" or "yourdomain.com"
#define SERVER_PORT 3000                      // Server port
#define DEVICE_ID "<DEVICE_ID>"               // e.g., "MEGA_001"
#define DEVICE_TOKEN "<DEVICE_TOKEN>"         // e.g., "your_secret_token"

// SIM800L Configuration
#define APN "<APN>"                          // e.g., "internet" or "data"

// Reporting Intervals (milliseconds)
#define MOVING_INTERVAL 30000    // 30 seconds when moving
#define IDLE_INTERVAL 120000     // 2 minutes when idle
#define MIN_SPEED_KMH 2.0        // Speed threshold for "moving" status

// Hardware Pins
#define SIM800L_TX_PIN 10
#define SIM800L_RX_PIN 11
#define NEO6M_TX_PIN 8
#define NEO6M_RX_PIN 9

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

SoftwareSerial simSerial(SIM800L_RX_PIN, SIM800L_TX_PIN);  // SIM800L
SoftwareSerial gpsSerial(NEO6M_RX_PIN, NEO6M_TX_PIN);      // NEO-6M

TinyGPSPlus gps;

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
unsigned long reconnectDelay = 5000;
const unsigned long maxReconnectDelay = 60000;
bool isConnected = false;

// ============================================================================
// SETUP FUNCTION
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("Arduino Mega GPS Tracker Starting...");
  Serial.println("Device ID: " + String(DEVICE_ID));
  
  // Initialize SIM800L
  simSerial.begin(9600);
  delay(1000);
  
  // Initialize GPS
  gpsSerial.begin(9600);
  delay(1000);
  
  // Initialize SIM800L module
  initializeSIM800L();
  
  Serial.println("Setup complete. Starting main loop...");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // Process GPS data
  processGPS();
  
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
// SIM800L FUNCTIONS
// ============================================================================

void initializeSIM800L() {
  Serial.println("Initializing SIM800L...");
  
  // Power on sequence
  sendATCommand("AT");
  delay(2000);
  
  // Check SIM card
  sendATCommand("AT+CPIN?");
  delay(3000);
  
  // Set APN
  String apnCmd = "AT+SAPBR=3,1,\"APN\",\"" + String(APN) + "\"";
  sendATCommand(apnCmd);
  delay(2000);
  
  // Open bearer
  sendATCommand("AT+SAPBR=1,1");
  delay(5000);
  
  // Check network registration
  sendATCommand("AT+CREG?");
  delay(2000);
  
  // Check signal quality
  sendATCommand("AT+CSQ");
  delay(2000);
  
  // Get IP address
  sendATCommand("AT+SAPBR=2,1");
  delay(2000);
  
  Serial.println("SIM800L initialization complete");
}

void sendATCommand(String command) {
  Serial.println("Sending: " + command);
  simSerial.println(command);
  delay(1000);
  
  String response = "";
  unsigned long timeout = millis() + 10000;
  
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
  
  // Check for connection status
  if (response.indexOf("+SAPBR: 1,1") >= 0) {
    isConnected = true;
  } else if (response.indexOf("+SAPBR: 1,0") >= 0) {
    isConnected = false;
  }
}

// ============================================================================
// GPS FUNCTIONS
// ============================================================================

void processGPS() {
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
// HTTP FUNCTIONS
// ============================================================================

void sendLocationUpdate() {
  if (!isConnected) {
    Serial.println("SIM800L not connected, attempting reconnection...");
    reconnectSIM800L();
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
  
  // Send HTTP POST request
  String httpRequest = "POST /api/track HTTP/1.1\r\n";
  httpRequest += "Host: " + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "\r\n";
  httpRequest += "Content-Type: application/json\r\n";
  httpRequest += "Content-Length: " + String(payload.length()) + "\r\n";
  httpRequest += "X-Device-Token: " + String(DEVICE_TOKEN) + "\r\n";
  httpRequest += "Connection: close\r\n\r\n";
  httpRequest += payload;
  
  // Send request
  sendATCommand("AT+HTTPINIT");
  delay(1000);
  
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "/api/track";
  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + url + "\"";
  sendATCommand(urlCmd);
  delay(1000);
  
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
  delay(1000);
  
  // Set data
  String dataCmd = "AT+HTTPDATA=" + String(payload.length()) + ",10000";
  sendATCommand(dataCmd);
  delay(1000);
  
  simSerial.print(payload);
  delay(2000);
  
  // Send request
  sendATCommand("AT+HTTPACTION=1");
  delay(5000);
  
  // Read response
  sendATCommand("AT+HTTPREAD");
  delay(2000);
  
  // Terminate HTTP session
  sendATCommand("AT+HTTPTERM");
  delay(1000);
  
  Serial.println("Location sent: " + payload);
}

void reconnectSIM800L() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastReconnectAttempt >= reconnectDelay) {
    Serial.println("Attempting SIM800L reconnection...");
    
    // Close any existing bearer
    sendATCommand("AT+SAPBR=0,1");
    delay(2000);
    
    // Reinitialize connection
    initializeSIM800L();
    
    lastReconnectAttempt = currentTime;
    
    // Exponential backoff
    reconnectDelay *= 2;
    if (reconnectDelay > maxReconnectDelay) {
      reconnectDelay = maxReconnectDelay;
    }
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
// ALTERNATIVE HTTP IMPLEMENTATION (Query Parameter Token)
// ============================================================================

/*
 * If your server doesn't support X-Device-Token header, 
 * you can use query parameter instead:
 * 
 * Replace the sendLocationUpdate() function with this version:
 */

void sendLocationUpdateWithQueryToken() {
  if (!isConnected) {
    Serial.println("SIM800L not connected, attempting reconnection...");
    reconnectSIM800L();
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
  
  // Send HTTP POST request with token as query parameter
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + 
               "/api/track?token=" + String(DEVICE_TOKEN);
  
  String httpRequest = "POST " + url + " HTTP/1.1\r\n";
  httpRequest += "Host: " + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "\r\n";
  httpRequest += "Content-Type: application/json\r\n";
  httpRequest += "Content-Length: " + String(payload.length()) + "\r\n";
  httpRequest += "Connection: close\r\n\r\n";
  httpRequest += payload;
  
  // Send request (same AT commands as above)
  sendATCommand("AT+HTTPINIT");
  delay(1000);
  
  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + url + "\"";
  sendATCommand(urlCmd);
  delay(1000);
  
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
  delay(1000);
  
  String dataCmd = "AT+HTTPDATA=" + String(payload.length()) + ",10000";
  sendATCommand(dataCmd);
  delay(1000);
  
  simSerial.print(payload);
  delay(2000);
  
  sendATCommand("AT+HTTPACTION=1");
  delay(5000);
  
  sendATCommand("AT+HTTPREAD");
  delay(2000);
  
  sendATCommand("AT+HTTPTERM");
  delay(1000);
  
  Serial.println("Location sent: " + payload);
}
