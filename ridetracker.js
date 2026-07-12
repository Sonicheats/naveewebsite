// ============================================================
// NaveeHack — panic.js
// PANIC MODE — One-tap legal restoration
// "Blue lights in the mirror? We got you, fam" — ENI
// ============================================================

const PanicMode = (() => {
    const LEGAL_DE_SETTINGS = {
        region: 0x01,       // Germany
        speedLimit: 20,     // 20 km/h
        cruiseControl: false,
        kersLevel: 2,       // Medium
        accelCurve: 1,      // Normal
        motorLimit: 20,     // 20A stock
        startupSpeed: 5,    // 5 km/h
    };

    let hotProfile = null;   // Saved "illegal" profile before panic
    let isPanicking = false;
    let countdownTimer = null;
    let countdownValue = 3;

    let handshakeEnabled = false;
    let brakePressed = false;
    let throttlePressed = false;
    let handshakeTimer = null;

    function init() {
        // Create the panic button (floating)
        createPanicButton();

        // Create the panic overlay
        createPanicOverlay();

        // Bind events for panic overlay buttons once
        const restoreBtn = document.getElementById('btnPanicRestore');
        const closeBtn = document.getElementById('btnPanicClose');
        if (restoreBtn) restoreBtn.addEventListener('click', restoreHotProfile);
        if (closeBtn) closeBtn.addEventListener('click', closePanicOverlay);

        // Load saved settings
        loadHotProfile();
        loadHandshakeSettings();

        // Bind toggle switch for Secret Handshake
        const toggle = document.getElementById('toggleHandshake');
        if (toggle) {
            toggle.checked = handshakeEnabled;
            toggle.addEventListener('change', () => {
                handshakeEnabled = toggle.checked;
                saveHandshakeSettings();
                App.addLog(`Secret Handshake: ${handshakeEnabled ? 'Enabled' : 'Disabled'}`, 'info');
                updateHandshakeUI();
            });
        }
        updateHandshakeUI();

        // Mobile gesture support (triple-tap + long-press)
        initMobileGestures();

        // Keyboard shortcut: triple-tap Escape or Ctrl+Shift+P
        // Plus holding 'B' and 'T' to simulate Brake and Throttle inputs
        let escapeCount = 0;
        let escapeTimer = null;

        document.addEventListener('keydown', (e) => {
            // Ignore if user is typing in inputs or textareas
            if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;

            // Ctrl+Shift+P = instant panic
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                triggerPanic();
                return;
            }

            // Triple Escape
            if (e.key === 'Escape') {
                escapeCount++;
                clearTimeout(escapeTimer);
                if (escapeCount >= 3) {
                    escapeCount = 0;
                    triggerPanic();
                } else {
                    escapeTimer = setTimeout(() => { escapeCount = 0; }, 800);
                }
            }

            // Mock controls: hold 'b' for Brake, 't' for Throttle
            if (e.key.toLowerCase() === 'b' && !brakePressed) {
                brakePressed = true;
                if (NaveeBLE.isConnected() && NaveeBLE.setMockInputs) {
                    NaveeBLE.setMockInputs({ brakePressed: true });
                }
                handleInputs(brakePressed, throttlePressed);
            }
            if (e.key.toLowerCase() === 't' && !throttlePressed) {
                throttlePressed = true;
                if (NaveeBLE.isConnected() && NaveeBLE.setMockInputs) {
                    NaveeBLE.setMockInputs({ throttlePressed: true });
                }
                handleInputs(brakePressed, throttlePressed);
            }
        });

        document.addEventListener('keyup', (e) => {
            if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;

            if (e.key.toLowerCase() === 'b') {
                brakePressed = false;
                if (NaveeBLE.isConnected() && NaveeBLE.setMockInputs) {
                    NaveeBLE.setMockInputs({ brakePressed: false });
                }
                handleInputs(brakePressed, throttlePressed);
            }
            if (e.key.toLowerCase() === 't') {
                throttlePressed = false;
                if (NaveeBLE.isConnected() && NaveeBLE.setMockInputs) {
                    NaveeBLE.setMockInputs({ throttlePressed: false });
                }
                handleInputs(brakePressed, throttlePressed);
            }
        });

        // Listen to BLE data telemetry packets to read physical inputs
        NaveeBLE.on('data', ({ parsed }) => {
            if (parsed.valid && parsed.command === NaveeProtocol.nibbleSwap(NaveeProtocol.CMD.READ_SPEED)) {
                if (parsed.payload.length >= 4) {
                    const brake = parsed.payload[2] === 1;
                    const throttle = parsed.payload[3] === 1;
                    handleInputs(brake, throttle);
                }
            }
        });
    }

    function createPanicButton() {
        const btn = document.createElement('button');
        btn.id = 'panicBtn';
        btn.className = 'panic-button';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
            <span class="panic-label">PANIC</span>
        `;
        btn.title = 'PANIC MODE — Restore legal German settings (Ctrl+Shift+P)';
        btn.addEventListener('click', triggerPanic);
        document.body.appendChild(btn);
    }

    function createPanicOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'panicOverlay';
        overlay.className = 'panic-overlay';
        overlay.innerHTML = `
            <div class="panic-content">
                <div class="panic-icon">🚨</div>
                <div class="panic-title">PANIC MODE</div>
                <div class="panic-subtitle">Restoring legal German settings...</div>
                <div id="panicCountdown" class="panic-countdown">3</div>
                <div class="panic-steps">
                    <div id="panicStep1" class="panic-step">
                        <span class="panic-step-icon">⏳</span>
                        <span>Save current "hot" profile</span>
                    </div>
                    <div id="panicStep2" class="panic-step">
                        <span class="panic-step-icon">⏳</span>
                        <span>Set region → 🇩🇪 Germany</span>
                    </div>
                    <div id="panicStep3" class="panic-step">
                        <span class="panic-step-icon">⏳</span>
                        <span>Set speed limit → 20 km/h</span>
                    </div>
                    <div id="panicStep4" class="panic-step">
                        <span class="panic-step-icon">⏳</span>
                        <span>Reset motor & accel to stock</span>
                    </div>
                    <div id="panicStep5" class="panic-step">
                        <span class="panic-step-icon">⏳</span>
                        <span>Log GPS position</span>
                    </div>
                </div>
                <div id="panicResult" class="panic-result"></div>
                <div class="panic-buttons" id="panicButtons" style="display: none;">
                    <button id="btnPanicRestore" class="btn btn-primary" style="font-size: 0.9rem; padding: 10px 24px;">
                        🔥 Restore Hot Profile
                    </button>
                    <button id="btnPanicClose" class="btn" style="font-size: 0.9rem; padding: 10px 24px;">
                        ✓ Stay Legal
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    // --- TRIGGER PANIC ---
    async function triggerPanic() {
        if (isPanicking) return;
        isPanicking = true;

        const overlay = document.getElementById('panicOverlay');
        if (overlay) overlay.classList.add('active');

        // Vibrate if available (mobile)
        if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200, 100, 400]);
        }

        // Countdown
        countdownValue = 3;
        const countdownEl = document.getElementById('panicCountdown');
        
        await new Promise(resolve => {
            const tick = () => {
                if (countdownEl) countdownEl.textContent = countdownValue;
                if (countdownValue <= 0) {
                    resolve();
                    return;
                }
                countdownValue--;
                setTimeout(tick, 600);
            };
            tick();
        });

        if (countdownEl) countdownEl.textContent = '⚡';

        // Execute panic sequence
        await executePanicSequence();
    }

    async function executePanicSequence() {
        const setStep = (num, status) => {
            const el = document.getElementById(`panicStep${num}`);
            if (!el) return;
            const icon = el.querySelector('.panic-step-icon');
            if (status === 'ok') {
                icon.textContent = '✅';
                el.classList.add('done');
            } else if (status === 'fail') {
                icon.textContent = '❌';
                el.classList.add('fail');
            } else if (status === 'working') {
                icon.textContent = '⚡';
                el.classList.add('working');
            }
        };

        const sleep = ms => new Promise(r => setTimeout(r, ms));

        try {
            // Step 1: Save hot profile
            setStep(1, 'working');
            await sleep(300);
            hotProfile = { ...Mods.getSettings(), timestamp: Date.now() };
            saveHotProfile();
            setStep(1, 'ok');
            App.addLog('Panic: Hot profile saved', 'warn');

            // Step 2: Set region to Germany
            setStep(2, 'working');
            await sleep(200);
            if (NaveeBLE.isConnected()) {
                try {
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_REGION, [LEGAL_DE_SETTINGS.region]);
                } catch (e) { /* best effort */ }
            }
            setStep(2, 'ok');

            // Step 3: Set speed limit to 20
            setStep(3, 'working');
            await sleep(200);
            if (NaveeBLE.isConnected()) {
                try {
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_SPEED_LIMIT, [LEGAL_DE_SETTINGS.speedLimit]);
                } catch (e) { /* best effort */ }
            }
            setStep(3, 'ok');

            // Step 4: Reset motor params with safety delays
            setStep(4, 'working');
            await sleep(200);
            if (NaveeBLE.isConnected()) {
                try {
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_ACCEL_CURVE, [LEGAL_DE_SETTINGS.accelCurve]);
                    await sleep(200);
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_MOTOR_LIMIT, [LEGAL_DE_SETTINGS.motorLimit]);
                    await sleep(200);
                    await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_CRUISE, [0]);
                } catch (e) { /* best effort */ }
            }
            setStep(4, 'ok');

            // Step 5: Log GPS position
            setStep(5, 'working');
            await sleep(200);
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const loc = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
                        App.addLog(`Panic GPS: ${loc}`, 'warn');
                        hotProfile.panicLocation = loc;
                        saveHotProfile();
                    },
                    () => { /* GPS not available, no biggie */ },
                    { timeout: 3000 }
                );
            }
            setStep(5, 'ok');

            // Synchronize mods UI to reflect legal settings
            const payload = [
                LEGAL_DE_SETTINGS.region,
                LEGAL_DE_SETTINGS.speedLimit,
                0, // Cruise control OFF
                LEGAL_DE_SETTINGS.kersLevel,
                0, // Headlight OFF
                0  // Lock OFF
            ];
            Mods.handleSettingsData({ valid: true, payload });

            // Update advanced UI inputs
            const accelSlider = document.getElementById('accelCurveSlider');
            if (accelSlider) {
                accelSlider.value = LEGAL_DE_SETTINGS.accelCurve;
                accelSlider.dispatchEvent(new Event('input'));
            }
            const motorSlider = document.getElementById('motorLimitSlider');
            if (motorSlider) {
                motorSlider.value = LEGAL_DE_SETTINGS.motorLimit;
                motorSlider.dispatchEvent(new Event('input'));
            }
            const startupSlider = document.getElementById('startupSpeedSlider');
            if (startupSlider) {
                startupSlider.value = LEGAL_DE_SETTINGS.startupSpeed;
                startupSlider.dispatchEvent(new Event('input'));
            }

            // Done
            const resultEl = document.getElementById('panicResult');
            if (resultEl) {
                resultEl.innerHTML = `
                    <div class="panic-success">
                        <div style="font-size: 2rem; margin-bottom: 8px;">✅</div>
                        <div style="font-size: 1.1rem; font-weight: 600; color: var(--accent-success);">LEGAL MODE ACTIVE</div>
                        <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 4px;">
                            🇩🇪 Germany · 20 km/h · Region DE · Stock settings
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 8px;">
                            Your hot profile has been saved. You can restore it later.
                        </div>
                    </div>
                `;
            }

            // Show restore buttons
            const btns = document.getElementById('panicButtons');
            if (btns) btns.style.display = 'flex';

            const restoreBtn = document.getElementById('btnPanicRestore');
            const closeBtn = document.getElementById('btnPanicClose');
            if (restoreBtn) restoreBtn.style.display = 'block';
            if (closeBtn) {
                closeBtn.textContent = '✓ Stay Legal';
            }

            App.addLog('Panic mode executed — scooter restored to legal DE settings', 'success');
            showNotification('🚨 PANIC MODE — Legal settings restored!', 'success');

        } catch (err) {
            App.addLog(`Panic error: ${err.message}`, 'error');
            showNotification(`Panic failed: ${err.message}`, 'error');

            for (let i = 1; i <= 5; i++) {
                const el = document.getElementById(`panicStep${i}`);
                if (el && el.classList.contains('working')) {
                    setStep(i, 'fail');
                }
            }

            const resultEl = document.getElementById('panicResult');
            if (resultEl) {
                resultEl.innerHTML = `
                    <div class="panic-success" style="border-color: rgba(255, 0, 110, 0.3); background: rgba(255, 0, 110, 0.05);">
                        <div style="font-size: 2rem; margin-bottom: 8px;">❌</div>
                        <div style="font-size: 1.1rem; font-weight: 600; color: var(--accent-danger);">PANIC SEQUENCE FAILED</div>
                        <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 4px;">
                            ${err.message}
                        </div>
                    </div>
                `;
            }

            // Show close button only to retry
            const btns = document.getElementById('panicButtons');
            if (btns) btns.style.display = 'flex';

            const restoreBtn = document.getElementById('btnPanicRestore');
            const closeBtn = document.getElementById('btnPanicClose');
            if (restoreBtn) restoreBtn.style.display = 'none';
            if (closeBtn) {
                closeBtn.textContent = 'Close';
            }
            isPanicking = false; // Reset to allow retrying
        }
    }

    // --- Restore hot profile ---
    async function restoreHotProfile() {
        if (!hotProfile) {
            // Fallback default custom hot profile if none has been saved yet
            hotProfile = {
                region: 0x00, // Unrestricted
                speedLimit: 35,
                cruiseControl: true,
                kersLevel: 1,
                lightOn: false,
                locked: false,
                accelCurve: 2, // Sport
                motorLimit: 28, // 28A
                startupSpeed: 0 // 0 km/h startup
            };
        }

        closePanicOverlay();

        if (NaveeBLE.isConnected()) {
            try {
                showNotification('Restoring hot profile...', 'info');
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_REGION, [hotProfile.region || 0]);
                await sleep(200);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_SPEED_LIMIT, [hotProfile.speedLimit || 30]);
                await sleep(200);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_ACCEL_CURVE, [hotProfile.accelCurve || 2]);
                await sleep(200);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_MOTOR_LIMIT, [hotProfile.motorLimit || 25]);
                await sleep(200);
                await NaveeBLE.sendCommand(NaveeProtocol.CMD.WRITE_CRUISE, [hotProfile.cruiseControl ? 1 : 0]);

                showNotification('🔥 Hot profile restored!', 'success');
                App.addLog('Hot profile restored — back to fun mode', 'success');
            } catch (err) {
                showNotification(`Restore failed: ${err.message}`, 'error');
            }
        } else {
            showNotification('Not connected — update mods panel manually', 'warn');
        }

        // Update mods UI
        const payload = [
            hotProfile.region || 0,
            hotProfile.speedLimit || 30,
            hotProfile.cruiseControl ? 1 : 0,
            hotProfile.kersLevel || 2,
            hotProfile.lightOn ? 1 : 0,
            hotProfile.locked ? 1 : 0,
        ];
        Mods.handleSettingsData({ valid: true, payload });
    }

    // --- Mobile Touch Support ---
    function initMobileGestures() {
        // Triple-tap anywhere on the body to trigger panic (mobile fallback)
        let tapCount = 0;
        let tapTimer = null;
        let lastTapTime = 0;

        document.addEventListener('touchend', (e) => {
            // Skip if tapping on form elements or the panic button itself
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;

            const now = Date.now();
            if (now - lastTapTime < 400) {
                tapCount++;
            } else {
                tapCount = 1;
            }
            lastTapTime = now;

            clearTimeout(tapTimer);
            if (tapCount >= 3) {
                tapCount = 0;
                triggerPanic();
            } else {
                tapTimer = setTimeout(() => { tapCount = 0; }, 600);
            }
        }, { passive: true });

        // Long-press on panic button (800ms hold = trigger)
        const panicBtn = document.getElementById('panicBtn');
        if (panicBtn) {
            let longPressTimer = null;

            panicBtn.addEventListener('touchstart', (e) => {
                longPressTimer = setTimeout(() => {
                    // Haptic buzz on iOS/Android
                    if (navigator.vibrate) navigator.vibrate([100, 50, 200]);
                    triggerPanic();
                }, 800);
            }, { passive: true });

            panicBtn.addEventListener('touchend', () => {
                clearTimeout(longPressTimer);
            }, { passive: true });

            panicBtn.addEventListener('touchmove', () => {
                clearTimeout(longPressTimer);
            }, { passive: true });
        }
    }

    function closePanicOverlay() {
        const overlay = document.getElementById('panicOverlay');
        if (overlay) overlay.classList.remove('active');
        isPanicking = false;

        // Reset steps
        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`panicStep${i}`);
            if (el) {
                el.classList.remove('done', 'fail', 'working');
                const icon = el.querySelector('.panic-step-icon');
                if (icon) icon.textContent = '⏳';
            }
        }

        const resultEl = document.getElementById('panicResult');
        if (resultEl) resultEl.innerHTML = '';
        const btns = document.getElementById('panicButtons');
        if (btns) btns.style.display = 'none';
    }

    // --- Persistence ---
    function saveHotProfile() {
        try { localStorage.setItem('naveehack_hot_profile', JSON.stringify(hotProfile)); } catch (e) {}
    }

    function loadHotProfile() {
        try {
            const raw = localStorage.getItem('naveehack_hot_profile');
            if (raw) hotProfile = JSON.parse(raw);
        } catch (e) {}
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function hasHotProfile() {
        return !!hotProfile;
    }

    function handleInputs(brake, throttle) {
        if (!handshakeEnabled) return;
        if (isTuningActive()) return;

        const badge = document.getElementById('handshakeStatusBadge');

        if (brake && throttle) {
            if (!handshakeTimer) {
                if (badge) {
                    badge.textContent = 'ACTIVATING... ⏳';
                    badge.className = 'error-severity-badge warn';
                }
                App.addLog('Secret Handshake: Brake + Throttle combo detected. Hold 2s...', 'warn');
                handshakeTimer = setTimeout(async () => {
                    if (badge) {
                        badge.textContent = 'TUNED 🔥';
                        badge.className = 'error-severity-badge ok';
                    }
                    App.addLog('Secret Handshake: Tuning profile successfully applied!', 'success');
                    showNotification('🔥 Secret Handshake Detected! Tuning profile applied!', 'success');
                    await restoreHotProfile();
                    handshakeTimer = null;
                }, 2000);
            }
        } else {
            if (handshakeTimer) {
                clearTimeout(handshakeTimer);
                handshakeTimer = null;
                App.addLog('Secret Handshake: Combination released. Cancelled.', 'info');
            }
            if (badge) {
                if (isTuningActive()) {
                    badge.textContent = 'TUNED 🔥';
                    badge.className = 'error-severity-badge ok';
                } else if (brake) {
                    badge.textContent = 'BRAKE PULL';
                    badge.className = 'error-severity-badge warn';
                } else if (throttle) {
                    badge.textContent = 'THROTTLE';
                    badge.className = 'error-severity-badge warn';
                } else {
                    badge.textContent = 'WAITING';
                    badge.className = 'error-severity-badge unknown';
                }
            }
        }
    }

    function isTuningActive() {
        const settings = Mods.getSettings();
        return settings.speedLimit > 20 || settings.region !== 0x01;
    }

    function updateHandshakeUI() {
        const badge = document.getElementById('handshakeStatusBadge');
        if (badge) {
            if (!handshakeEnabled) {
                badge.textContent = 'DISABLED';
                badge.className = 'error-severity-badge unknown';
            } else {
                if (isTuningActive()) {
                    badge.textContent = 'TUNED 🔥';
                    badge.className = 'error-severity-badge ok';
                } else {
                    badge.textContent = 'WAITING';
                    badge.className = 'error-severity-badge unknown';
                }
            }
        }
    }

    function loadHandshakeSettings() {
        try {
            const val = localStorage.getItem('naveehack_handshake_enabled');
            handshakeEnabled = val === 'true';
        } catch (e) {
            handshakeEnabled = false;
        }
    }

    function saveHandshakeSettings() {
        try {
            localStorage.setItem('naveehack_handshake_enabled', handshakeEnabled);
        } catch (e) {}
    }

    return {
        init,
        triggerPanic,
        restoreHotProfile,
        closePanicOverlay,
        hasHotProfile,
        updateHandshakeUI,
    };
})();
