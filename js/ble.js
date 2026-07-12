// ============================================================
// NaveeHack — ble.js
// Web Bluetooth Connection Manager
// "One API to find them, one API to bind them" — ENI
// ============================================================

const NaveeBLE = (() => {
    // --- Nordic UART Service UUIDs ---
    const UART_SERVICE_UUID     = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    const UART_TX_CHAR_UUID     = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify (scooter → us)
    const UART_RX_CHAR_UUID     = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write  (us → scooter)

    // Fallback: Generic HM-10 style
    const FALLBACK_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
    const FALLBACK_CHAR_UUID    = '0000ffe1-0000-1000-8000-00805f9b34fb';

    // State
    let device = null;
    let server = null;
    let service = null;
    let txChar = null;  // We READ from this (notifications)
    let rxChar = null;  // We WRITE to this
    let connected = false;
    let reconnecting = false;
    let useNordic = true;
    let useWriteWithoutResponse = false; // Detected at connect time
    let mockMode = false;
    let mockSettings = {
        region: 0x01,
        speedLimit: 20,
        cruiseControl: false,
        kersLevel: 2,
        lightOn: false,
        locked: false,
        accelCurve: 1,
        motorLimit: 20,
        startupSpeed: 5,
    };
    let mockInputs = {
        brakePressed: false,
        throttlePressed: false,
    };

    // --- Receive buffer for packet reassembly ---
    // Real BLE has ~20-byte MTU, scooter responses can span multiple notifications
    let rxBuffer = new Uint8Array(0);
    let rxBufferTimeout = null;

    function setMockMode(enabled) {
        mockMode = enabled;
        if (enabled) {
            log('Mock BLE mode enabled');
            mockSettings = {
                region: 0x01,
                speedLimit: 20,
                cruiseControl: false,
                kersLevel: 2,
                lightOn: false,
                locked: false,
                accelCurve: 1,
                motorLimit: 20,
                startupSpeed: 5,
            };
            mockInputs = {
                brakePressed: false,
                throttlePressed: false,
            };
        } else {
            log('Mock BLE mode disabled');
        }
    }

    function setMockInputs(inputs) {
        mockInputs = { ...mockInputs, ...inputs };
    }

    // Event listeners
    const listeners = {
        connected: [],
        disconnected: [],
        data: [],
        error: [],
        log: [],
    };

    function on(event, callback) {
        if (listeners[event]) {
            listeners[event].push(callback);
        }
    }

    function off(event, callback) {
        if (listeners[event]) {
            listeners[event] = listeners[event].filter(cb => cb !== callback);
        }
    }

    function emit(event, data) {
        if (listeners[event]) {
            listeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(`Event handler error [${event}]:`, e); }
            });
        }
    }

    function log(msg, type = 'info') {
        const entry = { time: new Date().toISOString(), message: msg, type };
        emit('log', entry);
        if (type === 'error') {
            console.error(`[BLE] ${msg}`);
        } else {
            console.log(`[BLE] ${msg}`);
        }
    }

    // --- Check if Web Bluetooth is available ---
    function isSupported() {
        return !!navigator.bluetooth;
    }

    // --- Scan and Connect (filtered mode) ---
    async function scanAndConnect() {
        if (!isSupported()) {
            const err = 'Web Bluetooth not supported. Use Chrome/Edge/Opera.';
            log(err, 'error');
            emit('error', { message: err });
            throw new Error(err);
        }

        log('Scanning for Navee scooters (filtered)...');

        try {
            // Request device — comprehensive name prefix filters for all known Navee models
            device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'Navee' },
                    { namePrefix: 'NAVEE' },
                    { namePrefix: 'NKT' },
                    { namePrefix: 'BW' },       // Brightway OEM
                    { namePrefix: 'Mi Scooter' },
                    { namePrefix: 'GT3' },       // Navee GT3 series
                    { namePrefix: 'GT5' },       // Navee GT5 series
                    { namePrefix: 'ST3' },       // Navee ST3 series
                    { namePrefix: 'ST5' },       // Navee ST5 series
                    { namePrefix: 'N65' },       // Navee N65 / N65i
                    { namePrefix: 'S65' },       // Navee S65
                    { namePrefix: 'S60' },       // Navee S60
                    { namePrefix: 'V40' },       // Navee V40
                    { namePrefix: 'V50' },       // Navee V50
                    { namePrefix: 'G5' },        // Navee G5 variants
                    { namePrefix: 'N4' },        // Navee N40 etc.
                ],
                optionalServices: [UART_SERVICE_UUID, FALLBACK_SERVICE_UUID],
            });

            return await connectToDevice(device);

        } catch (err) {
            if (err.name === 'NotFoundError') {
                log('Scan cancelled by user', 'warn');
            } else {
                log(`Connection failed: ${err.message}`, 'error');
                emit('error', { message: err.message });
            }
            throw err;
        }
    }

    // --- Scan ALL devices (no name filter — last resort) ---
    async function scanAll() {
        if (!isSupported()) {
            const err = 'Web Bluetooth not supported. Use Chrome/Edge/Opera.';
            log(err, 'error');
            emit('error', { message: err });
            throw new Error(err);
        }

        log('Scanning ALL BLE devices (unfiltered — showing everything)...');

        try {
            device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [UART_SERVICE_UUID, FALLBACK_SERVICE_UUID],
            });

            return await connectToDevice(device);

        } catch (err) {
            if (err.name === 'NotFoundError') {
                log('Scan cancelled by user', 'warn');
            } else {
                log(`Connection failed: ${err.message}`, 'error');
                emit('error', { message: err.message });
            }
            throw err;
        }
    }

    // --- Shared connection logic after device selection ---
    async function connectToDevice(selectedDevice) {
        device = selectedDevice;
        log(`Device found: ${device.name || 'Unknown'} (${device.id})`);

        // Listen for disconnection
        device.addEventListener('gattserverdisconnected', onDisconnected);

        // Connect to GATT server
        log('Connecting to GATT server...');
        server = await device.gatt.connect();
        log('GATT connected');

        // Try Nordic UART first, fallback to HM-10
        try {
            service = await server.getPrimaryService(UART_SERVICE_UUID);
            useNordic = true;
            log('Nordic UART Service found');

            txChar = await service.getCharacteristic(UART_TX_CHAR_UUID);
            rxChar = await service.getCharacteristic(UART_RX_CHAR_UUID);
            log('TX/RX characteristics acquired');
        } catch (e) {
            log('Nordic UART not found, trying fallback (FFE0)...');
            try {
                service = await server.getPrimaryService(FALLBACK_SERVICE_UUID);
                useNordic = false;
                const char = await service.getCharacteristic(FALLBACK_CHAR_UUID);
                txChar = char;
                rxChar = char; // Same characteristic for both
                log('Fallback service (FFE0/FFE1) connected');
            } catch (e2) {
                throw new Error('No compatible BLE service found on device');
            }
        }

        // Detect write method from characteristic properties
        if (rxChar.properties) {
            if (rxChar.properties.writeWithoutResponse && !rxChar.properties.write) {
                useWriteWithoutResponse = true;
                log('Write mode: writeValueWithoutResponse (detected from properties)');
            } else if (rxChar.properties.write) {
                useWriteWithoutResponse = false;
                log('Write mode: writeValue (detected from properties)');
            } else if (rxChar.properties.writeWithoutResponse) {
                // Has both — prefer writeWithoutResponse for speed
                useWriteWithoutResponse = true;
                log('Write mode: writeValueWithoutResponse (preferred, both available)');
            }
        }

        // Reset receive buffer
        rxBuffer = new Uint8Array(0);

        // Subscribe to notifications
        await txChar.startNotifications();
        txChar.addEventListener('characteristicvaluechanged', onTxNotification);
        log('Subscribed to notifications');

        connected = true;
        emit('connected', {
            name: device.name || 'Unknown',
            id: device.id,
            serviceType: useNordic ? 'Nordic UART' : 'FFE0 Generic',
        });

        log(`✓ Connected to ${device.name}`);
        return getDeviceInfo();
    }

    // --- Disconnect ---
    async function disconnect() {
        const wasMock = mockMode;
        if (mockMode) {
            mockMode = false;
        }
        if (device && device.gatt.connected) {
            log('Disconnecting...');
            try {
                if (txChar) {
                    txChar.removeEventListener('characteristicvaluechanged', onTxNotification);
                    await txChar.stopNotifications();
                }
            } catch (e) { /* ignore */ }
            device.gatt.disconnect();
        }
        cleanup();
        if (wasMock) {
            onDisconnected();
        }
    }

    function cleanup() {
        connected = false;
        server = null;
        service = null;
        txChar = null;
        rxChar = null;
        rxBuffer = new Uint8Array(0);
        if (rxBufferTimeout) {
            clearTimeout(rxBufferTimeout);
            rxBufferTimeout = null;
        }
    }

    function onDisconnected() {
        log('Device disconnected', 'warn');
        cleanup();
        emit('disconnected', { wasReconnect: reconnecting });

        // Auto-reconnect attempt
        if (!reconnecting && device) {
            reconnecting = true;
            log('Attempting auto-reconnect in 3s...');
            setTimeout(async () => {
                try {
                    if (device && device.gatt) {
                        server = await device.gatt.connect();
                        await connectToDevice(device);
                    }
                    reconnecting = false;
                } catch (e) {
                    reconnecting = false;
                    log('Auto-reconnect failed', 'error');
                }
            }, 3000);
        }
    }

    // --- Handle incoming data with packet reassembly ---
    function onTxNotification(event) {
        const value = event.target.value;
        const chunk = new Uint8Array(value.buffer);
        const hex = NaveeProtocol.toHexString(chunk);
        log(`← RX chunk: ${hex} (${chunk.length} bytes)`);

        // Append chunk to receive buffer
        const newBuffer = new Uint8Array(rxBuffer.length + chunk.length);
        newBuffer.set(rxBuffer);
        newBuffer.set(chunk, rxBuffer.length);
        rxBuffer = newBuffer;

        // Reset the buffer flush timeout — if we don't get more data within 100ms,
        // flush whatever we have (handles edge cases where footer is missing)
        if (rxBufferTimeout) clearTimeout(rxBufferTimeout);
        rxBufferTimeout = setTimeout(() => {
            flushRxBuffer(true);
        }, 100);

        // Try to extract complete frames immediately
        flushRxBuffer(false);
    }

    function flushRxBuffer(force) {
        if (rxBuffer.length === 0) return;

        const { frames, remainder } = NaveeProtocol.extractFrames(rxBuffer);

        for (const frame of frames) {
            const hex = NaveeProtocol.toHexString(frame);
            log(`← RX packet: ${hex}`);
            const parsed = NaveeProtocol.parseResponse(frame);
            emit('data', { raw: frame, hex, parsed });
        }

        if (force && remainder.length > 0) {
            // Force-parse whatever's left as a best-effort packet
            const hex = NaveeProtocol.toHexString(remainder);
            log(`← RX remainder (forced): ${hex}`);
            const parsed = NaveeProtocol.parseResponse(remainder);
            emit('data', { raw: remainder, hex, parsed });
            rxBuffer = new Uint8Array(0);
        } else {
            rxBuffer = remainder;
        }
    }

    // --- Send data to scooter ---
    async function write(data) {
        if (mockMode) {
            const hex = NaveeProtocol.toHexString(data);
            log(`→ TX (Simulated): ${hex}`);
            return;
        }

        if (!connected || !rxChar) {
            throw new Error('Not connected');
        }

        if (!(data instanceof Uint8Array)) {
            data = new Uint8Array(data);
        }

        const hex = NaveeProtocol.toHexString(data);
        log(`→ TX: ${hex}`);

        // BLE has a 20-byte MTU limit typically, chunk if needed
        const chunkSize = 20;
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);

            // Use the correct write method based on characteristic properties
            if (useWriteWithoutResponse) {
                await rxChar.writeValueWithoutResponse(chunk);
            } else {
                await rxChar.writeValue(chunk);
            }

            if (i + chunkSize < data.length) {
                await new Promise(r => setTimeout(r, 50)); // Small delay between chunks
            }
        }
    }

    // --- Send a protocol command ---
    async function sendCommand(command, payload = []) {
        if (mockMode) {
            const packet = NaveeProtocol.buildPacket(command, payload);
            const hex = NaveeProtocol.toHexString(packet);
            log(`→ TX (Simulated CMD): ${hex}`);

            // Update mock settings on write
            if (command === NaveeProtocol.CMD.WRITE_REGION) mockSettings.region = payload[0];
            if (command === NaveeProtocol.CMD.WRITE_SPEED_LIMIT) mockSettings.speedLimit = payload[0];
            if (command === NaveeProtocol.CMD.WRITE_CRUISE) mockSettings.cruiseControl = !!payload[0];
            if (command === NaveeProtocol.CMD.WRITE_KERS) mockSettings.kersLevel = payload[0];
            if (command === NaveeProtocol.CMD.WRITE_LOCK) mockSettings.locked = !!payload[0];
            if (command === NaveeProtocol.CMD.WRITE_LIGHT) mockSettings.lightOn = !!payload[0];
            if (command === NaveeProtocol.CMD.WRITE_ACCEL_CURVE) mockSettings.accelCurve = payload[0];
            if (command === NaveeProtocol.CMD.WRITE_MOTOR_LIMIT) mockSettings.motorLimit = payload[0];
            if (command === NaveeProtocol.CMD.WRITE_STARTUP_SPEED) mockSettings.startupSpeed = payload[0];

            // Trigger asynchronous simulated response
            setTimeout(() => {
                let respPayload = [];
                switch (command) {
                    case NaveeProtocol.CMD.READ_SPEED: {
                        // speed in 0.1 km/h
                        const speedVal = Math.round((15 + Math.random() * 10) * 10);
                        respPayload = [
                            speedVal & 0xFF, 
                            (speedVal >> 8) & 0xFF,
                            mockInputs.brakePressed ? 1 : 0,
                            mockInputs.throttlePressed ? 1 : 0
                        ];
                        break;
                    }
                    case NaveeProtocol.CMD.READ_BATTERY: {
                        const percent = 85;
                        const volt = Math.round(38.5 * 100);
                        respPayload = [percent, volt & 0xFF, (volt >> 8) & 0xFF];
                        break;
                    }
                    case NaveeProtocol.CMD.READ_TEMPERATURE: {
                        // temps in 0.1 C
                        const mot = Math.round(35.2 * 10);
                        const ctrl = Math.round(32.1 * 10);
                        const bat = Math.round(28.5 * 10);
                        respPayload = [
                            mot & 0xFF, (mot >> 8) & 0xFF,
                            ctrl & 0xFF, (ctrl >> 8) & 0xFF,
                            bat & 0xFF, (bat >> 8) & 0xFF
                        ];
                        break;
                    }
                    case NaveeProtocol.CMD.READ_ODOMETER: {
                        // odometer in meters
                        const odo = Math.round(124.5 * 1000);
                        respPayload = [odo & 0xFF, (odo >> 8) & 0xFF, (odo >> 16) & 0xFF, (odo >> 24) & 0xFF];
                        break;
                    }
                    case NaveeProtocol.CMD.READ_SETTINGS:
                        respPayload = [
                            mockSettings.region,
                            mockSettings.speedLimit,
                            mockSettings.cruiseControl ? 1 : 0,
                            mockSettings.kersLevel,
                            mockSettings.lightOn ? 1 : 0,
                            mockSettings.locked ? 1 : 0
                        ];
                        break;
                    case NaveeProtocol.CMD.READ_FIRMWARE:
                        respPayload = [1, 2, 4];
                        break;
                    case NaveeProtocol.CMD.READ_SERIAL:
                        respPayload = Array.from("N6523G123456").map(c => c.charCodeAt(0));
                        break;
                    default:
                        respPayload = [...payload];
                        break;
                }

                const respCmd = NaveeProtocol.nibbleSwap(command);
                const respPacket = NaveeProtocol.buildPacket(respCmd, respPayload);
                const respHex = NaveeProtocol.toHexString(respPacket);
                log(`← RX: ${respHex}`);

                const parsed = NaveeProtocol.parseResponse(respPacket);
                emit('data', { raw: respPacket, hex: respHex, parsed });
            }, 50);

            return packet;
        }

        const packet = NaveeProtocol.buildPacket(command, payload);
        await write(packet);
        return packet;
    }

    // --- Convenience: send raw hex string ---
    async function sendHex(hexString) {
        if (mockMode) {
            log(`→ TX (Simulated Hex): ${hexString}`);
            return NaveeProtocol.fromHexString(hexString);
        }
        const data = NaveeProtocol.fromHexString(hexString);
        await write(data);
        return data;
    }

    // --- Get device info ---
    function getDeviceInfo() {
        return {
            name: mockMode ? 'Navee S65 (Demo)' : (device ? device.name : null),
            id: mockMode ? 'demo-device-id' : (device ? device.id : null),
            connected: connected || mockMode,
            serviceType: mockMode ? 'Nordic UART (Simulated)' : (useNordic ? 'Nordic UART' : 'FFE0 Generic'),
        };
    }

    function isConnected() {
        return connected || mockMode;
    }

    // --- Expose GATT server for Scanner module ---
    function _getServer() {
        return server;
    }

    return {
        isSupported,
        scanAndConnect,
        scanAll,
        disconnect,
        write,
        sendCommand,
        sendHex,
        getDeviceInfo,
        isConnected,
        setMockMode,
        setMockInputs,
        _getServer,
        on,
        off,
        emit,
        log,
        // Expose UUIDs for reference
        UUIDS: {
            UART_SERVICE: UART_SERVICE_UUID,
            UART_TX: UART_TX_CHAR_UUID,
            UART_RX: UART_RX_CHAR_UUID,
            FALLBACK_SERVICE: FALLBACK_SERVICE_UUID,
            FALLBACK_CHAR: FALLBACK_CHAR_UUID,
        },
    };
})();
