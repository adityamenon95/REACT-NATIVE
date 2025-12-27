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
  Alert,
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { BleManager, State } from "react-native-ble-plx";
import { Buffer } from "buffer";
import GoogleFit from "react-native-google-fit";

const manager = new BleManager();
const screenWidth = Dimensions.get("window").width;

// Heart Rate UUIDs
const HEART_RATE_SERVICE_UUID = "180d";
const HEART_RATE_CHAR_UUID = "2a37";

function App() {
  const [steps, setSteps] = useState(0);
  const [heartRate, setHeartRate] = useState(0);
  const [hrHistory, setHrHistory] = useState<number[]>([60, 60, 60, 60, 60]);
  const [status, setStatus] = useState("Initializing Bluetooth...");

  const deviceRef = useRef<any>(null);

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

  /* -------------------- GOOGLE FIT STEPS -------------------- */
  const fetchSteps = useCallback(async () => {
    if (Platform.OS !== "android") return;

    try {
      await GoogleFit.authorize({
        scopes: [GoogleFit.Scopes.FITNESS_ACTIVITY_READ],
      });

      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      ).toISOString();

      const res = await GoogleFit.getDailyStepCountSamples({
        startDate: midnight,
        endDate: now.toISOString(),
      });

      const totalSteps =
        res?.[0]?.steps?.reduce(
          (sum: number, s: any) => sum + s.value,
          0
        ) ?? 0;

      setSteps(totalSteps);
    } catch (e) {
      console.log("Google Fit error:", e);
    }
  }, []);

  /* -------------------- BLE SETUP -------------------- */
  const setupBLE = useCallback(async () => {
    await requestPermissions();

    const subscription = manager.onStateChange((state) => {
      if (state === State.PoweredOn) {
        scanForHeartRate();
        subscription.remove();
      } else {
        setStatus("Turn Bluetooth ON");
      }
    }, true);
  }, []);

  const scanForHeartRate = () => {
    setStatus("Scanning for Heart Rate device...");

    manager.startDeviceScan(null, { allowDuplicates: false }, async (error, device) => {
      if (error) {
        console.log(error);
        setStatus("Scan Error");
        return;
      }

      if (!device) return;

      console.log("Found device:", device.name, device.id);

      // Many HR devices do NOT advertise name
      if (
        device.serviceUUIDs?.includes(HEART_RATE_SERVICE_UUID)
      ) {
        manager.stopDeviceScan();
        connectDevice(device);
      }
    });

    // Stop scan after 15s
    setTimeout(() => {
      manager.stopDeviceScan();
      if (!deviceRef.current) {
        setStatus("No Heart Rate Device Found");
      }
    }, 15000);
  };

  const connectDevice = async (device: any) => {
    try {
      setStatus("Connecting...");
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;

      setStatus(`Connected: ${connected.name ?? "HR Device"}`);

      connected.monitorCharacteristicForService(
        HEART_RATE_SERVICE_UUID,
        HEART_RATE_CHAR_UUID,
        (error, characteristic) => {
          if (error || !characteristic?.value) return;

          const data = Buffer.from(characteristic.value, "base64");

          // Heart Rate format parsing (BLE spec)
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
      scanForHeartRate();
    }
  };

  /* -------------------- EFFECTS -------------------- */
  useEffect(() => {
    setupBLE();
    fetchSteps();
    const interval = setInterval(fetchSteps, 10000);

    return () => {
      clearInterval(interval);
      manager.stopDeviceScan();
      manager.destroy();
    };
  }, []);

  /* -------------------- UI -------------------- */
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Today's Activity</Text>
          <Text
            style={[
              styles.status,
              { color: status.includes("Connected") ? "#4CAF50" : "#FF9800" },
            ]}
          >
            ● {status}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>STEPS</Text>
          <Text style={styles.stepCount}>{steps.toLocaleString()}</Text>

          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min((steps / 10000) * 100, 100)}%` },
              ]}
            />
          </View>

          <Text style={styles.goalText}>Goal: 10,000 steps</Text>
        </View>

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

/* -------------------- CHART CONFIG -------------------- */
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
  header: {
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 24, fontWeight: "bold", color: "#333" },
  status: { fontSize: 14, fontWeight: "600" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    elevation: 3,
  },
  cardLabel: { fontSize: 12, color: "#888", fontWeight: "700" },
  stepCount: { fontSize: 36, fontWeight: "bold", marginVertical: 10 },
  progressBar: { height: 8, backgroundColor: "#eee", borderRadius: 4 },
  progressFill: { height: "100%", backgroundColor: "#00CEC9" },
  goalText: { fontSize: 12, color: "#aaa", marginTop: 8 },
  hrHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  bpmText: { fontSize: 28, fontWeight: "bold", color: "#FF2D55" },
  bpmUnit: { fontSize: 14, color: "#888" },
  chart: { borderRadius: 16 },
});

export default App;
