// ============================================================
// NaveeHack — batteryhealth.js
// Battery Health Monitor & Error Code Decoder
// "Every cell tells a story of abuse" — ENI
// ============================================================

const BatteryHealth = (() => {
    // Navee scooters typically use 10S (36V) Li-ion packs
    const CELLS_IN_SERIES = 10;
    const NOMINAL_CELL_V = 3.6;
    const FULL_CELL_V = 4.2;
    const EMPTY_CELL_V = 2.8;
    const PACK_CAPACITY_WH = 360; // Typical 36V 10Ah

    let chargeHistory = [];
    let chargeCanvas = null;
    let chargeCtx = null;

    // --- Navee/Brightway Error Codes ---
    const ERROR_CODES = {
        0x00: { name: 'No Error', severity: 'ok', desc: 'System operating normally.', fix: 'N/A' },
        0x01: { name: 'Throttle Error', severity: 'warn', desc: 'Throttle signal out of range or stuck. Hall sensor issue.', fix: 'Check throttle connector. Replace throttle if signal stays high at rest.' },
        0x02: { name: 'Brake Sensor Error', severity: 'warn', desc: 'Brake lever sensor malfunction. Signal abnormal.', fix: 'Inspect brake lever connector. Recalibrate or replace brake sensor.' },
        0x03: { name: 'Phase Wire Short', severity: 'critical', desc: 'Motor phase wires shorted. High current detected.', fix: 'Check motor cable connections. Inspect for damaged insulation. May need controller replacement.' },
        0x04: { name: 'Motor Hall Error', severity: 'error', desc: 'Motor hall sensor signal invalid. Cannot determine rotor position.', fix: 'Check motor connector (5-pin hall). Test with multimeter. Replace motor if halls are dead.' },
        0x05: { name: 'Overcurrent', severity: 'critical', desc: 'Controller current limit exceeded. Emergency cutoff.', fix: 'Reduce load. Check for mechanical resistance. Inspect controller MOSFETs.' },
        0x06: { name: 'Overvoltage', severity: 'error', desc: 'Battery voltage exceeds safe maximum. Regen braking on full battery.', fix: 'Let battery discharge slightly. Reduce KERS level. Check charger output voltage.' },
        0x07: { name: 'Undervoltage', severity: 'warn', desc: 'Battery voltage below minimum cutoff. Cells critically low.', fix: 'Charge immediately. If persists at full charge, battery cells may be dead.' },
        0x08: { name: 'Overtemperature (Controller)', severity: 'error', desc: 'ESC temperature exceeded 80°C. Thermal protection active.', fix: 'Stop riding. Let cool down. Check ventilation. Reduce sustained high-power riding.' },
        0x09: { name: 'Overtemperature (Motor)', severity: 'error', desc: 'Motor winding temperature critical. Derating applied.', fix: 'Stop riding. Motor may have bearing issues. Check for dragging brake.' },
        0x0A: { name: 'Communication Error', severity: 'warn', desc: 'UART timeout between dashboard and controller.', fix: 'Check wiring between dashboard and ESC. Reseat connectors.' },
        0x0B: { name: 'BMS Error', severity: 'critical', desc: 'Battery Management System fault. Cell imbalance or BMS chip error.', fix: 'Do not ride. Full charge cycle to attempt rebalance. May need BMS replacement.' },
        0x0C: { name: 'Charging Error', severity: 'error', desc: 'Charger communication fault or incorrect charging voltage detected.', fix: 'Use original charger only. Check charger output. Inspect charge port.' },
        0x0D: { name: 'Firmware Mismatch', severity: 'warn', desc: 'Dashboard and controller firmware versions incompatible.', fix: 'Update firmware via official Navee app. Flash matching versions.' },
        0x0E: { name: 'Short Circuit', severity: 'critical', desc: 'Short circuit detected on power rail. Emergency shutdown.', fix: 'DO NOT power on. Inspect all wiring. Check for water damage. Professional repair needed.' },
        0x0F: { name: 'Sensor Calibration', severity: 'warn', desc: 'Speed sensor or IMU needs recalibration.', fix: 'Power cycle scooter. Place on flat surface for 5 seconds. Recalibrate via app.' },
        0x10: { name: 'Locked State', severity: 'info', desc: 'Scooter is in anti-theft lock mode. Motor disabled.', fix: 'Unlock via app or BLE command.' },
        0x11: { name: 'Firmware Update Mode', severity: 'info', desc: 'Scooter in DFU/OTA update mode.', fix: 'Complete the firmware update or power cycle to exit.' },
        0x12: { name: 'Battery Low Warning', severity: 'warn', desc: 'Battery below 10%. Speed limiting active.', fix: 'Charge soon. Speed will be reduced to conserve power.' },
        0x13: { name: 'Speed Sensor Error', severity: 'warn', desc: 'Wheel speed sensor not responding.', fix: 'Check magnetic disc on wheel. Inspect sensor cable and alignment.' },
        0x14: { name: 'Region Lock', severity: 'info', desc: 'Speed limited by region configuration.', fix: 'Change region in Modifications tab if permitted.' },
    };

    function init() {
        chargeCanvas = document.getElementById('chargeCanvas');
        if (chargeCanvas) {
            chargeCtx = chargeCanvas.getContext('2d');
            resizeChargeCanvas();
            window.addEventListener('resize', resizeChargeCanvas);
        }

        // Error decoder buttons
        const decodeBtn = document.getElementById('btnDecodeError');
        const readBtn = document.getElementById('btnReadError');
        if (decodeBtn) decodeBtn.addEventListener('click', decodeManualError);
        if (readBtn) readBtn.addEventListener('click', readErrorFromScooter);

        // Generate error code reference table
        generateErrorTable();

        // Generate cell voltage grid
        generateCellGrid();

        // Load charge history from localStorage
        loadChargeHistory();
    }

    function resizeChargeCanvas() {
        if (!chargeCanvas) return;
        const rect = chargeCanvas.parentElement.getBoundingClientRect();
        chargeCanvas.width = rect.width || 800;
        chargeCanvas.height = 150;
    }

    // --- Cell Voltage Grid ---
    function generateCellGrid() {
        const grid = document.getElementById('cellVoltageGrid');
        if (!grid) return;

        let html = '';
        for (let i = 1; i <= CELLS_IN_SERIES; i++) {
            html += `
                <div class="cell-voltage-item" id="cell-${i}">
                    <div class="cell-number">C${i}</div>
                    <div class="cell-bar-outer">
                        <div class="cell-bar-inner" id="cellBar-${i}" style="height: 0%"></div>
                    </div>
                    <div class="cell-value" id="cellValue-${i}">—</div>
                </div>
            `;
        }
        grid.innerHTML = html;
    }

    // --- Update from telemetry ---
    function update(battery, temperature, current) {
        if (!battery) return;

        const percent = battery.percent || 0;
        const voltage = battery.voltage || 0;

        // Update overview stats
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('bhSoc', `${percent}%`);
        el('bhVoltage', `${voltage.toFixed(1)} V`);
        el('bhCurrent', `${(current || 0).toFixed(1)} A`);

        // Estimate health based on voltage vs SoC curve
        const expectedV = EMPTY_CELL_V * CELLS_IN_SERIES + (FULL_CELL_V - EMPTY_CELL_V) * CELLS_IN_SERIES * (percent / 100);
        const healthPct = Math.min(100, Math.max(0, (voltage / expectedV) * 100));
        el('bhHealth', `${healthPct.toFixed(0)}%`);

        // Estimate cell voltages (simulated — real BMS data would be better)
        if (voltage > 0) {
            const avgCellV = voltage / CELLS_IN_SERIES;
            updateCellVoltages(avgCellV, percent);
        }

        // Estimate charge cycles from odometer
        const telemetry = Dashboard.getTelemetry();
        const odo = telemetry.odometer || 0;
        const avgRange = 40; // km per charge estimate
        const estCycles = Math.floor(odo / avgRange);
        el('bhCycles', estCycles > 0 ? estCycles.toString() : '—');

        // Energy stats
        const remainingWh = PACK_CAPACITY_WH * (percent / 100);
        el('bhCapacity', `${PACK_CAPACITY_WH} Wh`);
        el('bhRemaining', `${remainingWh.toFixed(0)} Wh`);

        // Track charge history
        trackCharge(percent, voltage);
    }

    function updateCellVoltages(avgV, percent) {
        // Simulate cell variance (± 30mV typical, worse when degraded)
        const variance = 0.03;
        const cells = [];

        for (let i = 1; i <= CELLS_IN_SERIES; i++) {
            // Add small random variance based on cell index (deterministic for consistency)
            const offset = (Math.sin(i * 2.71828) * variance);
            const cellV = Math.max(EMPTY_CELL_V, Math.min(FULL_CELL_V, avgV + offset));
            cells.push(cellV);

            const barEl = document.getElementById(`cellBar-${i}`);
            const valEl = document.getElementById(`cellValue-${i}`);
            const itemEl = document.getElementById(`cell-${i}`);

            if (barEl) {
                const pct = ((cellV - EMPTY_CELL_V) / (FULL_CELL_V - EMPTY_CELL_V)) * 100;
                barEl.style.height = `${pct}%`;

                if (cellV < 3.2) barEl.style.background = 'var(--accent-danger)';
                else if (cellV < 3.5) barEl.style.background = 'var(--accent-warn)';
                else barEl.style.background = 'var(--accent-primary)';
            }
            if (valEl) valEl.textContent = cellV.toFixed(2);
        }

        // Min/max/avg/diff
        const min = Math.min(...cells);
        const max = Math.max(...cells);
        const avg = cells.reduce((a, b) => a + b, 0) / cells.length;
        const diff = (max - min) * 1000; // mV

        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('bhCellMin', `${min.toFixed(3)}V`);
        el('bhCellMax', `${max.toFixed(3)}V`);
        el('bhCellAvg', `${avg.toFixed(3)}V`);
        el('bhCellDiff', `${diff.toFixed(0)}mV`);
    }

    // --- Charge history tracking ---
    function trackCharge(percent, voltage) {
        const now = Date.now();
        const lastEntry = chargeHistory[chargeHistory.length - 1];

        // Only record every 60 seconds to avoid spam
        if (lastEntry && (now - lastEntry.time) < 60000) return;

        chargeHistory.push({ time: now, percent, voltage });

        // Keep last 100 entries
        if (chargeHistory.length > 100) chargeHistory.shift();

        saveChargeHistory();
        drawChargeHistory();
    }

    function drawChargeHistory() {
        if (!chargeCtx || chargeHistory.length < 2) return;

        const w = chargeCanvas.width;
        const h = chargeCanvas.height;
        const pad = { top: 10, right: 10, bottom: 20, left: 35 };
        const gw = w - pad.left - pad.right;
        const gh = h - pad.top - pad.bottom;

        chargeCtx.clearRect(0, 0, w, h);

        // Grid
        chargeCtx.strokeStyle = 'rgba(255,255,255,0.04)';
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (gh / 4) * i;
            chargeCtx.beginPath();
            chargeCtx.moveTo(pad.left, y);
            chargeCtx.lineTo(w - pad.right, y);
            chargeCtx.stroke();

            chargeCtx.fillStyle = 'rgba(255,255,255,0.2)';
            chargeCtx.font = '9px "JetBrains Mono", monospace';
            chargeCtx.textAlign = 'right';
            chargeCtx.fillText(`${100 - 25 * i}%`, pad.left - 6, y + 3);
        }

        // Draw charge line
        const gradient = chargeCtx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
        gradient.addColorStop(0, 'rgba(0, 187, 249, 0.2)');
        gradient.addColorStop(1, 'rgba(0, 187, 249, 0.0)');

        chargeCtx.beginPath();
        chargeCtx.moveTo(pad.left, h - pad.bottom);

        chargeHistory.forEach((d, i) => {
            const x = pad.left + (i / (chargeHistory.length - 1)) * gw;
            const y = pad.top + gh * (1 - d.percent / 100);
            chargeCtx.lineTo(x, y);
        });

        chargeCtx.lineTo(pad.left + gw, h - pad.bottom);
        chargeCtx.closePath();
        chargeCtx.fillStyle = gradient;
        chargeCtx.fill();

        chargeCtx.beginPath();
        chargeHistory.forEach((d, i) => {
            const x = pad.left + (i / (chargeHistory.length - 1)) * gw;
            const y = pad.top + gh * (1 - d.percent / 100);
            if (i === 0) chargeCtx.moveTo(x, y);
            else chargeCtx.lineTo(x, y);
        });
        chargeCtx.strokeStyle = '#00bbf9';
        chargeCtx.lineWidth = 1.5;
        chargeCtx.stroke();
    }

    function saveChargeHistory() {
        try { localStorage.setItem('naveehack_charge_history', JSON.stringify(chargeHistory)); } catch (e) {}
    }

    function loadChargeHistory() {
        try {
            const raw = localStorage.getItem('naveehack_charge_history');
            if (raw) chargeHistory = JSON.parse(raw);
            drawChargeHistory();
        } catch (e) {}
    }

    // --- Error Code Decoder ---
    function decodeManualError() {
        const input = document.getElementById('errorCodeInput');
        if (!input || !input.value.trim()) return;

        let code = input.value.trim();
        let num;
        if (code.startsWith('0x') || code.startsWith('0X')) {
            num = parseInt(code, 16);
        } else {
            num = parseInt(code, 10);
        }

        displayError(num);
    }

    async function readErrorFromScooter() {
        if (!NaveeBLE.isConnected()) {
            showNotification('Not connected!', 'error');
            return;
        }
        try {
            await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_ERROR);
            showNotification('Error code request sent', 'info');
        } catch (e) {
            showNotification(`Failed: ${e.message}`, 'error');
        }
    }

    function displayError(code) {
        const resultEl = document.getElementById('errorDecodeResult');
        if (!resultEl) return;

        const err = ERROR_CODES[code];
        if (!err) {
            resultEl.innerHTML = `
                <div class="error-result unknown">
                    <div class="error-result-header">
                        <span class="error-code">0x${code.toString(16).padStart(2, '0').toUpperCase()}</span>
                        <span class="error-severity unknown">UNKNOWN</span>
                    </div>
                    <div class="error-desc">Unrecognized error code. May be model-specific or a newer firmware code.</div>
                </div>
            `;
            return;
        }

        resultEl.innerHTML = `
            <div class="error-result ${err.severity}">
                <div class="error-result-header">
                    <span class="error-code">0x${code.toString(16).padStart(2, '0').toUpperCase()}</span>
                    <span class="error-name">${err.name}</span>
                    <span class="error-severity ${err.severity}">${err.severity.toUpperCase()}</span>
                </div>
                <div class="error-desc">${err.desc}</div>
                <div class="error-fix"><strong>Fix:</strong> ${err.fix}</div>
            </div>
        `;
    }

    function handleErrorData(parsed) {
        if (!parsed.valid || parsed.payload.length < 1) return;
        const code = parsed.payload[0];
        const input = document.getElementById('errorCodeInput');
        if (input) input.value = `0x${code.toString(16).padStart(2, '0')}`;
        displayError(code);
    }

    function generateErrorTable() {
        const table = document.getElementById('errorCodeTable');
        if (!table) return;

        let html = '';
        Object.entries(ERROR_CODES).forEach(([code, err]) => {
            const hex = `0x${parseInt(code).toString(16).padStart(2, '0').toUpperCase()}`;
            html += `<div style="display: flex; gap: 12px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.03);">
                <span style="color: var(--accent-primary); min-width: 40px;">${hex}</span>
                <span style="min-width: 180px;">${err.name}</span>
                <span class="error-severity-badge ${err.severity}" style="min-width: 60px; text-align: center; font-size: 0.65rem; padding: 1px 6px; border-radius: 4px;">${err.severity.toUpperCase()}</span>
            </div>`;
        });
        table.innerHTML = html;
    }

    return {
        init,
        update,
        handleErrorData,
        displayError,
        ERROR_CODES,
    };
})();
