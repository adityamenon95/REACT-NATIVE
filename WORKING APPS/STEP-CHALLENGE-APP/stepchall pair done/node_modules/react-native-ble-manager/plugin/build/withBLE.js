"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const withBLEAndroidManifest_1 = require("./withBLEAndroidManifest");
const withBluetoothPermissions_1 = require("./withBluetoothPermissions");
/**
 * Apply BLE native configuration.
 */
const withBLE = (config, props = {}) => {
    const _props = props || {};
    const isBleRequired = _props.isBleRequired ?? false;
    const neverForLocation = _props.neverForLocation ?? false;
    const companionDeviceEnabled = _props.companionDeviceEnabled ?? false;
    // iOS
    config = (0, withBluetoothPermissions_1.withBluetoothPermissions)(config, _props);
    // Android
    config = config_plugins_1.AndroidConfig.Permissions.withPermissions(config, [
        'android.permission.BLUETOOTH',
        'android.permission.BLUETOOTH_ADMIN',
        'android.permission.BLUETOOTH_CONNECT', // since Android SDK 31
    ]);
    config = (0, withBLEAndroidManifest_1.withBLEAndroidManifest)(config, {
        isBleRequired,
        neverForLocation,
        companionDeviceEnabled,
    });
    return config;
};
exports.default = withBLE;
