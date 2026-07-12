// ============================================================
// NaveeHack — dashboard.js
// Live Telemetry Dashboard with Animated Gauges
// "Data is beautiful when it glows" — ENI
// ============================================================

const Dashboard = (() => {
    let pollingInterval = null;
    let telemetryData = {
        speed: 0,
        battery: { percent: 0, voltage: 0 },
        odometer: 0,
        trip: 0,
        temperature: { motor: 0, controller: 0, battery: 0 },
        current: 0,
        error: null,
    };

    // --- SVG Speedometer ---
    function createSpeedometer(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <svg viewBox="0 0 200 120" class="speedometer-svg">
                <defs>
                    <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#00f5d4;stop-opacity:1" />
                        <stop offset="50%" style="stop-color:#00bbf9;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#f15bb5;stop-opacity:1" />
                    </linearGradient>
                    <filter id="glow">
                        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                        <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <!-- Background arc -->
                <path d="M 20 100 A 80 80 0 0 1 180 100" 
                      fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8" 
                      stroke-linecap="round"/>
                <!-- Active arc -->
                <path id="speedArc" d="M 20 100 A 80 80 0 0 1 180 100" 
                      fill="none" stroke="url(#gaugeGrad)" stroke-width="8" 
                      stroke-linecap="round" stroke-dasharray="251.3" stroke-dashoffset="251.3"
                      filter="url(#glow)"
                      style="transition: stroke-dashoffset 0.5s cubic-bezier(0.4,0,0.2,1)"/>
                <!-- Tick marks -->
                ${generateTicks()}
                <!-- Speed value -->
                <text id="speedValue" x="100" y="85" text-anchor="middle" 
                      fill="#00f5d4" font-family="'JetBrains Mono', monospace" 
                      font-size="28" font-weight="700" filter="url(#glow)">0</text>
                <text x="100" y="105" text-anchor="middle" 
                      fill="rgba(255,255,255,0.4)" font-family="'Inter', sans-serif" 
                      font-size="8">KM/H</text>
            </svg>
        `;
    }

    function generateTicks() {
        let ticks = '';
        const cx = 100, cy = 100, r = 88;
        for (let i = 0; i <= 10; i++) {
            const angle = Math.PI + (Math.PI * i / 10);
            const x1 = cx + r * Math.cos(angle);
            const y1 = cy + r * Math.sin(angle);
            const x2 = cx + (r - 6) * Math.cos(angle);
            const y2 = cy + (r - 6) * Math.sin(angle);
            const major = i % 2 === 0;
            ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                        stroke="${major ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}" 
                        stroke-width="${major ? 1.5 : 0.8}"/>`;
            if (major) {
                const tx = cx + (r - 14) * Math.cos(angle);
                const ty = cy + (r - 14) * Math.sin(angle);
                ticks += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle"
                          fill="rgba(255,255,255,0.3)" font-size="6" 
                          font-family="'JetBrains Mono', monospace">${i * 5}</text>`;
            }
        }
        return ticks;
    }

    function updateSpeedometer(speed, maxSpeed = 50) {
        const arc = document.getElementById('speedArc');
        const valueEl = document.getElementById('speedValue');
        if (!arc || !valueEl) return;

        const totalLength = 251.3; // Half-circle arc length for r=80
        const fraction = Math.min(speed / maxSpeed, 1);
        const offset = totalLength * (1 - fraction);
        arc.setAttribute('stroke-dashoffset', offset);
        valueEl.textContent = speed.toFixed(1);
    }

    // --- Battery display ---
    function updateBattery(percent, voltage) {
        const bar = document.getElementById('batteryBar');
        const pctEl = document.getElementById('batteryPercent');
        const voltEl = document.getElementById('batteryVoltage');

        if (bar) {
            bar.style.width = `${percent}%`;
            // Color based on level
            if (percent > 60) {
                bar.style.background = 'linear-gradient(90deg, #00f5d4, #00bbf9)';
            } else if (percent > 25) {
                bar.style.background = 'linear-gradient(90deg, #fee440, #f9a825)';
            } else {
                bar.style.background = 'linear-gradient(90deg, #f15bb5, #ff006e)';
            }
        }
        if (pctEl) pctEl.textContent = `${percent}%`;
        if (voltEl) voltEl.textContent = `${voltage.toFixed(1)}V`;
    }

    // --- Temperature gauges ---
    function updateTemperatures(temps) {
        ['motor', 'controller', 'battery'].forEach(key => {
            const el = document.getElementById(`temp-${key}`);
            const barEl = document.getElementById(`tempBar-${key}`);
            if (el) el.textContent = `${temps[key].toFixed(1)}°C`;
            if (barEl) {
                const pct = Math.min(temps[key] / 80, 1) * 100; // 80°C max
                barEl.style.width = `${pct}%`;
                if (temps[key] > 60) {
                    barEl.style.background = '#ff006e';
                } else if (temps[key] > 40) {
                    barEl.style.background = '#fee440';
                } else {
                    barEl.style.background = '#00f5d4';
                }
            }
        });
    }

    // --- Stats ---
    function updateStats(data) {
        const fields = {
            'stat-odometer': `${data.odometer.toFixed(1)} km`,
            'stat-trip': `${data.trip.toFixed(1)} km`,
            'stat-current': `${data.current.toFixed(1)} A`,
        };
        Object.entries(fields).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
    }

    // --- Polling loop ---
    function startPolling(intervalMs = 1000) {
        stopPolling();
        log('Dashboard polling started');

        pollingInterval = setInterval(async () => {
            if (!NaveeBLE.isConnected()) return;

            try {
                // Send telemetry read commands
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_SPEED);
                await sleep(100);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_BATTERY);
                await sleep(100);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_TEMPERATURE);
                await sleep(100);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_ODOMETER);
            } catch (e) {
                console.warn('Polling error:', e);
            }
        }, intervalMs);
    }

    function stopPolling() {
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }

    // --- Handle incoming telemetry data ---
    function handleData(parsed) {
        if (!parsed.valid) return;

        const cmd = NaveeProtocol.nibbleSwap(parsed.command);

        switch (cmd) {
            case NaveeProtocol.CMD.READ_SPEED:
                telemetryData.speed = NaveeProtocol.decodeSpeed(parsed.payload);
                updateSpeedometer(telemetryData.speed);
                break;
            case NaveeProtocol.CMD.READ_BATTERY:
                telemetryData.battery = NaveeProtocol.decodeBattery(parsed.payload);
                updateBattery(telemetryData.battery.percent, telemetryData.battery.voltage);
                break;
            case NaveeProtocol.CMD.READ_ODOMETER:
                telemetryData.odometer = NaveeProtocol.decodeOdometer(parsed.payload);
                updateStats(telemetryData);
                break;
            case NaveeProtocol.CMD.READ_TEMPERATURE:
                telemetryData.temperature = NaveeProtocol.decodeTemperature(parsed.payload);
                updateTemperatures(telemetryData.temperature);
                break;
            case NaveeProtocol.CMD.READ_TRIP:
                telemetryData.trip = NaveeProtocol.decodeOdometer(parsed.payload);
                updateStats(telemetryData);
                break;
        }
    }

    function getTelemetry() {
        return { ...telemetryData };
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function log(msg) {
        console.log(`[Dashboard] ${msg}`);
    }

    // --- Demo mode (simulated data for testing without a scooter) ---
    let demoInterval = null;

    function startDemo() {
        stopDemo();
        log('Demo mode started');
        let speed = 0;
        let direction = 1;
        let battery = 85;

        demoInterval = setInterval(() => {
            speed += direction * (Math.random() * 2);
            if (speed > 35) direction = -1;
            if (speed < 0) { speed = 0; direction = 1; }
            battery -= 0.01;
            if (battery < 0) battery = 100;

            telemetryData.speed = speed;
            telemetryData.battery = { percent: Math.round(battery), voltage: 36 + (battery / 100) * 6 };
            telemetryData.odometer += speed / 3600;
            telemetryData.trip += speed / 3600;
            telemetryData.current = speed * 0.5 + Math.random() * 2;
            telemetryData.temperature = {
                motor: 25 + speed * 0.5 + Math.random() * 3,
                controller: 22 + speed * 0.3 + Math.random() * 2,
                battery: 20 + speed * 0.1 + Math.random(),
            };

            updateSpeedometer(telemetryData.speed);
            updateBattery(telemetryData.battery.percent, telemetryData.battery.voltage);
            updateTemperatures(telemetryData.temperature);
            updateStats(telemetryData);
        }, 200);
    }

    function stopDemo() {
        if (demoInterval) {
            clearInterval(demoInterval);
            demoInterval = null;
        }
    }

    return {
        createSpeedometer,
        updateSpeedometer,
        updateBattery,
        updateTemperatures,
        updateStats,
        startPolling,
        stopPolling,
        handleData,
        getTelemetry,
        startDemo,
        stopDemo,
    };
})();
