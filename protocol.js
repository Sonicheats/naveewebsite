// ============================================================
// NaveeHack — mods.js  
// Modification Panel — Where the magic happens
// "Speed limits are just suggestions stored in EEPROM" — ENI
// ============================================================

const Mods = (() => {

    let currentSettings = {
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

    // --- Initialize the mods panel UI ---
    function init() {
        setupSpeedSlider();
        setupRegionSelector();
        setupToggles();
        setupKersSlider();
        setupAdvanced();
    }

    // --- Speed Limit Slider ---
    function setupSpeedSlider() {
        const slider = document.getElementById('speedLimitSlider');
        const display = document.getElementById('speedLimitValue');
        const presets = document.querySelectorAll('.speed-preset');

        if (slider) {
            slider.addEventListener('input', () => {
                const val = parseInt(slider.value);
                if (display) display.textContent = val === 0 ? '∞' : `${val}`;
                currentSettings.speedLimit = val;
                updateSliderTrack(slider);
            });

            updateSliderTrack(slider);
        }

        presets.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = parseInt(btn.dataset.speed);
                if (slider) {
                    slider.value = val;
                    slider.dispatchEvent(new Event('input'));
                }
                presets.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    function updateSliderTrack(slider) {
        const min = parseInt(slider.min);
        const max = parseInt(slider.max);
        const val = parseInt(slider.value);
        const pct = ((val - min) / (max - min)) * 100;
        slider.style.setProperty('--slider-pct', `${pct}%`);
    }

    // --- Region Selector ---
    function setupRegionSelector() {
        const cards = document.querySelectorAll('.region-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const code = parseInt(card.dataset.region);
                currentSettings.region = code;

                cards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');

                // Auto-set speed limit based on region
                const speed = NaveeProtocol.REGION_SPEED_MAP[code] || 0;
                const slider = document.getElementById('speedLimitSlider');
                const display = document.getElementById('speedLimitValue');
                if (slider) {
                    slider.value = speed;
                    slider.dispatchEvent(new Event('input'));
                }

                // Update preset buttons
                document.querySelectorAll('.speed-preset').forEach(b => {
                    b.classList.toggle('active', parseInt(b.dataset.speed) === speed);
                });
            });
        });
    }

    // --- Toggles (Cruise, Light, Lock) ---
    function setupToggles() {
        const toggleMap = {
            'toggleCruise': 'cruiseControl',
            'toggleLight': 'lightOn',
            'toggleLock': 'locked',
        };

        Object.entries(toggleMap).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    currentSettings[key] = el.checked;
                });
            }
        });
    }

    // --- KERS Slider ---
    function setupKersSlider() {
        const slider = document.getElementById('kersSlider');
        const display = document.getElementById('kersValue');
        const labels = ['Off', 'Low', 'Medium', 'High'];

        if (slider) {
            slider.addEventListener('input', () => {
                const val = parseInt(slider.value);
                currentSettings.kersLevel = val;
                if (display) display.textContent = labels[val] || val;
                updateSliderTrack(slider);
            });
            updateSliderTrack(slider);
        }
    }

    // --- Advanced settings ---
    function setupAdvanced() {
        const accelSlider = document.getElementById('accelCurveSlider');
        const accelDisplay = document.getElementById('accelCurveValue');
        const accelLabels = ['Eco', 'Normal', 'Sport', 'Insane'];

        if (accelSlider) {
            accelSlider.addEventListener('input', () => {
                const val = parseInt(accelSlider.value);
                currentSettings.accelCurve = val;
                if (accelDisplay) accelDisplay.textContent = accelLabels[val] || val;
                updateSliderTrack(accelSlider);
            });
            updateSliderTrack(accelSlider);
        }

        const motorSlider = document.getElementById('motorLimitSlider');
        const motorDisplay = document.getElementById('motorLimitValue');

        if (motorSlider) {
            motorSlider.addEventListener('input', () => {
                const val = parseInt(motorSlider.value);
                currentSettings.motorLimit = val;
                if (motorDisplay) motorDisplay.textContent = `${val}A`;
                updateSliderTrack(motorSlider);
            });
            updateSliderTrack(motorSlider);
        }

        const startupSlider = document.getElementById('startupSpeedSlider');
        const startupDisplay = document.getElementById('startupSpeedValue');

        if (startupSlider) {
            startupSlider.addEventListener('input', () => {
                const val = parseInt(startupSlider.value);
                currentSettings.startupSpeed = val;
                if (startupDisplay) startupDisplay.textContent = `${val} km/h`;
                updateSliderTrack(startupSlider);
            });
            updateSliderTrack(startupSlider);
        }
    }

    // --- Apply all modifications to scooter ---
    async function applyAll() {
        if (!NaveeBLE.isConnected()) {
            showNotification('Not connected to scooter!', 'error');
            return;
        }

        const confirmed = await showConfirmDialog(
            'Apply Modifications?',
            `The following changes will be written to your scooter:\n\n` +
            `• Region: ${NaveeProtocol.REGION_NAMES[currentSettings.region] || 'Unknown'}\n` +
            `• Speed Limit: ${currentSettings.speedLimit === 0 ? 'Unrestricted' : currentSettings.speedLimit + ' km/h'}\n` +
            `• Cruise Control: ${currentSettings.cruiseControl ? 'ON' : 'OFF'}\n` +
            `• KERS Level: ${currentSettings.kersLevel}\n` +
            `• Acceleration: Mode ${currentSettings.accelCurve}\n` +
            `• Motor Limit: ${currentSettings.motorLimit}A\n` +
            `• Startup Speed: ${currentSettings.startupSpeed} km/h\n\n` +
            `⚠️ This may void your warranty. Continue?`
        );

        if (!confirmed) return;

        const progressEl = document.getElementById('flashProgress');
        const statusEl = document.getElementById('flashStatus');

        try {
            const steps = [
                { name: 'Setting region...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_REGION, [currentSettings.region]) },
                { name: 'Setting speed limit...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_SPEED_LIMIT, [currentSettings.speedLimit]) },
                { name: 'Setting cruise control...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_CRUISE, [currentSettings.cruiseControl ? 1 : 0]) },
                { name: 'Setting KERS...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_KERS, [currentSettings.kersLevel]) },
                { name: 'Setting acceleration...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_ACCEL_CURVE, [currentSettings.accelCurve]) },
                { name: 'Setting motor limit...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_MOTOR_LIMIT, [currentSettings.motorLimit]) },
                { name: 'Setting startup speed...', fn: () => NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_STARTUP_SPEED, [currentSettings.startupSpeed]) },
            ];

            for (let i = 0; i < steps.length; i++) {
                if (statusEl) statusEl.textContent = steps[i].name;
                if (progressEl) {
                    progressEl.style.width = `${((i + 1) / steps.length) * 100}%`;
                }
                await steps[i].fn();
                await sleep(300); // Delay between writes
            }

            if (statusEl) statusEl.textContent = '✓ All modifications applied!';
            showNotification('Modifications applied successfully!', 'success');

        } catch (err) {
            if (statusEl) statusEl.textContent = `✗ Error: ${err.message}`;
            showNotification(`Failed: ${err.message}`, 'error');
        }
    }

    // --- Apply single setting ---
    async function applySingle(command, value) {
        if (!NaveeBLE.isConnected()) {
            showNotification('Not connected!', 'error');
            return;
        }
        try {
            await NaveeBLE.sendCommand(command, [value]);
            showNotification('Setting applied!', 'success');
        } catch (err) {
            showNotification(`Failed: ${err.message}`, 'error');
        }
    }

    // --- Read current settings from scooter ---
    async function readCurrentSettings() {
        if (!NaveeBLE.isConnected()) return;

        try {
            await NaveeBLE.sendCommand(NaveeProtocol.CMD.READ_SETTINGS);
        } catch (e) {
            console.warn('Failed to read settings:', e);
        }
    }

    // --- Handle incoming settings data ---
    function handleSettingsData(parsed) {
        if (!parsed.valid) return;

        const settings = NaveeProtocol.decodeSettings(parsed.payload);
        if (!settings) return;

        currentSettings = { ...currentSettings, ...settings };

        // Update UI to reflect scooter's current state
        const slider = document.getElementById('speedLimitSlider');
        if (slider) {
            slider.value = settings.speedLimit;
            slider.dispatchEvent(new Event('input'));
        }

        const regionCards = document.querySelectorAll('.region-card');
        regionCards.forEach(c => {
            c.classList.toggle('active', parseInt(c.dataset.region) === settings.region);
        });

        const toggles = {
            'toggleCruise': settings.cruiseControl,
            'toggleLight': settings.lightOn,
            'toggleLock': settings.locked,
        };
        Object.entries(toggles).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.checked = val;
        });

        const kersSlider = document.getElementById('kersSlider');
        if (kersSlider) {
            kersSlider.value = settings.kersLevel;
            kersSlider.dispatchEvent(new Event('input'));
        }

        // Keep the Secret Handshake trigger UI status in sync
        if (window.PanicMode && PanicMode.updateHandshakeUI) {
            PanicMode.updateHandshakeUI();
        }
    }

    function getSettings() {
        return { ...currentSettings };
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    return {
        init,
        applyAll,
        applySingle,
        readCurrentSettings,
        handleSettingsData,
        getSettings,
    };
})();
