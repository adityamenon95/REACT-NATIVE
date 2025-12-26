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
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { BleManager, State, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";
import GoogleFit from "react-native-google-fit";

const manager = new BleManager();
const screenWidth = Dimensions.get("window").width;

const HEART_RATE_SERVICE_UUID = "180d";
const HEART_RATE_CHAR_UUID = "2a37";

function App() {
  const [steps, setSteps] = useState(0);
  const [heartRate, setHeartRate] = useState(0);
  const [hrHistory, setHrHistory] = useState<number[]>([60, 60, 60, 60, 60]);
  const [status, setStatus] = useState("Initializing...");
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);

  const deviceRef = useRef<Device | null>(null);

  /* -------------------- ANDROID PERMISSIONS -------------------- */
  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    }
  };

  /* -------------------- GOOGLE FIT -------------------- */
  const fetchSteps = useCallback(async () => {
    if (Platform.OS !== "android") return;
    try {
      await GoogleFit.authorize({ scopes: [GoogleFit.Scopes.FITNESS_ACTIVITY_READ] });
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const res = await GoogleFit.getDailyStepCountSamples({
        startDate: midnight,
        endDate: now.toISOString(),
      });
      const totalSteps = res?.[0]?.steps?.reduce((sum: number, s: any) => sum + s.value, 0) ?? 0;
      setSteps(totalSteps);
    } catch (e) {
      console.log("Google Fit error:", e);
    }
  }, []);

  /* -------------------- BLE SCANNING -------------------- */
  const startScan = () => {
    if (isScanning) return;
    
    setDevices([]);
    setIsScanning(true);
    setStatus("Scanning for devices...");

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        setIsScanning(false);
        setStatus("Scan Error");
        return;
      }
      if (device) {
        // Update device list, avoiding duplicates
        setDevices((prevDevices) => {
          if (prevDevices.find((d) => d.id === device.id)) return prevDevices;
          return [...prevDevices, device];
        });
      }
    });

    // Auto-stop scan after 10 seconds
    setTimeout(() => {
      manager.stopDeviceScan();
      setIsScanning(false);
      setStatus("Scan Complete");
    }, 10000);
  };

  /* -------------------- BLE CONNECTION (PAIRING) -------------------- */
  const connectToDevice = async (device: Device) => {
    try {
      manager.stopDeviceScan();
      setIsScanning(false);
      setStatus(`Connecting to ${device.name || "Unknown"}...`);

      const connectedDevice = await device.connect();
      await connectedDevice.discoverAllServicesAndCharacteristics();
      deviceRef.current = connectedDevice;
      
      setStatus(`Connected to ${connectedDevice.name ?? "HR Device"}`);
      setDevices([]); // Clear list after successful connection

      connectedDevice.monitorCharacteristicForService(
        HEART_RATE_SERVICE_UUID,
        HEART_RATE_CHAR_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;
          const data = Buffer.from(characteristic.value, "base64");
          const flags = data[0];
          const is16Bit = flags & 0x01;
          const bpm = is16Bit ? data.readUInt16LE(1) : data[1];

          setHeartRate(bpm);
          setHrHistory((prev) => [...prev.slice(-9), bpm]);
        }
      );
    } catch (e) {
      console.log("Connection error:", e);
      setStatus("Connection Failed");
    }
  };

  useEffect(() => {
    requestPermissions().then(() => {
      const subscription = manager.onStateChange((state) => {
        if (state === State.PoweredOn) {
          setStatus("Bluetooth Ready");
          subscription.remove();
        }
      }, true);
    });

    fetchSteps();
    const interval = setInterval(fetchSteps, 10000);

    return () => {
      clearInterval(interval);
      manager.stopDeviceScan();
    };
  }, []);

  /* -------------------- UI COMPONENTS -------------------- */
  const renderDeviceItem = ({ item }: { item: Device }) => (
    <TouchableOpacity 
      style={styles.deviceItem} 
      onPress={() => connectToDevice(item)}
    >
      <View>
        <Text style={styles.deviceName}>{item.name || "Unnamed Device"}</Text>
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
            <Text style={[styles.status, { color: status.includes("Connected") ? "#4CAF50" : "#FF9800" }]}>
              ● {status}
            </Text>
          </View>
          {!deviceRef.current && (
            <TouchableOpacity 
              style={styles.scanBtn} 
              onPress={startScan} 
              disabled={isScanning}
            >
              {isScanning ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.scanBtnText}>Scan</Text>}
            </TouchableOpacity>
          )}
        </View>

        {/* DEVICE LIST SECTION */}
        {devices.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>AVAILABLE DEVICES</Text>
            <FlatList
              data={devices}
              renderItem={renderDeviceItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false} // Since inside ScrollView
            />
          </View>
        )}

        {/* STEPS CARD */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>STEPS</Text>
          <Text style={styles.stepCount}>{steps.toLocaleString()}</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.min((steps / 10000) * 100, 100)}%` }]} />
          </View>
          <Text style={styles.goalText}>Goal: 10,000 steps</Text>
        </View>

        {/* HEART RATE CARD */}
        <View style={styles.card}>
          <View style={styles.hrHeader}>
            <Text style={styles.cardLabel}>HEART RATE</Text>
            <Text style={styles.bpmText}>
              {heartRate} <Text style={styles.bpmUnit}>BPM</Text>
            </Text>
          </View>
          <LineChart
            data={{ datasets: [{ data: hrHistory }] }}
            width={screenWidth - 60}
            height={180}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const chartConfig = {
  backgroundGradientFrom: "#fff",
  backgroundGradientTo: "#fff",
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(255,45,85,${opacity})`,
  labelColor: () => "#000",
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F5F7FA" },
  scrollContent: { padding: 20 },
  header: { marginBottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "bold", color: "#333" },
  status: { fontSize: 12, fontWeight: "600", marginTop: 4 },
  scanBtn: { backgroundColor: "#6C5CE7", paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8 },
  scanBtnText: { color: "#fff", fontWeight: "bold" },
  card: { backgroundColor: "#fff", borderRadius: 15, padding: 20, marginBottom: 20, elevation: 3 },
  cardLabel: { fontSize: 12, color: "#888", fontWeight: "700", marginBottom: 10 },
  deviceItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee'
  },
  deviceName: { fontSize: 16, fontWeight: '600', color: '#333' },
  deviceAddress: { fontSize: 12, color: '#aaa' },
  connectBtnText: { color: '#6C5CE7', fontWeight: 'bold' },
  stepCount: { fontSize: 36, fontWeight: "bold", marginVertical: 10 },
  progressBar: { height: 8, backgroundColor: "#eee", borderRadius: 4 },
  progressFill: { height: "100%", backgroundColor: "#00CEC9" },
  goalText: { fontSize: 12, color: "#aaa", marginTop: 8 },
  hrHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 15 },
  bpmText: { fontSize: 28, fontWeight: "bold", color: "#FF2D55" },
  bpmUnit: { fontSize: 14, color: "#888" },
  chart: { borderRadius: 16 },
});

export default App;