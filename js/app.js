// ============================================================
// NaveeHack — app.js
// Main Application Controller
// "The brain that wires it all together" — ENI
// ============================================================

const App = (() => {

    let currentView = 'dashboard';
    let terminalHistory = [];
    let firmwareInfo = null;

    // --- Initialize ---
    function init() {
        console.log('%c[NaveeHack] Initializing...', 'color: #00f5d4; font-weight: bold');

        // iOS viewport height fix — 100vh lies on iOS, window.innerHeight tells the truth
        fixViewportHeight();

        // Check Web Bluetooth support — smart detection for iOS/Safari/Firefox
        checkBLESupport();

        // Setup navigation
        setupNavigation();

        // Setup BLE event handlers
        setupBLEHandlers();

        // Setup connection button
        setupConnectionUI();

        // Setup terminal
        setupTerminal();

        // Setup mods
        Mods.init();

        // Create speedometer
        Dashboard.createSpeedometer('speedometer');

        // Setup demo mode button
        const demoBtn = document.getElementById('btnDemo');
        if (demoBtn) {
            demoBtn.addEventListener('click', toggleDemo);
        }

        // Setup apply button
        const applyBtn = document.getElementById('btnApplyMods');
        if (applyBtn) {
            applyBtn.addEventListener('click', Mods.applyAll);
        }

        // Setup export/import
        const exportBtn = document.getElementById('btnExport');
        const importBtn = document.getElementById('btnImport');
        if (exportBtn) exportBtn.addEventListener('click', exportProfile);
        if (importBtn) importBtn.addEventListener('click', () => document.getElementById('importFile').click());
        const importFile = document.getElementById('importFile');
        if (importFile) importFile.addEventListener('change', importProfile);

        // Init new modules
        Scanner.init();
        SpeedGraph.init();
        BatteryHealth.init();
        RideTracker.init();
        PanicMode.init();

        // Load saved settings
        loadSettings();

        // Show dashboard by default
        showView('dashboard');

        // Start particles
        initParticles();

        console.log('%c[NaveeHack] Ready. 🛴⚡', 'color: #00f5d4; font-weight: bold');
    }

    // --- Navigation ---
    function setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                if (view) showView(view);
            });
        });
    }

    function showView(viewId) {
        currentView = viewId;

        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });

        // Update view panels
        document.querySelectorAll('.view-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `view-${viewId}`);
        });

        // Start/stop polling based on view
        if (viewId === 'dashboard' && NaveeBLE.isConnected()) {
            Dashboard.startPolling();
        } else {
            Dashboard.stopPolling();
        }
    }

    // --- BLE Event Handlers ---
    function setupBLEHandlers() {
        NaveeBLE.on('connected', (info) => {
            updateConnectionUI(true, info);
            addLog(`Connected to ${info.name} (${info.serviceType})`, 'success');

            // Update info page
            const infoName = document.getElementById('infoDeviceName');
            const infoService = document.getElementById('bleServiceType');
            if (infoName) infoName.textContent = info.name;
            if (infoService) infoService.textContent = info.serviceType;

            // Read initial settings
            setTimeout(async () => {
                try {
                    await Mods.readCurrentSettings();
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_FIRMWARE);
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_SERIAL);
                } catch (e) { console.warn('Initial read error:', e); }
            }, 500);

            if (currentView === 'dashboard') {
                Dashboard.startPolling();
            }
        });

        NaveeBLE.on('disconnected', () => {
            updateConnectionUI(false);
            Dashboard.stopPolling();
            addLog('Disconnected from scooter', 'warn');
            
            // Cleanup demo button state if it was active
            if (demoActive) {
                demoActive = false;
                const btn = document.getElementById('btnDemo');
                if (btn) {
                    btn.textContent = '▶ Demo';
                    btn.classList.remove('active');
                }
                NaveeBLE.setMockMode(false);
            }
        });

        NaveeBLE.on('data', ({ raw, hex, parsed }) => {
            // Route to appropriate handler
            if (parsed.valid) {
                Dashboard.handleData(parsed);

                const origCmd = NaveeProtocol.nibbleSwap(parsed.command);
                if (origCmd === NaveeProtocol.CMD.READ_SETTINGS) {
                    Mods.handleSettingsData(parsed);
                }
                if (origCmd === NaveeProtocol.CMD.READ_FIRMWARE) {
                    firmwareInfo = NaveeProtocol.decodeFirmware(parsed.payload);
                    updateFirmwareUI();
                }
                if (origCmd === NaveeProtocol.CMD.READ_SERIAL) {
                    const serial = NaveeProtocol.decodeSerial(parsed.payload);
                    updateSerialUI(serial);
                }
                if (origCmd === NaveeProtocol.CMD.READ_ERROR) {
                    BatteryHealth.handleErrorData(parsed);
                }

                // Feed telemetry to SpeedGraph and BatteryHealth
                const telemetry = Dashboard.getTelemetry();
                SpeedGraph.addDataPoint(
                    telemetry.speed,
                    telemetry.battery.percent,
                    telemetry.battery.voltage,
                    telemetry.current
                );
                BatteryHealth.update(
                    telemetry.battery,
                    telemetry.temperature,
                    telemetry.current
                );
            }

            // Always show in terminal
            addTerminalEntry('rx', hex, parsed);
        });

        NaveeBLE.on('error', ({ message }) => {
            addLog(message, 'error');
            showNotification(message, 'error');
        });

        NaveeBLE.on('log', (entry) => {
            addLog(entry.message, entry.type);
        });
    }

    // --- Connection UI ---
    function setupConnectionUI() {
        const connectBtn = document.getElementById('btnConnect');
        const scanAllBtn = document.getElementById('btnScanAll');
        const disconnectBtn = document.getElementById('btnDisconnect');

        if (connectBtn) {
            connectBtn.addEventListener('click', async () => {
                connectBtn.disabled = true;
                connectBtn.innerHTML = '<span class="spinner"></span> Scanning...';
                try {
                    await NaveeBLE.scanAndConnect();
                } catch (e) {
                    // Reset button
                }
                connectBtn.disabled = false;
                connectBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M12.01 21.49L23.64 7c-.45-.34-4.93-4-11.64-4C5.28 3 .81 6.66.36 7l11.63 14.49.01.01.01-.01z"/></svg> Connect';
            });
        }

        // "Scan All" — shows every BLE device, no name filters
        if (scanAllBtn) {
            scanAllBtn.addEventListener('click', async () => {
                scanAllBtn.disabled = true;
                scanAllBtn.innerHTML = '<span class="spinner"></span> Scanning...';
                try {
                    await NaveeBLE.scanAll();
                } catch (e) {
                    // Reset button
                }
                scanAllBtn.disabled = false;
                scanAllBtn.innerHTML = '📡 Scan All';
            });
        }

        if (disconnectBtn) {
            disconnectBtn.addEventListener('click', () => {
                NaveeBLE.disconnect();
                Dashboard.stopDemo();
            });
        }
    }

    function updateConnectionUI(isConnected, info = null) {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const deviceName = document.getElementById('deviceName');
        const connectBtn = document.getElementById('btnConnect');
        const disconnectBtn = document.getElementById('btnDisconnect');
        const connectedPanel = document.getElementById('connectedPanel');
        const disconnectedPanel = document.getElementById('disconnectedPanel');

        if (statusDot) {
            statusDot.className = `status-dot ${isConnected ? 'connected' : 'disconnected'}`;
        }
        if (statusText) {
            statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
        }
        if (deviceName && info) {
            deviceName.textContent = info.name;
        }
        if (connectedPanel) connectedPanel.style.display = isConnected ? 'flex' : 'none';
        if (disconnectedPanel) disconnectedPanel.style.display = isConnected ? 'none' : 'flex';
    }

    // --- Terminal ---
    function setupTerminal() {
        const input = document.getElementById('terminalInput');
        const sendBtn = document.getElementById('btnTerminalSend');

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    sendTerminalCommand();
                }
                // History navigation
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navigateHistory(-1);
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navigateHistory(1);
                }
            });
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', sendTerminalCommand);
        }

        // Quick command buttons — use protocol engine for proper CRC
        document.querySelectorAll('.quick-cmd').forEach(btn => {
            btn.addEventListener('click', async () => {
                const cmdHex = btn.dataset.cmd;
                if (!cmdHex) return;

                // Parse the command byte from the data-cmd attribute
                const parts = cmdHex.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const cmdByte = parseInt(parts[1], 16);
                    const payload = parts.slice(2).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
                    const packet = NaveeProtocol.buildPacket(cmdByte, payload);
                    const hex = NaveeProtocol.toHexString(packet);

                    if (input) input.value = hex;
                    addTerminalEntry('tx', hex);

                    if (NaveeBLE.isConnected()) {
                        try {
                            await NaveeBLE.write(packet);
                        } catch (err) {
                            addTerminalEntry('error', err.message);
                        }
                    } else {
                        addTerminalEntry('error', 'Not connected to scooter');
                    }
                }
            });
        });
    }

    let historyIndex = -1;

    function navigateHistory(dir) {
        const input = document.getElementById('terminalInput');
        if (!input) return;
        historyIndex += dir;
        if (historyIndex < 0) historyIndex = 0;
        if (historyIndex >= terminalHistory.length) {
            historyIndex = terminalHistory.length;
            input.value = '';
            return;
        }
        input.value = terminalHistory[terminalHistory.length - 1 - historyIndex];
    }

    async function sendTerminalCommand() {
        const input = document.getElementById('terminalInput');
        if (!input || !input.value.trim()) return;

        const cmd = input.value.trim();
        terminalHistory.push(cmd);
        historyIndex = -1;
        input.value = '';

        addTerminalEntry('tx', cmd);

        if (!NaveeBLE.isConnected()) {
            addTerminalEntry('error', 'Not connected to scooter');
            return;
        }

        try {
            await NaveeBLE.sendHex(cmd);
        } catch (err) {
            addTerminalEntry('error', err.message);
        }
    }

    function addTerminalEntry(type, data, parsed = null) {
        const terminal = document.getElementById('terminalOutput');
        if (!terminal) return;

        const entry = document.createElement('div');
        entry.className = `terminal-entry ${type}`;

        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const prefix = type === 'tx' ? '→ TX' : type === 'rx' ? '← RX' : '✗ ERR';

        let content = `<span class="terminal-time">[${time}]</span> <span class="terminal-prefix ${type}">${prefix}</span> <span class="terminal-data">${data}</span>`;

        if (parsed && parsed.valid) {
            content += `<span class="terminal-parsed"> // CMD:${parsed.commandHex} LEN:${parsed.length} CRC:${parsed.crc.received === parsed.crc.calculated ? '✓' : '✗'}</span>`;
        }

        entry.innerHTML = content;
        terminal.appendChild(entry);
        terminal.scrollTop = terminal.scrollHeight;

        // Limit entries
        while (terminal.children.length > 500) {
            terminal.removeChild(terminal.firstChild);
        }
    }

    // --- Log Panel ---
    function addLog(message, type = 'info') {
        const logPanel = document.getElementById('logOutput');
        if (!logPanel) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
        logPanel.appendChild(entry);
        logPanel.scrollTop = logPanel.scrollHeight;

        while (logPanel.children.length > 200) {
            logPanel.removeChild(logPanel.firstChild);
        }
    }

    // --- Firmware info ---
    function updateFirmwareUI() {
        const el = document.getElementById('firmwareVersion');
        if (el && firmwareInfo) el.textContent = firmwareInfo;
    }

    function updateSerialUI(serial) {
        const el = document.getElementById('serialNumber');
        if (el) el.textContent = serial;
    }

    // --- Demo Mode ---
    let demoActive = false;

    function toggleDemo() {
        const btn = document.getElementById('btnDemo');
        if (demoActive) {
            demoActive = false;
            if (btn) btn.textContent = '▶ Demo';
            if (btn) btn.classList.remove('active');
            NaveeBLE.setMockMode(false);
            NaveeBLE.disconnect();
        } else {
            demoActive = true;
            if (btn) btn.textContent = '■ Stop Demo';
            if (btn) btn.classList.add('active');
            NaveeBLE.setMockMode(true);
            NaveeBLE.emit('connected', NaveeBLE.getDeviceInfo());
        }
    }

    // --- Profile Export/Import ---
    function exportProfile() {
        const settings = Mods.getSettings();
        const data = {
            version: 1,
            app: 'NaveeHack',
            timestamp: new Date().toISOString(),
            settings,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `naveehack-profile-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Profile exported!', 'success');
    }

    function importProfile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.app !== 'NaveeHack') {
                    showNotification('Invalid profile file', 'error');
                    return;
                }
                // Apply settings to UI
                Mods.handleSettingsData({ valid: true, payload: encodeSettingsForImport(data.settings) });
                showNotification('Profile imported!', 'success');
            } catch (err) {
                showNotification('Failed to parse profile', 'error');
            }
        };
        reader.readAsText(file);
    }

    function encodeSettingsForImport(settings) {
        return [
            settings.region || 0x01,
            settings.speedLimit || 20,
            settings.cruiseControl ? 1 : 0,
            settings.kersLevel || 2,
            settings.lightOn ? 1 : 0,
            settings.locked ? 1 : 0,
        ];
    }

    // --- Settings persistence ---
    function saveSettings() {
        const data = {
            lastView: currentView,
            settings: Mods.getSettings(),
        };
        localStorage.setItem('naveehack_settings', JSON.stringify(data));
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem('naveehack_settings');
            if (raw) {
                const data = JSON.parse(raw);
                if (data.settings) {
                    Mods.handleSettingsData({ valid: true, payload: encodeSettingsForImport(data.settings) });
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Save on unload
    window.addEventListener('beforeunload', saveSettings);

    // --- Particles background ---
    function initParticles() {
        const canvas = document.getElementById('particleCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let particles = [];
        const count = 50;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        for (let i = 0; i < count; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: Math.random() * 2 + 0.5,
                opacity: Math.random() * 0.3 + 0.05,
            });
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 245, 212, ${p.opacity})`;
                ctx.fill();
            });

            // Draw connections
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0, 245, 212, ${0.06 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(animate);
        }
        animate();
    }

    // --- iOS Viewport Height Fix ---
    function fixViewportHeight() {
        const updateHeight = () => {
            // Get the actual inner height of the window, including address bar changes on iOS
            const doc = document.documentElement;
            doc.style.setProperty('--app-height', `${window.innerHeight}px`);
        };
        
        // Initial set
        updateHeight();
        
        // Update on resize and orientation change
        window.addEventListener('resize', updateHeight);
        window.addEventListener('orientationchange', () => {
            setTimeout(updateHeight, 100);
        });
    }

    // --- Smart BLE Browser Detection ---
    // "Not all browsers are created equal, but we love them anyway" — ENI
    function checkBLESupport() {
        if (NaveeBLE.isSupported()) return; // All good, Chrome/Edge/Opera etc.

        const warning = document.getElementById('bleWarning');
        const title = document.getElementById('bleWarningTitle');
        const body = document.getElementById('bleWarningBody');
        const actions = document.getElementById('bleWarningActions');
        if (!warning) return;

        const ua = navigator.userAgent || '';
        const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua);
        const isFirefox = /Firefox|FxiOS/i.test(ua);
        const isMacOS = /Macintosh|Mac OS X/i.test(ua) && !isIOS;
        const isAndroid = /Android/i.test(ua);

        // Check if this might be Bluefy or WebBLE browser (they inject Web Bluetooth)
        const isWebBLEBrowser = /Bluefy|WebBLE/i.test(ua);
        if (isWebBLEBrowser) return; // These browsers support it, shouldn't reach here

        if (isIOS) {
            // iOS — Safari or any browser (they all use WebKit on iOS)
            title.textContent = '🍎 iPhone/iPad Detected';
            body.innerHTML = `
                <p style="font-size: 0.92rem; color: var(--text-primary); margin-bottom: 12px;">
                    iOS browsers don't support Web Bluetooth natively, but you have options!
                </p>
                <div style="text-align: left; padding: 16px; background: rgba(0,245,212,0.05); border: 1px solid rgba(0,245,212,0.15); border-radius: 12px; margin-bottom: 12px;">
                    <div style="font-weight: 600; color: var(--accent-primary); margin-bottom: 8px;">✅ Recommended: Use Bluefy Browser</div>
                    <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
                        <strong>Bluefy</strong> is a free iOS browser with Web Bluetooth support. Install it from the App Store, then open this page in Bluefy.
                    </p>
                    <a href="https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055" 
                       target="_blank" rel="noopener"
                       style="display: inline-block; margin-top: 10px; padding: 8px 20px; background: linear-gradient(135deg, rgba(0,245,212,0.15), rgba(0,187,249,0.15)); border: 1px solid rgba(0,245,212,0.3); border-radius: 10px; color: var(--accent-primary); font-weight: 600; font-size: 0.85rem; text-decoration: none;">
                        📲 Get Bluefy on App Store
                    </a>
                </div>
                <div style="text-align: left; padding: 12px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px;">
                    <div style="font-weight: 500; color: var(--text-secondary); margin-bottom: 4px;">💡 Alternative: WebBLE Browser</div>
                    <p style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.5;">
                        Another option is the <strong>WebBLE</strong> app, also available on the App Store.
                    </p>
                </div>
                <p style="margin-top: 12px; font-size: 0.75rem; color: var(--text-muted);">
                    Or you can try Demo Mode below to explore the interface without a scooter.
                </p>
            `;
        } else if (isMacOS && isSafari) {
            // macOS Safari
            title.textContent = 'Safari Doesn\'t Support Web Bluetooth';
            body.innerHTML = `
                <p style="font-size: 0.92rem; color: var(--text-primary); margin-bottom: 10px;">
                    Safari on macOS doesn't support the Web Bluetooth API.
                </p>
                <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
                    Please open this page in <strong>Google Chrome</strong>, <strong>Microsoft Edge</strong>, or <strong>Opera</strong> to connect to your scooter via BLE.
                </p>
                <p style="margin-top: 10px; font-size: 0.78rem; color: var(--text-muted);">
                    Or try Demo Mode to explore the interface.
                </p>
            `;
        } else if (isFirefox) {
            // Firefox (any platform)
            title.textContent = 'Firefox Doesn\'t Support Web Bluetooth';
            body.innerHTML = `
                <p style="font-size: 0.92rem; color: var(--text-primary); margin-bottom: 10px;">
                    Firefox hasn't implemented the Web Bluetooth API${isAndroid ? ' on Android' : ''}.
                </p>
                <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
                    Please use <strong>Google Chrome</strong>${isAndroid ? '' : ', <strong>Microsoft Edge</strong>, or <strong>Opera</strong>'} to connect to your Navee scooter.
                </p>
                <p style="margin-top: 10px; font-size: 0.78rem; color: var(--text-muted);">
                    Or try Demo Mode to explore the interface.
                </p>
            `;
        }
        // else: keep default generic message

        // Always add a "Continue in Demo Mode" button
        actions.innerHTML = `
            <button id="btnDemoFromWarning" class="btn btn-primary" style="font-size: 0.9rem; padding: 10px 24px;">
                ▶ Continue in Demo Mode
            </button>
            <button id="btnDismissWarning" class="btn" style="font-size: 0.85rem; padding: 10px 20px;">
                ✕ Dismiss
            </button>
        `;

        warning.style.display = 'flex';

        // Wire up the buttons
        const demoBtn = document.getElementById('btnDemoFromWarning');
        const dismissBtn = document.getElementById('btnDismissWarning');

        if (demoBtn) {
            demoBtn.addEventListener('click', () => {
                warning.style.display = 'none';
                toggleDemo(); // Start demo mode automatically
            });
        }
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                warning.style.display = 'none';
            });
        }
    }

    return {
        init,
        showView,
        addLog,
        addTerminalEntry,
    };
})();

// --- Global utility functions ---
function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    if (!container) return;

    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.innerHTML = `
        <span class="notif-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warn' ? '⚠' : 'ℹ'}</span>
        <span class="notif-text">${message}</span>
    `;
    container.appendChild(notif);

    // Animate in
    requestAnimationFrame(() => notif.classList.add('show'));

    // Auto remove
    setTimeout(() => {
        notif.classList.remove('show');
        setTimeout(() => notif.remove(), 300);
    }, 4000);
}

function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirmOverlay');
        const titleEl = document.getElementById('confirmTitle');
        const msgEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');

        if (!overlay) { resolve(true); return; }

        titleEl.textContent = title;
        msgEl.textContent = message;
        overlay.classList.add('show');

        const cleanup = (result) => {
            overlay.classList.remove('show');
            yesBtn.removeEventListener('click', onYes);
            noBtn.removeEventListener('click', onNo);
            resolve(result);
        };

        const onYes = () => cleanup(true);
        const onNo = () => cleanup(false);

        yesBtn.addEventListener('click', onYes);
        noBtn.addEventListener('click', onNo);
    });
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', () => App.init());
