import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  SafeAreaView, Platform, View, Text, Dimensions, StyleSheet,
  ScrollView, PermissionsAndroid, TouchableOpacity, FlatList,
  ActivityIndicator, Alert
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { BleManager, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";
import GoogleFit, { Scopes } from "react-native-google-fit";

const manager = new BleManager();
const screenWidth = Dimensions.get("window").width;

// UUIDs
const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HEART_RATE_CHAR = "00002a37-0000-1000-8000-00805f9b34fb";
const STEP_SERVICE = "0000fee0-0000-1000-8000-00805f9b34fb";
const STEP_CHAR = "00000007-0000-3512-2118-0009af100700";

function App() {
  const [bandSteps, setBandSteps] = useState(0);
  const [googleSteps, setGoogleSteps] = useState(0);
  const [heartRate, setHeartRate] = useState(0);
  const [hrHistory, setHrHistory] = useState<number[]>([0, 0, 0, 0, 0]);
  const [status, setStatus] = useState("Ready");
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);

  const deviceRef = useRef<Device | null>(null);

  // --- PERMISSIONS ---
  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION, // Vital for Google Fit
      ]);
    }
  };

  // --- GOOGLE FIT LOGIC ---
  const fetchGoogleFitSteps = useCallback(async () => {
    try {
      const auth = await GoogleFit.authorize({
        scopes: [Scopes.FITNESS_ACTIVITY_READ, Scopes.FITNESS_BODY_READ],
      });

      if (auth.success) {
        const options = {
          startDate: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
          endDate: new Date().toISOString(),
        };
        const res = await GoogleFit.getDailyStepCountSamples(options);
        const source = "com.google.android.gms:estimated_steps";
        const data = res.find((s) => s.source === source);
        const total = data?.steps.reduce((sum, s) => sum + s.value, 0) || 0;
        setGoogleSteps(total);
      }
    } catch (e) {
      console.log("Google Fit Error:", e);
    }
  }, []);

  // --- BLE LOGIC ---
  const startScan = () => {
    if (isScanning) return;
    setDevices([]);
    setIsScanning(true);
    setStatus("Scanning...");
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) { setIsScanning(false); setStatus("Scan Error"); return; }
      if (device?.name) {
        setDevices(prev => prev.find(d => d.id === device.id) ? prev : [...prev, device]);
      }
    });
    setTimeout(() => { manager.stopDeviceScan(); setIsScanning(false); setStatus("Scan Finished"); }, 6000);
  };

  const connectToDevice = async (device: Device) => {
    try {
      setStatus(`Connecting...`);
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setConnectedDevice(connected);
      setStatus("Connected");

      // Monitor Heart Rate
      connected.monitorCharacteristicForService(HEART_RATE_SERVICE, HEART_RATE_CHAR, (err, char) => {
        if (char?.value) {
          const data = Buffer.from(char.value, "base64");
          const bpm = data[0] === 0x16 ? data.readUInt16LE(1) : data[1];
          setHeartRate(bpm);
          setHrHistory(prev => [...prev.slice(-9), bpm]);
        }
      });

      // Interval to read Band Steps
      const stepInterval = setInterval(async () => {
        try {
          const char = await connected.readCharacteristicForService(STEP_SERVICE, STEP_CHAR);
          if (char?.value) {
            const data = Buffer.from(char.value, "base64");
            const count = data.readUInt32LE(1) & 0x00FFFFFF; 
            setBandSteps(count);
          }
        } catch (e) { console.log("Band Step Error", e); }
      }, 10000);

      connected.onDisconnected(() => {
        setConnectedDevice(null);
        setStatus("Disconnected");
        clearInterval(stepInterval);
      });

    } catch (e) {
      setStatus("Failed");
      Alert.alert("Error", "Could not connect to band.");
    }
  };

  useEffect(() => {
    requestPermissions().then(() => {
        fetchGoogleFitSteps();
    });
    const gfInterval = setInterval(fetchGoogleFitSteps, 15000);
    return () => {
        manager.destroy();
        clearInterval(gfInterval);
    };
  }, [fetchGoogleFitSteps]);

  const renderDeviceItem = ({item}: {item: Device}) => (
    <TouchableOpacity style={styles.deviceCard} onPress={() => connectToDevice(item)}>
      <Text style={styles.deviceName}>{item.name}</Text>
      <Text style={styles.deviceInfo}>{item.id}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Health Dashboard</Text>
          <Text style={styles.statusText}>● {status}</Text>
        </View>
        {!connectedDevice && (
          <TouchableOpacity style={styles.scanBtn} onPress={startScan} disabled={isScanning}>
            {isScanning ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Scan Band</Text>}
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={{padding: 20}}>
        {/* Google Fit Section */}
        <View style={[styles.card, {borderLeftColor: '#4285F4', borderLeftWidth: 5}]}>
          <Text style={styles.label}>GOOGLE FIT STEPS (PHONE)</Text>
          <Text style={styles.val}>{googleSteps.toLocaleString()}</Text>
        </View>

        {/* Band Section */}
        {connectedDevice ? (
          <>
            <View style={[styles.card, {borderLeftColor: '#00CEC9', borderLeftWidth: 5}]}>
              <Text style={styles.label}>BAND STEPS</Text>
              <Text style={styles.val}>{bandSteps.toLocaleString()}</Text>
            </View>

            <View style={[styles.card, {borderLeftColor: '#FF2D55', borderLeftWidth: 5}]}>
              <Text style={styles.label}>BAND HEART RATE</Text>
              <Text style={styles.val}>{heartRate} <Text style={{fontSize: 16}}>BPM</Text></Text>
              <LineChart 
                data={{ datasets: [{ data: hrHistory }] }} 
                width={screenWidth - 80} height={120} 
                chartConfig={chartConfig} bezier style={styles.chart} 
              />
            </View>
          </>
        ) : (
          devices.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>Select your Band:</Text>
              <FlatList data={devices} renderItem={renderDeviceItem} keyExtractor={item => item.id} scrollEnabled={false} />
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const chartConfig = {
  backgroundGradientFrom: "#fff", backgroundGradientTo: "#fff",
  color: (op = 1) => `rgba(255,45,85,${op})`, labelColor: () => "#888",
  strokeWidth: 2,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FD" },
  header: { padding: 20, backgroundColor: "#fff", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 2 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#2D3436' },
  statusText: { fontSize: 12, color: '#636E72', marginTop: 4 },
  scanBtn: { backgroundColor: '#6C5CE7', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: "#fff", padding: 20, borderRadius: 15, marginBottom: 20, elevation: 3 },
  label: { fontSize: 11, color: '#636E72', fontWeight: 'bold', letterSpacing: 1 },
  val: { fontSize: 36, fontWeight: 'bold', color: '#2D3436', marginVertical: 5 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10, color: '#636E72' },
  deviceCard: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#DFE6E9' },
  deviceName: { fontSize: 16, fontWeight: 'bold' },
  deviceInfo: { fontSize: 12, color: '#B2BEC3' },
  chart: { marginTop: 15, marginLeft: -20 }
});

export default App;