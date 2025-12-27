import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  SafeAreaView,
  Platform,
  View,
  Text,
  Dimensions,
  StyleSheet,
  ScrollView,
  PermissionsAndroid,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { BleManager, State, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";

const manager = new BleManager();
const screenWidth = Dimensions.get("window").width;

// standard heart rate UUIDs
const HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
const HEART_RATE_CHAR_UUID = "00002a37-0000-1000-8000-00805f9b34fb";

// COMMON STEP/ACTIVITY UUIDS (Note: These vary by device manufacturer)
// Generic "Fitness Machine" or Custom Service UUIDs are often used
const STEP_SERVICE_UUID = "00001814-0000-1000-8000-00805f9b34fb"; // Cycling Speed/Cadence or similar
const STEP_CHAR_UUID = "00002a53-0000-1000-8000-00805f9b34fb"; 

function App() {
  const [steps, setSteps] = useState(0);
  const [heartRate, setHeartRate] = useState(0);
  const [hrHistory, setHrHistory] = useState<number[]>([0, 0, 0, 0, 0]);
  const [status, setStatus] = useState("Initializing...");
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);

  const deviceRef = useRef<Device | null>(null);

  const resetBluetooth = async () => {
    try {
      manager.stopDeviceScan();
      if (deviceRef.current) {
        await deviceRef.current.cancelConnection();
        deviceRef.current = null;
      }
      setConnectedDevice(null);
      setDevices([]);
      setHeartRate(0);
      setSteps(0);
      setHrHistory([0, 0, 0, 0, 0]);
      setIsScanning(false);
      setStatus("Bluetooth Reset");
      Alert.alert("Reset", "Connections cleared.");
    } catch (e) {
      console.log("Reset Error:", e);
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  };

  const startScan = () => {
    if (isScanning) return;
    setDevices([]);
    setIsScanning(true);
    setStatus("Scanning...");

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        setIsScanning(false);
        setStatus("Scan Error: Enable GPS");
        return;
      }
      if (device && device.name) {
        setDevices((prev) => (prev.find(d => d.id === device.id) ? prev : [...prev, device]));
      }
    });

    setTimeout(() => {
      manager.stopDeviceScan();
      setIsScanning(false);
      setStatus("Scan Finished");
    }, 8000);
  };

  const connectToDevice = async (device: Device) => {
    try {
      manager.stopDeviceScan();
      setStatus(`Connecting to ${device.name}...`);

      const connected = await device.connect({ autoConnect: true });
      setStatus("Discovering services...");
      await connected.discoverAllServicesAndCharacteristics();
      
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (Platform.OS === 'android') {
        try { await connected.requestMTU(512); } catch (e) {}
      }

      deviceRef.current = connected;
      setConnectedDevice(connected);
      setStatus("Connected & Monitoring");
      setDevices([]);

      // 1. MONITOR HEART RATE
      connected.monitorCharacteristicForService(
        HEART_RATE_SERVICE_UUID,
        HEART_RATE_CHAR_UUID,
        (error, characteristic) => {
          if (error) {
            if (error.errorCode !== 201) setStatus("HR Stream Error");
            return;
          }
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, "base64");
            const flags = data[0];
            const bpm = (flags & 0x01) ? data.readUInt16LE(1) : data[1];
            if (bpm > 0) {
              setHeartRate(bpm);
              setHrHistory((prev) => [...prev.slice(-9), bpm]);
              setStatus("Reading HR...");
            }
          }
        }
      );

      // 2. MONITOR STEPS (If your band supports standard fitness service)
      // Note: If this fails, the band likely uses a proprietary UUID
      connected.monitorCharacteristicForService(
        STEP_SERVICE_UUID,
        STEP_CHAR_UUID,
        (error, characteristic) => {
          if (error) return; // Silent fail if step service isn't supported
          if (characteristic?.value) {
            const data = Buffer.from(characteristic.value, "base64");
            // Parsing varies wildly by brand; usually first 2-4 bytes after flags
            const currentSteps = data.readUInt32LE(1); 
            setSteps(currentSteps);
          }
        }
      );

      manager.onDeviceDisconnected(device.id, () => {
        setStatus("Disconnected");
        setConnectedDevice(null);
        deviceRef.current = null;
      });

    } catch (e) {
      console.log("Connection Error:", e);
      setStatus("Connection Failed");
    }
  };

  useEffect(() => {
    requestPermissions().then(() => {
      manager.onStateChange((state) => {
        if (state === State.PoweredOn) setStatus("Bluetooth Ready");
        else setStatus("Bluetooth is Off");
      }, true);
    });
    return () => manager.stopDeviceScan();
  }, []);

  const renderDeviceItem = ({ item }: { item: Device }) => (
    <TouchableOpacity style={styles.deviceItem} onPress={() => connectToDevice(item)}>
      <View>
        <Text style={styles.deviceName}>{item.name}</Text>
        <Text style={styles.deviceAddress}>{item.id}</Text>
      </View>
      <Text style={styles.connectBtnText}>Connect</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Activity Tracker</Text>
            <Text style={[styles.status, { color: status.includes("Reading") ? "#4CAF50" : "#FF9800" }]}>
              ● {status}
            </Text>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity style={styles.resetBtn} onPress={resetBluetooth}><Text style={styles.resetBtnText}>Reset</Text></TouchableOpacity>
            {!connectedDevice && (
                <TouchableOpacity style={[styles.scanBtn, { marginLeft: 10 }]} onPress={startScan} disabled={isScanning}>
                    {isScanning ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.scanBtnText}>Scan</Text>}
                </TouchableOpacity>
            )}
          </View>
        </View>

        {devices.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>DEVICES FOUND</Text>
            <FlatList data={devices} renderItem={renderDeviceItem} keyExtractor={(item) => item.id} scrollEnabled={false} />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardLabel}>BAND STEP COUNT</Text>
          <Text style={styles.stepCount}>{steps.toLocaleString()}</Text>
          <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${Math.min((steps / 10000) * 100, 100)}%` }]} /></View>
          <Text style={{fontSize: 10, color: '#aaa', marginTop: 5}}>Reading directly from band via BLE</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.hrHeader}>
            <Text style={styles.cardLabel}>REAL-TIME HEART RATE</Text>
            <Text style={styles.bpmText}>{heartRate} <Text style={styles.bpmUnit}>BPM</Text></Text>
          </View>
          <LineChart data={{ datasets: [{ data: hrHistory }] }} width={screenWidth - 60} height={180} chartConfig={chartConfig} bezier style={styles.chart} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const chartConfig = {
  backgroundGradientFrom: "#fff", backgroundGradientTo: "#fff", decimalPlaces: 0,
  color: (opacity = 1) => `rgba(255,45,85,${opacity})`, labelColor: () => "#000",
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F7FA" },
  scrollContent: { padding: 20 },
  header: { marginBottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "bold", color: "#333" },
  status: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  scanBtn: { backgroundColor: "#6C5CE7", paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, justifyContent: 'center' },
  scanBtnText: { color: "#fff", fontWeight: "bold" },
  resetBtn: { backgroundColor: "#f1f2f6", paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#dfe4ea', justifyContent: 'center' },
  resetBtnText: { color: "#2f3542", fontWeight: "bold" },
  card: { backgroundColor: "#fff", borderRadius: 15, padding: 20, marginBottom: 20, elevation: 3 },
  cardLabel: { fontSize: 10, color: "#888", fontWeight: "700", marginBottom: 10, letterSpacing: 1 },
  deviceItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  deviceName: { fontSize: 15, fontWeight: '600', color: '#333' },
  deviceAddress: { fontSize: 11, color: '#aaa' },
  connectBtnText: { color: '#6C5CE7', fontWeight: 'bold', fontSize: 13 },
  stepCount: { fontSize: 36, fontWeight: "bold", marginVertical: 10 },
  progressBar: { height: 8, backgroundColor: "#eee", borderRadius: 4 },
  progressFill: { height: "100%", backgroundColor: "#00CEC9" },
  hrHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 15 },
  bpmText: { fontSize: 28, fontWeight: "bold", color: "#FF2D55" },
  bpmUnit: { fontSize: 14, color: "#888" },
  chart: { borderRadius: 16, marginTop: 10 },
});

export default App;