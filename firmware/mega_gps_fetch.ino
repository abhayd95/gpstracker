/*
 * Arduino Mega GPS Data Fetcher with SIM800L 2G + NEO-6M GPS
 * Fetches GPS data and sends to server via HTTP POST
 * 
 * Hardware: Arduino Mega + SIM800L + NEO-6M GPS
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
#define DEVICE_TOKEN "<DEVICE_TOKEN>"         // e.g., "test_token_123"

// SIM800L Configuration
#define APN "<APN>"                          // e.g., "internet" or "data"

// Fetching Intervals (milliseconds)
#define GPS_FETCH_INTERVAL 2000              // Fetch GPS every 2 seconds
#define SEND_INTERVAL 10000                  // Send to server every 10 seconds
#define MIN_SPEED_KMH 1.0                    // Minimum speed to consider moving

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

// GPS Data Structure
struct GPSData {
  float latitude;
  float longitude;
  float speed;
  int heading;
  int satellites;
  unsigned long timestamp;
  bool isValid;
} currentGPS;

// Timing variables
unsigned long lastGPSFetch = 0;
unsigned long lastDataSend = 0;
unsigned long lastSIM800LCheck = 0;

// Connection status
bool sim800LConnected = false;
int connectionAttempts = 0;
const int maxConnectionAttempts = 5;

// ============================================================================
// SETUP FUNCTION
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("Arduino Mega GPS Data Fetcher Starting...");
  Serial.println("Device ID: " + String(DEVICE_ID));
  
  // Initialize SIM800L
  simSerial.begin(9600);
  delay(1000);
  
  // Initialize GPS
  gpsSerial.begin(9600);
  delay(1000);
  
  // Initialize GPS data structure
  resetGPSData();
  
  // Initialize SIM800L module
  initializeSIM800L();
  
  Serial.println("Setup complete. Starting main loop...");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // Check SIM800L connection status periodically
  if (millis() - lastSIM800LCheck > 30000) { // Every 30 seconds
    checkSIM800LConnection();
    lastSIM800LCheck = millis();
  }
  
  // Fetch GPS data at regular intervals
  if (millis() - lastGPSFetch >= GPS_FETCH_INTERVAL) {
    fetchGPSData();
    lastGPSFetch = millis();
  }
  
  // Send data to server at regular intervals
  if (millis() - lastDataSend >= SEND_INTERVAL) {
    if (currentGPS.isValid && sim800LConnected) {
      sendDataToServer();
      lastDataSend = millis();
    }
  }
  
  delay(100);
}

// ============================================================================
// GPS DATA FETCHING
// ============================================================================

void fetchGPSData() {
  while (gpsSerial.available() > 0) {
    if (gps.encode(gpsSerial.read())) {
      if (gps.location.isValid()) {
        currentGPS.latitude = gps.location.lat();
        currentGPS.longitude = gps.location.lng();
        currentGPS.speed = gps.speed.kmph();
        currentGPS.heading = gps.course.deg();
        currentGPS.satellites = gps.satellites.value();
        currentGPS.timestamp = millis();
        currentGPS.isValid = true;
        
        // Log GPS data
        Serial.println("GPS: " + String(currentGPS.latitude, 6) + "," + 
                      String(currentGPS.longitude, 6) + 
                      " Speed: " + String(currentGPS.speed, 1) + " km/h" +
                      " Sats: " + String(currentGPS.satellites));
      } else {
        currentGPS.isValid = false;
        Serial.println("GPS: No valid fix");
      }
    }
  }
}

// ============================================================================
// SERVER COMMUNICATION
// ============================================================================

void sendDataToServer() {
  if (!currentGPS.isValid) {
    Serial.println("No valid GPS data to send");
    return;
  }
  
  // Create JSON payload
  DynamicJsonDocument doc(512);
  doc["device_id"] = DEVICE_ID;
  doc["lat"] = currentGPS.latitude;
  doc["lng"] = currentGPS.longitude;
  doc["speed"] = currentGPS.speed;
  doc["heading"] = currentGPS.heading;
  doc["sats"] = currentGPS.satellites;
  doc["ts"] = currentGPS.timestamp;
  
  String payload;
  serializeJson(doc, payload);
  
  // Send HTTP POST request
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + "/api/track";
  
  // Use SIM800L for HTTP request
  sendHTTPRequest(url, payload);
}

void sendHTTPRequest(String url, String payload) {
  Serial.println("Sending HTTP request to: " + url);
  
  // Initialize HTTP session
  sendATCommand("AT+HTTPINIT");
  delay(1000);
  
  // Set URL
  String urlCmd = "AT+HTTPPARA=\"URL\",\"" + url + "\"";
  sendATCommand(urlCmd);
  delay(1000);
  
  // Set content type
  sendATCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
  delay(1000);
  
  // Set data
  String dataCmd = "AT+HTTPDATA=" + String(payload.length()) + ",10000";
  sendATCommand(dataCmd);
  delay(1000);
  
  // Send payload
  simSerial.print(payload);
  delay(2000);
  
  // Send request
  sendATCommand("AT+HTTPACTION=1");
  delay(5000);
  
  // Read response
  String response = readSIM800LResponse();
  if (response.indexOf("200") >= 0) {
    Serial.println("Data sent successfully!");
  } else {
    Serial.println("Failed to send data. Response: " + response);
  }
  
  // Terminate HTTP session
  sendATCommand("AT+HTTPTERM");
  delay(1000);
}

// ============================================================================
// SIM800L FUNCTIONS
// ============================================================================

void initializeSIM800L() {
  Serial.println("Initializing SIM800L...");
  
  // Basic AT commands
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
  
  // Check connection status
  checkSIM800LConnection();
  
  Serial.println("SIM800L initialization complete");
}

void checkSIM800LConnection() {
  sendATCommand("AT+SAPBR=2,1");
  String response = readSIM800LResponse();
  
  if (response.indexOf("+SAPBR: 1,1") >= 0) {
    sim800LConnected = true;
    connectionAttempts = 0;
    Serial.println("SIM800L connected");
  } else {
    sim800LConnected = false;
    connectionAttempts++;
    Serial.println("SIM800L disconnected. Attempt: " + String(connectionAttempts));
    
    // Try to reconnect
    if (connectionAttempts < maxConnectionAttempts) {
      sendATCommand("AT+SAPBR=0,1");
      delay(2000);
      sendATCommand("AT+SAPBR=1,1");
      delay(5000);
    }
  }
}

void sendATCommand(String command) {
  Serial.println("AT> " + command);
  simSerial.println(command);
  delay(1000);
}

String readSIM800LResponse() {
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
  
  Serial.println("AT< " + response);
  return response;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

void resetGPSData() {
  currentGPS.latitude = 0;
  currentGPS.longitude = 0;
  currentGPS.speed = 0;
  currentGPS.heading = 0;
  currentGPS.satellites = 0;
  currentGPS.timestamp = 0;
  currentGPS.isValid = false;
}

// ============================================================================
// ADDITIONAL GPS FUNCTIONS
// ============================================================================

void printGPSInfo() {
  Serial.println("=== GPS Information ===");
  Serial.println("Valid: " + String(gps.location.isValid() ? "Yes" : "No"));
  Serial.println("Latitude: " + String(gps.location.lat(), 6));
  Serial.println("Longitude: " + String(gps.location.lng(), 6));
  Serial.println("Speed: " + String(gps.speed.kmph(), 1) + " km/h");
  Serial.println("Course: " + String(gps.course.deg()) + " degrees");
  Serial.println("Satellites: " + String(gps.satellites.value()));
  Serial.println("Date: " + String(gps.date.day()) + "/" + 
                String(gps.date.month()) + "/" + String(gps.date.year()));
  Serial.println("Time: " + String(gps.time.hour()) + ":" + 
                String(gps.time.minute()) + ":" + String(gps.time.second()));
  Serial.println("=======================");
}

void printGPSRaw() {
  Serial.println("=== Raw GPS Data ===");
  Serial.println("Chars processed: " + String(gps.charsProcessed()));
  Serial.println("Sentences with fix: " + String(gps.sentencesWithFix()));
  Serial.println("Failed checksum: " + String(gps.failedChecksum()));
  Serial.println("Passed checksum: " + String(gps.passedChecksum()));
  Serial.println("===================");
}
