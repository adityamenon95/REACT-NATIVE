import { ConfigPlugin } from 'expo/config-plugins';
/**
 * Apply BLE native configuration.
 */
declare const withBLE: ConfigPlugin<{
    neverForLocation?: boolean;
    bluetoothAlwaysPermission?: string | false;
    companionDeviceEnabled?: boolean;
    isBleRequired?: boolean;
} | void>;
export default withBLE;
