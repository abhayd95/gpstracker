/*
 * ESP32 GPS Data Fetcher with SIM7600 4G LTE
 * Fetches GPS data and sends to server via HTTP POST
 * 
 * Hardware: ESP32 + SIM7600 + Optional NEO-6M GPS
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>

// ============================================================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================================================

// Server Configuration
#define SERVER_HOST "<SERVER_HOST>"           // e.g., "192.168.1.100" or "yourdomain.com"
#define SERVER_PORT 3000                      // Server port
#define DEVICE_ID "<DEVICE_ID>"               // e.g., "ESP32_001"
#define DEVICE_TOKEN "<DEVICE_TOKEN>"         // e.g., "test_token_123"

// SIM7600 Configuration
#define APN "<APN>"                          // e.g., "internet" or "data"

// Fetching Intervals (milliseconds)
#define GPS_FETCH_INTERVAL 5000              // Fetch GPS every 5 seconds
#define SEND_INTERVAL 15000                  // Send to server every 15 seconds
#define MIN_SPEED_KMH 1.0                    // Minimum speed to consider moving

// Hardware Pins
#define SIM7600_TX_PIN 16
#define SIM7600_RX_PIN 17
#define NEO6M_TX_PIN 18                     // Only if using external NEO-6M
#define NEO6M_RX_PIN 19                     // Only if using external NEO-6M

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================

HardwareSerial simSerial(2);    // UART2 for SIM7600
HardwareSerial gpsSerial(1);    // UART1 for external NEO-6M (if used)

TinyGPSPlus gps;                // For external NEO-6M only
bool useExternalGPS = false;    // Set to true if using external NEO-6M

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
unsigned long lastSIM7600Check = 0;

// Connection status
bool sim7600Connected = false;
int connectionAttempts = 0;
const int maxConnectionAttempts = 5;

// ============================================================================
// SETUP FUNCTION
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("ESP32 GPS Data Fetcher Starting...");
  Serial.println("Device ID: " + String(DEVICE_ID));
  
  // Initialize SIM7600 UART
  simSerial.begin(115200, SERIAL_8N1, SIM7600_TX_PIN, SIM7600_RX_PIN);
  
  // Initialize external GPS UART (if using NEO-6M)
  if (useExternalGPS) {
    gpsSerial.begin(9600, SERIAL_8N1, NEO6M_TX_PIN, NEO6M_RX_PIN);
    Serial.println("External NEO-6M GPS initialized");
  }
  
  // Initialize GPS data structure
  resetGPSData();
  
  // Initialize SIM7600 module
  initializeSIM7600();
  
  Serial.println("Setup complete. Starting main loop...");
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void loop() {
  // Check SIM7600 connection status periodically
  if (millis() - lastSIM7600Check > 30000) { // Every 30 seconds
    checkSIM7600Connection();
    lastSIM7600Check = millis();
  }
  
  // Fetch GPS data at regular intervals
  if (millis() - lastGPSFetch >= GPS_FETCH_INTERVAL) {
    fetchGPSData();
    lastGPSFetch = millis();
  }
  
  // Send data to server at regular intervals
  if (millis() - lastDataSend >= SEND_INTERVAL) {
    if (currentGPS.isValid && sim7600Connected) {
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
  if (useExternalGPS) {
    fetchExternalGPSData();
  } else {
    fetchSIM7600GPSData();
  }
  
  // Log GPS data
  if (currentGPS.isValid) {
    Serial.println("GPS: " + String(currentGPS.latitude, 6) + "," + 
                  String(currentGPS.longitude, 6) + 
                  " Speed: " + String(currentGPS.speed, 1) + " km/h" +
                  " Sats: " + String(currentGPS.satellites));
  } else {
    Serial.println("GPS: No valid fix");
  }
}

void fetchSIM7600GPSData() {
  // Request GNSS information
  simSerial.println("AT+CGNSINF");
  delay(1000);
  
  // Read response
  String response = "";
  unsigned long timeout = millis() + 5000;
  
  while (millis() < timeout) {
    if (simSerial.available()) {
      char c = simSerial.read();
      response += c;
      
      if (response.indexOf("+CGNSINF:") >= 0 && 
          (response.indexOf("OK") >= 0 || response.indexOf("ERROR") >= 0)) {
        break;
      }
    }
  }
  
  // Parse GNSS response
  if (response.indexOf("+CGNSINF:") >= 0) {
    parseSIM7600GPSResponse(response);
  } else {
    currentGPS.isValid = false;
  }
}

void fetchExternalGPSData() {
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
      } else {
        currentGPS.isValid = false;
      }
    }
  }
}

void parseSIM7600GPSResponse(String response) {
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
      currentGPS.latitude = fields[3].toFloat();
      currentGPS.longitude = fields[4].toFloat();
      currentGPS.speed = fields[6].toFloat() * 3.6; // Convert m/s to km/h
      currentGPS.heading = fields[7].toInt();
      currentGPS.satellites = fields[14].toInt() + fields[15].toInt(); // GPS + GLONASS
      currentGPS.timestamp = millis();
      currentGPS.isValid = true;
    } else {
      currentGPS.isValid = false;
    }
  } else {
    currentGPS.isValid = false;
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
  
  // Use SIM7600 for HTTP request
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
  String response = readSIM7600Response();
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
// SIM7600 FUNCTIONS
// ============================================================================

void initializeSIM7600() {
  Serial.println("Initializing SIM7600...");
  
  // Basic AT commands
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
  
  // Check connection status
  checkSIM7600Connection();
  
  Serial.println("SIM7600 initialization complete");
}

void checkSIM7600Connection() {
  sendATCommand("AT+CGACT?");
  String response = readSIM7600Response();
  
  if (response.indexOf("+CGACT: 1,1") >= 0) {
    sim7600Connected = true;
    connectionAttempts = 0;
    Serial.println("SIM7600 connected");
  } else {
    sim7600Connected = false;
    connectionAttempts++;
    Serial.println("SIM7600 disconnected. Attempt: " + String(connectionAttempts));
    
    // Try to reconnect
    if (connectionAttempts < maxConnectionAttempts) {
      sendATCommand("AT+CGACT=1,1");
      delay(3000);
    }
  }
}

void sendATCommand(String command) {
  Serial.println("AT> " + command);
  simSerial.println(command);
  delay(500);
}

String readSIM7600Response() {
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
 */
