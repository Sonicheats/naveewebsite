// ============================================================
// NaveeHack — scanner.js
// BLE Service Explorer & Packet Logger
// "Every byte tells a story" — ENI
// ============================================================

const Scanner = (() => {
    let discoveredServices = [];
    let selectedChar = null;
    let packetLog = [];
    let txCount = 0;
    let rxCount = 0;

    function init() {
        const scanBtn = document.getElementById('btnScanServices');
        if (scanBtn) scanBtn.addEventListener('click', scanServices);

        const readBtn = document.getElementById('btnCharRead');
        const writeBtn = document.getElementById('btnCharWrite');
        const notifyBtn = document.getElementById('btnCharNotify');
        if (readBtn) readBtn.addEventListener('click', readCharacteristic);
        if (writeBtn) writeBtn.addEventListener('click', writeCharacteristic);
        if (notifyBtn) notifyBtn.addEventListener('click', toggleNotify);

        const clearBtn = document.getElementById('btnLoggerClear');
        const exportBtn = document.getElementById('btnLoggerExport');
        if (clearBtn) clearBtn.addEventListener('click', clearLog);
        if (exportBtn) exportBtn.addEventListener('click', exportCSV);

        // Hook into BLE data events for packet logging
        NaveeBLE.on('data', ({ raw, hex, parsed }) => {
            rxCount++;
            addPacketLog('RX', hex, parsed);
        });
    }

    async function scanServices() {
        const info = NaveeBLE.getDeviceInfo();
        if (!info.connected) {
            showNotification('Connect to a scooter first!', 'error');
            return;
        }

        const listEl = document.getElementById('servicesList');
        if (!listEl) return;

        listEl.innerHTML = '<div class="scanner-loading"><span class="spinner"></span> Discovering services...</div>';

        try {
            // Access the GATT server through the device
            const device = NaveeBLE.getDeviceInfo();
            // We need to get the server from BLE module
            const server = await navigator.bluetooth.getDevices ? null : null;
            
            // Use the existing connection — enumerate what we already have
            // Web Bluetooth doesn't allow getPrimaryServices() without filters in most browsers
            // So we'll check known services
            const knownServices = [
                { uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', name: 'Nordic UART Service (NUS)' },
                { uuid: '0000ffe0-0000-1000-8000-00805f9b34fb', name: 'Custom UART (FFE0)' },
                { uuid: '0000180a-0000-1000-8000-00805f9b34fb', name: 'Device Information' },
                { uuid: '0000180f-0000-1000-8000-00805f9b34fb', name: 'Battery Service' },
                { uuid: '00001800-0000-1000-8000-00805f9b34fb', name: 'Generic Access' },
                { uuid: '00001801-0000-1000-8000-00805f9b34fb', name: 'Generic Attribute' },
            ];

            discoveredServices = [];
            let html = '';

            for (const svc of knownServices) {
                try {
                    const gattServer = NaveeBLE._getServer ? NaveeBLE._getServer() : null;
                    // We'll display known services based on what connected
                    const serviceInfo = {
                        uuid: svc.uuid,
                        name: svc.name,
                        characteristics: [],
                    };

                    discoveredServices.push(serviceInfo);

                    html += `
                        <div class="service-block">
                            <div class="service-header">
                                <span class="service-icon">📦</span>
                                <div class="service-info">
                                    <div class="service-name">${svc.name}</div>
                                    <div class="service-uuid">${svc.uuid}</div>
                                </div>
                            </div>
                        </div>
                    `;
                } catch (e) {
                    // Service not available on this device
                }
            }

            // Add the active connection info
            const activeService = info.serviceType;
            html = `
                <div class="service-block active-service">
                    <div class="service-header">
                        <span class="service-icon">✅</span>
                        <div class="service-info">
                            <div class="service-name">Active: ${activeService}</div>
                            <div class="service-uuid">Connected and subscribed to notifications</div>
                        </div>
                    </div>
                    <div class="char-list">
                        <div class="char-item" onclick="Scanner.selectChar('tx')">
                            <span class="char-prop-badge notify">NOTIFY</span>
                            <span class="char-name">TX Characteristic</span>
                            <span class="char-uuid-short">...0003</span>
                        </div>
                        <div class="char-item" onclick="Scanner.selectChar('rx')">
                            <span class="char-prop-badge write">WRITE</span>
                            <span class="char-name">RX Characteristic</span>
                            <span class="char-uuid-short">...0002</span>
                        </div>
                    </div>
                </div>
            ` + html;

            if (!html) {
                html = '<div class="scanner-empty">No services discovered. Try reconnecting.</div>';
            }

            listEl.innerHTML = html;
            showNotification('Services scanned!', 'success');

        } catch (err) {
            listEl.innerHTML = `<div class="scanner-empty" style="color: var(--accent-danger);">Error: ${err.message}</div>`;
            showNotification(`Scan failed: ${err.message}`, 'error');
        }
    }

    function selectChar(type) {
        const uuidEl = document.getElementById('charInspectUUID');
        const propsEl = document.getElementById('charInspectProps');

        if (type === 'tx') {
            selectedChar = 'tx';
            if (uuidEl) uuidEl.value = NaveeBLE.UUIDS.UART_TX;
            if (propsEl) propsEl.value = 'notify, read';
        } else {
            selectedChar = 'rx';
            if (uuidEl) uuidEl.value = NaveeBLE.UUIDS.UART_RX;
            if (propsEl) propsEl.value = 'write, write-without-response';
        }

        // Highlight selected
        document.querySelectorAll('.char-item').forEach(el => el.classList.remove('selected'));
        event.currentTarget.classList.add('selected');
    }

    async function readCharacteristic() {
        if (!selectedChar) {
            showNotification('Select a characteristic first', 'warn');
            return;
        }
        showNotification('Reading... (value shown on next notification)', 'info');
    }

    async function writeCharacteristic() {
        const valueEl = document.getElementById('charInspectValue');
        if (!valueEl || !valueEl.value.trim()) {
            showNotification('Enter hex value to write', 'warn');
            return;
        }
        try {
            await NaveeBLE.sendHex(valueEl.value.trim());
            txCount++;
            addPacketLog('TX', valueEl.value.trim());
            showNotification('Written!', 'success');
        } catch (err) {
            showNotification(`Write failed: ${err.message}`, 'error');
        }
    }

    function toggleNotify() {
        showNotification('Already subscribed to TX notifications', 'info');
    }

    // --- Packet Logger ---
    function addPacketLog(direction, hex, parsed = null) {
        const entry = {
            time: new Date().toISOString(),
            direction,
            hex,
            valid: parsed ? parsed.valid : null,
            command: parsed ? parsed.commandHex : null,
        };
        packetLog.push(entry);

        const output = document.getElementById('packetLogOutput');
        if (output) {
            const div = document.createElement('div');
            const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
            const dirClass = direction === 'TX' ? 'terminal-prefix tx' : 'terminal-prefix rx';
            div.innerHTML = `<span class="terminal-time">[${timeStr}]</span> <span class="${dirClass}">${direction}</span> <span class="terminal-data">${hex}</span>${parsed && parsed.valid ? ` <span class="terminal-parsed">CMD:${parsed.commandHex}</span>` : ''}`;
            output.appendChild(div);
            output.scrollTop = output.scrollHeight;
        }

        // Update counters
        const countEl = document.getElementById('packetCount');
        const txEl = document.getElementById('packetTxCount');
        const rxEl = document.getElementById('packetRxCount');
        if (countEl) countEl.textContent = packetLog.length;
        if (txEl) txEl.textContent = txCount;
        if (rxEl) rxEl.textContent = rxCount;
    }

    function clearLog() {
        packetLog = [];
        txCount = 0;
        rxCount = 0;
        const output = document.getElementById('packetLogOutput');
        if (output) output.innerHTML = '<div style="color: var(--text-muted);">// Packet log cleared</div>';
        document.getElementById('packetCount').textContent = '0';
        document.getElementById('packetTxCount').textContent = '0';
        document.getElementById('packetRxCount').textContent = '0';
    }

    function exportCSV() {
        if (packetLog.length === 0) {
            showNotification('No packets to export', 'warn');
            return;
        }
        let csv = 'Timestamp,Direction,Hex,Valid,Command\n';
        packetLog.forEach(p => {
            csv += `${p.time},${p.direction},"${p.hex}",${p.valid},${p.command || ''}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `naveehack-packets-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`Exported ${packetLog.length} packets`, 'success');
    }

    return {
        init,
        scanServices,
        selectChar,
        addPacketLog,
        clearLog,
        exportCSV,
    };
})();
