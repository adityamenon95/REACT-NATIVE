import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  SafeAreaView, Platform, View, Text, Dimensions, StyleSheet,
  ScrollView, PermissionsAndroid, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, Vibration // Added Vibration for the "Buzz" effect
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { BleManager, Device } from "react-native-ble-plx";
import { Buffer } from "buffer";
import GoogleFit from "react-native-google-fit";
import AsyncStorage from "@react-native-async-storage/async-storage";

const manager = new BleManager();
const screenWidth = Dimensions.get("window").width;
const STORAGE_KEY = "@health_data_v1";
const RESET_TRACKER_KEY = "@last_reset_date"; // Tracker for Monday resets

// --- EXPANDED UUIDS FOR NOISE & KRONOS ---
const HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HEART_RATE_CHAR = "00002a37-0000-1000-8000-00805f9b34fb";

// Standard Step Service
const STEP_SERVICE = "0000fee0-0000-1000-8000-00805f9b34fb";
const STEP_CHAR = "00000007-0000-3512-2118-0009af100700";

// Alternative Step Services (Noise / Pulse Go / Kronos)
const ALT_STEP_SERVICE = "0000fee7-0000-1000-8000-00805f9b34fb"; 
const ALT_STEP_CHAR = "0000fec9-0000-1000-8000-00805f9b34fb";

function App() {
  const [bandSteps, setBandSteps] = useState(0);
  const [googleSteps, setGoogleSteps] = useState(0);
  const [heartRate, setHeartRate] = useState(0);
  const [hrHistory, setHrHistory] = useState<number[]>([0, 0, 0, 0, 0]);
  const [status, setStatus] = useState("Ready");
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  
  const [dailyRecords, setDailyRecords] = useState({ 
    steps: 0, 
    avgHr: 0, 
    calories: 0, 
    distance: 0 
  });

  const [weeklyStats, setWeeklyStats] = useState({ steps: 0, calories: 0, distance: 0 });
  const [hrFluctuations, setHrFluctuations] = useState<{value: number, time: string}[]>([]);

  const deviceRef = useRef<Device | null>(null);

  // --- MONDAY RESET LOGIC ---
  const handleWeeklyReset = async () => {
    const today = new Date();
    const isMonday = today.getDay() === 1; // 0=Sun, 1=Mon...
    
    if (isMonday) {
      const todayString = today.toDateString();
      const lastReset = await AsyncStorage.getItem(RESET_TRACKER_KEY);
      
      // If we haven't reset today yet
      if (lastReset !== todayString) {
        console.log("Monday Detected: Resetting Weekly Summary...");
        const resetData = { steps: 0, calories: 0, distance: 0 };
        setWeeklyStats(resetData);
        // Also clear daily to start fresh for the week
        setDailyRecords({ steps: 0, avgHr: 0, calories: 0, distance: 0 });
        setBandSteps(0);
        await AsyncStorage.setItem(RESET_TRACKER_KEY, todayString);
      }
    }
  };

  // --- PERSISTENCE LOGIC ---
  const loadData = async () => {
    try {
      await handleWeeklyReset(); // Check for reset before loading
      const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
      if (jsonValue != null) {
        const savedData = JSON.parse(jsonValue);
        setDailyRecords(savedData.dailyRecords || { steps: 0, avgHr: 0, calories: 0, distance: 0 });
        setHrHistory(savedData.hrHistory && savedData.hrHistory.length > 0 ? savedData.hrHistory : [0, 0, 0, 0, 0]);
        setBandSteps(savedData.dailyRecords?.steps || 0);
        setHrFluctuations(savedData.hrFluctuations || []);
        
        // Load the calculated weekly stats based on the stored steps
        updateWeeklyStats(savedData.dailyRecords?.steps || 0);
      }
    } catch (e) { console.log("Error loading storage", e); }
  };

  const updateWeeklyStats = (currentSteps: number) => {
    // Note: This now starts from the current session's accumulation
    setWeeklyStats({
      steps: currentSteps,
      calories: Math.floor(currentSteps * 0.045),
      distance: parseFloat(((currentSteps * 0.762) / 1000).toFixed(2))
    });
  };

  const handleManualSave = async () => {
    try {
      const dataToSave = JSON.stringify({ dailyRecords, hrHistory, hrFluctuations });
      await AsyncStorage.setItem(STORAGE_KEY, dataToSave);
      Alert.alert("Success", "Health summary saved successfully!");
    } catch (e) { Alert.alert("Error", "Failed to save data."); }
  };

  useEffect(() => {
    const saveData = async () => {
      try {
        const dataToSave = JSON.stringify({ dailyRecords, hrHistory, hrFluctuations });
        await AsyncStorage.setItem(STORAGE_KEY, dataToSave);
      } catch (e) { console.log("Auto-save error", e); }
    };
    if (dailyRecords.steps > 0) saveData();
  }, [dailyRecords, hrHistory, hrFluctuations]);

  // --- PERMISSIONS & GOOGLE FIT ---
  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      const apiLevel = Platform.Version;
      if (typeof apiLevel === 'number' && apiLevel < 31) {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
        ]);
      } else {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
        ]);
      }
    }
  };

  const fetchGoogleFitSteps = useCallback(async () => {
    try {
      const isAuthorized = await GoogleFit.checkIsAuthorized();
      if (!isAuthorized) return; 
      const options = {
        startDate: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
        endDate: new Date().toISOString(),
      };
      const res = await GoogleFit.getDailyStepCountSamples(options);
      const source = "com.google.android.gms:estimated_steps";
      const data = res.find((s) => s.source === source);
      const total = data?.steps.reduce((sum, s) => sum + s.value, 0) || 0;
      setGoogleSteps(total);
    } catch (e) { console.log("Google Fit Error:", e); }
  }, []);

  // --- BLUETOOTH LOGIC (NOISE / PULSE GO COMPATIBLE) ---
  const startScan = () => {
    if (isScanning) return;
    setDevices([]);
    setIsScanning(true);
    setStatus("Scanning for Bands...");
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) { setIsScanning(false); setStatus("Scan Error"); return; }
      if (device?.name) {
        setDevices(prev => prev.find(d => d.id === device.id) ? prev : [...prev, device]);
      }
    });
    setTimeout(() => { manager.stopDeviceScan(); setIsScanning(false); setStatus("Scan Finished"); }, 6000);
  };

  const resetBluetooth = () => {
    manager.stopDeviceScan();
    if (connectedDevice) connectedDevice.cancelConnection();
    setConnectedDevice(null);
    setDevices([]);
    setStatus("Bluetooth Reset");
    setIsScanning(false);
  };

  const connectToDevice = async (device: Device) => {
    try {
      setStatus(`Syncing with ${device.name}...`);
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      deviceRef.current = connected;
      setConnectedDevice(connected);
      setStatus("Connected");

      // HR Monitoring + Pulse Buzz
      connected.monitorCharacteristicForService(HEART_RATE_SERVICE, HEART_RATE_CHAR, (err, char) => {
        if (char?.value) {
          try {
            const data = Buffer.from(char.value, "base64");
            let bpm = data.length >= 2 ? (data[0] === 0x16 ? data.readUInt16LE(1) : data[1]) : data[1];
            if (bpm > 30 && bpm < 220) { 
               // --- PULSE GO BUZZ SYNC ---
               Vibration.vibrate(100); // 100ms buzz on heart pulse detection
               
               const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
               setHeartRate(bpm);
               setHrHistory(prev => [...prev.slice(-9), bpm]);
               setHrFluctuations(prev => [...prev.slice(-10), { value: bpm, time: timestamp }]);
               setDailyRecords(prev => ({ ...prev, avgHr: bpm }));
            }
          } catch (e) { console.log("HR Decode Error", e); }
        }
      });

      // Unified Step Interval
      const stepInterval = setInterval(async () => {
        try {
          if (!deviceRef.current) return;
          let char = await connected.readCharacteristicForService(STEP_SERVICE, STEP_CHAR).catch(() => null);
          if (!char) {
            char = await connected.readCharacteristicForService(ALT_STEP_SERVICE, ALT_STEP_CHAR).catch(() => null);
          }

          if (char?.value) {
            const data = Buffer.from(char.value, "base64");
            const count = data.length >= 4 ? (data.readUInt32LE(1) & 0x00FFFFFF) : 0;
            if (count > 0) {
                const dist = parseFloat(((count * 0.762) / 1000).toFixed(2));
                const cal = Math.floor(count * 0.045); 
                setBandSteps(count);
                setDailyRecords(prev => ({ ...prev, steps: count, distance: dist, calories: cal }));
                updateWeeklyStats(count);
            }
          }
        } catch (e) { console.log("Step Read Error", e); }
      }, 10000);

      connected.onDisconnected(() => {
        setConnectedDevice(null);
        setStatus("Disconnected");
        clearInterval(stepInterval);
      });

    } catch (e) {
      setStatus("Failed");
      Alert.alert("Error", `Could not connect to ${device.name}. Check if it is paired in phone settings.`);
    }
  };

  useEffect(() => {
    loadData();
    requestPermissions().then(() => fetchGoogleFitSteps());
    const gfInterval = setInterval(fetchGoogleFitSteps, 15000);
    return () => { manager.destroy(); clearInterval(gfInterval); };
  }, [fetchGoogleFitSteps]);

  const renderDeviceItem = ({item}: {item: Device}) => (
    <TouchableOpacity style={styles.deviceCard} onPress={() => connectToDevice(item)}>
      <Text style={styles.deviceName}>{item.name}</Text>
      <Text style={styles.deviceInfo}>{item.id} (Tap to Connect)</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.connectedDeviceName}>{connectedDevice ? connectedDevice.name : "Band Not Linked"}</Text>
          <Text style={styles.title}>Health Dashboard</Text>
          <Text style={styles.statusText}>● {status}</Text>
        </View>
        <View style={{flexDirection: 'row'}}>
          <TouchableOpacity style={[styles.scanBtn, {backgroundColor: '#e74c3c', marginRight: 5}]} onPress={resetBluetooth}><Text style={styles.btnText}>Reset</Text></TouchableOpacity>
          {!connectedDevice && (
            <TouchableOpacity style={styles.scanBtn} onPress={startScan} disabled={isScanning}>
              {isScanning ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Scan</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={{padding: 20}}>
        
        {/* --- WEEKLY PERFORMANCE (AUTO-RESETS MONDAY) --- */}
        <Text style={styles.sectionTitle}>Weekly Summary (Starts Mon)</Text>
        <View style={styles.weeklyCard}>
            <View style={styles.weeklyItem}>
                <Text style={styles.weeklyLabel}>Weekly Steps</Text>
                <Text style={styles.weeklyVal}>{weeklyStats.steps.toLocaleString()}</Text>
            </View>
            <View style={styles.weeklyItem}>
                <Text style={styles.weeklyLabel}>Weekly Cals</Text>
                <Text style={styles.weeklyVal}>{weeklyStats.calories} kcal</Text>
            </View>
            <View style={styles.weeklyItem}>
                <Text style={styles.weeklyLabel}>Weekly Dist</Text>
                <Text style={styles.weeklyVal}>{weeklyStats.distance} km</Text>
            </View>
        </View>

        <View style={styles.row}>
            <View style={[styles.card, { flex: 1, marginRight: 10, borderLeftColor: '#FF9F43', borderLeftWidth: 5 }]}>
                <Text style={styles.label}>CALORIES</Text>
                <Text style={styles.valSmall}>{dailyRecords.calories} <Text style={styles.unit}>kcal</Text></Text>
            </View>
            <View style={[styles.card, { flex: 1, borderLeftColor: '#10AC84', borderLeftWidth: 5 }]}>
                <Text style={styles.label}>DISTANCE</Text>
                <Text style={styles.valSmall}>{dailyRecords.distance} <Text style={styles.unit}>km</Text></Text>
            </View>
        </View>

        <View style={[styles.card, {borderLeftColor: '#4285F4', borderLeftWidth: 5}]}>
          <Text style={styles.label}>GOOGLE FIT (MOBILE SENSORS)</Text>
          <Text style={styles.val}>{googleSteps.toLocaleString()}</Text>
        </View>

        {connectedDevice ? (
          <>
            <Text style={styles.sectionTitle}>Live Sync: {connectedDevice.name}</Text>
            <View style={[styles.card, {borderLeftColor: '#00CEC9', borderLeftWidth: 5, backgroundColor: '#E0F7F6'}]}>
              <Text style={styles.label}>BAND STEPS</Text>
              <Text style={styles.val}>{bandSteps.toLocaleString()}</Text>
              <Text style={styles.liveIndicator}>• Connected & Syncing</Text>
            </View>

            <View style={[styles.card, {borderLeftColor: '#FF2D55', borderLeftWidth: 5}]}>
              <Text style={styles.label}>HEART RATE (PULSE BUZZ ENABLED)</Text>
              <Text style={styles.val}>{heartRate} <Text style={{fontSize: 16}}>BPM</Text></Text>
              
              {hrFluctuations.length > 1 ? (
                <LineChart 
                    data={{ 
                        labels: hrFluctuations.map(f => f.time),
                        datasets: [{ data: hrFluctuations.map(f => f.value) }] 
                    }} 
                    width={screenWidth - 80} height={180} 
                    chartConfig={chartConfig} 
                    bezier 
                    style={styles.chart} 
                    verticalLabelRotation={30}
                    withInnerLines={false}
                />
              ) : (
                <Text style={{color: '#888', fontStyle: 'italic', marginTop: 10}}>Capturing pulse fluctuations...</Text>
              )}
            </View>
          </>
        ) : (
          devices.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>Select Device:</Text>
              <FlatList data={devices} renderItem={renderDeviceItem} keyExtractor={item => item.id} scrollEnabled={false} />
            </View>
          )
        )}

        <View style={styles.historySection}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
            <Text style={styles.sectionTitle}>Saved Summary</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={handleManualSave}><Text style={styles.saveBtnText}>Save Now</Text></TouchableOpacity>
          </View>
          
          <View style={styles.historyRow}>
            <View style={styles.historyCard}>
              <Text style={styles.historyLabel}>Stored Steps</Text>
              <Text style={styles.historyVal}>{dailyRecords.steps.toLocaleString()}</Text>
            </View>
            <View style={styles.historyCard}>
              <Text style={styles.historyLabel}>Distance</Text>
              <Text style={styles.historyVal}>{dailyRecords.distance} km</Text>
            </View>
          </View>
          <View style={[styles.historyRow, {marginTop: 10}]}>
            <View style={styles.historyCard}>
              <Text style={styles.historyLabel}>Calories</Text>
              <Text style={styles.historyVal}>{dailyRecords.calories} kcal</Text>
            </View>
            <View style={styles.historyCard}>
              <Text style={styles.historyLabel}>Last HR</Text>
              <Text style={styles.historyVal}>{dailyRecords.avgHr} BPM</Text>
            </View>
          </View>
        </View>
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
  connectedDeviceName: { fontSize: 13, color: '#6C5CE7', fontWeight: 'bold', textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#2D3436' },
  statusText: { fontSize: 12, color: '#636E72', marginTop: 2 },
  scanBtn: { backgroundColor: '#6C5CE7', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 10, justifyContent: 'center' },
  saveBtn: { backgroundColor: '#10AC84', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  saveBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: "#fff", padding: 20, borderRadius: 15, marginBottom: 20, elevation: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 0 },
  label: { fontSize: 11, color: '#636E72', fontWeight: 'bold', letterSpacing: 1 },
  val: { fontSize: 36, fontWeight: 'bold', color: '#2D3436', marginVertical: 5 },
  valSmall: { fontSize: 24, fontWeight: 'bold', color: '#2D3436', marginVertical: 5 },
  unit: { fontSize: 14, color: '#636E72', fontWeight: 'normal' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#2D3436', marginBottom: 10 },
  deviceCard: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#DFE6E9' },
  deviceName: { fontSize: 16, fontWeight: 'bold' },
  deviceInfo: { fontSize: 12, color: '#B2BEC3' },
  chart: { marginTop: 15, marginLeft: -20 },
  historySection: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#EEE', paddingTop: 20 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  historyCard: { backgroundColor: '#EBEEF5', flex: 0.48, padding: 15, borderRadius: 12 },
  historyLabel: { fontSize: 12, color: '#636E72' },
  historyVal: { fontSize: 18, fontWeight: 'bold', color: '#2D3436', marginTop: 5 },
  liveIndicator: { fontSize: 12, color: '#00CEC9', fontWeight: 'bold', fontStyle: 'italic' },
  weeklyCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#6C5CE7', padding: 15, borderRadius: 15, marginBottom: 20 },
  weeklyItem: { alignItems: 'center', flex: 1 },
  weeklyLabel: { color: '#DCDDE1', fontSize: 10, fontWeight: 'bold' },
  weeklyVal: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 4 }
});

export default App;