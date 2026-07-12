// ============================================================
// NaveeHack — ridetracker.js
// GPS Ride Tracker with GPX Export
// "Every ride deserves a receipt" — ENI
// ============================================================

const RideTracker = (() => {
    let tracking = false;
    let watchId = null;
    let startTime = null;
    let timerInterval = null;
    let trackPoints = [];
    let totalDistance = 0;
    let maxGpsSpeed = 0;
    let rideHistory = [];
    let rideCanvas = null;
    let rideCtx = null;

    function init() {
        rideCanvas = document.getElementById('rideSpeedCanvas');
        if (rideCanvas) {
            rideCtx = rideCanvas.getContext('2d');
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
        }

        const startBtn = document.getElementById('btnRideStart');
        const stopBtn = document.getElementById('btnRideStop');
        const exportBtn = document.getElementById('btnRideExport');
        const clearBtn = document.getElementById('btnRideClearHistory');

        if (startBtn) startBtn.addEventListener('click', startTracking);
        if (stopBtn) stopBtn.addEventListener('click', stopTracking);
        if (exportBtn) exportBtn.addEventListener('click', exportGPX);
        if (clearBtn) clearBtn.addEventListener('click', clearHistory);

        loadHistory();
        renderHistory();
    }

    function resizeCanvas() {
        if (!rideCanvas) return;
        const rect = rideCanvas.parentElement.getBoundingClientRect();
        rideCanvas.width = rect.width || 800;
        rideCanvas.height = 180;
    }

    function startTracking() {
        if (!navigator.geolocation) {
            showNotification('GPS/Geolocation not available in this browser', 'error');
            return;
        }

        tracking = true;
        startTime = Date.now();
        trackPoints = [];
        totalDistance = 0;
        maxGpsSpeed = 0;

        document.getElementById('btnRideStart').style.display = 'none';
        document.getElementById('btnRideStop').style.display = '';

        // Start GPS watch
        watchId = navigator.geolocation.watchPosition(
            onPosition,
            onGpsError,
            {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 10000,
            }
        );

        // Timer update
        timerInterval = setInterval(updateTimer, 1000);

        showNotification('Ride tracking started! 🛴', 'success');
        App.addLog('Ride tracking started', 'success');
    }

    function stopTracking() {
        tracking = false;

        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        document.getElementById('btnRideStart').style.display = '';
        document.getElementById('btnRideStop').style.display = 'none';

        // Save to history
        if (trackPoints.length > 1) {
            const ride = {
                id: Date.now(),
                date: new Date().toISOString(),
                duration: (Date.now() - startTime) / 1000,
                distance: totalDistance,
                maxSpeed: maxGpsSpeed,
                avgSpeed: totalDistance / ((Date.now() - startTime) / 3600000),
                points: trackPoints.length,
            };
            rideHistory.unshift(ride);
            if (rideHistory.length > 20) rideHistory.pop();
            saveHistory();
            renderHistory();
            showNotification(`Ride saved! ${totalDistance.toFixed(2)} km in ${formatDuration(ride.duration)}`, 'success');
        }

        App.addLog('Ride tracking stopped', 'info');
    }

    function onPosition(pos) {
        if (!tracking) return;

        const { latitude, longitude, altitude, accuracy, speed } = pos.coords;
        const timestamp = pos.timestamp;

        // Speed from GPS (m/s → km/h)
        const gpsSpeed = (speed || 0) * 3.6;
        if (gpsSpeed > maxGpsSpeed) maxGpsSpeed = gpsSpeed;

        // Calculate distance from previous point
        if (trackPoints.length > 0) {
            const last = trackPoints[trackPoints.length - 1];
            const dist = haversine(last.lat, last.lng, latitude, longitude);
            // Filter out GPS jitter (ignore movements < 2m with bad accuracy)
            if (dist > 0.002 || accuracy < 10) {
                totalDistance += dist;
            }
        }

        trackPoints.push({
            lat: latitude,
            lng: longitude,
            alt: altitude,
            accuracy,
            speed: gpsSpeed,
            time: timestamp,
            elapsed: (timestamp - startTime) / 1000,
        });

        // Update UI
        updateUI(latitude, longitude, altitude, accuracy, gpsSpeed);
        drawSpeedProfile();
    }

    function onGpsError(err) {
        console.warn('GPS error:', err);
        if (err.code === 1) {
            showNotification('GPS permission denied. Allow location access.', 'error');
            stopTracking();
        } else if (err.code === 2) {
            showNotification('GPS unavailable. Are you indoors?', 'warn');
        }
    }

    function updateUI(lat, lng, alt, accuracy, speed) {
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

        el('rideLat', lat.toFixed(6));
        el('rideLng', lng.toFixed(6));
        el('rideAltitude', alt ? `${alt.toFixed(1)} m` : '—');
        el('rideDistance', `${totalDistance.toFixed(2)} km`);
        el('rideSpeed', `${speed.toFixed(1)} km/h`);
        el('rideMaxSpeed', `${maxGpsSpeed.toFixed(1)} km/h`);
        el('rideAccuracy', `${accuracy.toFixed(0)} m`);

        // Accuracy bar (100m = 0%, 1m = 100%)
        const accPct = Math.max(0, Math.min(100, (1 - accuracy / 100) * 100));
        const accBar = document.getElementById('rideAccuracyBar');
        if (accBar) {
            accBar.style.width = `${accPct}%`;
            if (accuracy > 30) accBar.style.background = 'var(--accent-danger)';
            else if (accuracy > 10) accBar.style.background = 'var(--accent-warn)';
            else accBar.style.background = 'var(--accent-primary)';
        }
    }

    function updateTimer() {
        if (!startTime) return;
        const elapsed = (Date.now() - startTime) / 1000;
        const el = document.getElementById('rideDuration');
        if (el) el.textContent = formatDuration(elapsed);
    }

    function formatDuration(secs) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // --- Haversine distance (km) ---
    function haversine(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // --- Speed profile graph ---
    function drawSpeedProfile() {
        if (!rideCtx || trackPoints.length < 2) return;

        const w = rideCanvas.width;
        const h = rideCanvas.height;
        const pad = { top: 10, right: 10, bottom: 20, left: 40 };
        const gw = w - pad.left - pad.right;
        const gh = h - pad.top - pad.bottom;

        rideCtx.clearRect(0, 0, w, h);

        const yMax = Math.max(maxGpsSpeed * 1.2, 25);

        // Grid
        rideCtx.strokeStyle = 'rgba(255,255,255,0.04)';
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (gh / 4) * i;
            rideCtx.beginPath();
            rideCtx.moveTo(pad.left, y);
            rideCtx.lineTo(w - pad.right, y);
            rideCtx.stroke();

            rideCtx.fillStyle = 'rgba(255,255,255,0.2)';
            rideCtx.font = '9px "JetBrains Mono", monospace';
            rideCtx.textAlign = 'right';
            rideCtx.fillText(`${(yMax - (yMax / 4) * i).toFixed(0)}`, pad.left - 6, y + 3);
        }

        // 20 km/h limit line
        const limitY = pad.top + gh * (1 - 20 / yMax);
        rideCtx.strokeStyle = 'rgba(255, 0, 110, 0.25)';
        rideCtx.setLineDash([3, 3]);
        rideCtx.beginPath();
        rideCtx.moveTo(pad.left, limitY);
        rideCtx.lineTo(w - pad.right, limitY);
        rideCtx.stroke();
        rideCtx.setLineDash([]);

        // Fill
        const gradient = rideCtx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
        gradient.addColorStop(0, 'rgba(241, 91, 181, 0.15)');
        gradient.addColorStop(1, 'rgba(241, 91, 181, 0.0)');

        rideCtx.beginPath();
        rideCtx.moveTo(pad.left, h - pad.bottom);
        trackPoints.forEach((p, i) => {
            const x = pad.left + (i / (trackPoints.length - 1)) * gw;
            const y = pad.top + gh * (1 - p.speed / yMax);
            rideCtx.lineTo(x, y);
        });
        rideCtx.lineTo(pad.left + gw, h - pad.bottom);
        rideCtx.closePath();
        rideCtx.fillStyle = gradient;
        rideCtx.fill();

        // Line
        rideCtx.beginPath();
        trackPoints.forEach((p, i) => {
            const x = pad.left + (i / (trackPoints.length - 1)) * gw;
            const y = pad.top + gh * (1 - p.speed / yMax);
            if (i === 0) rideCtx.moveTo(x, y);
            else rideCtx.lineTo(x, y);
        });
        rideCtx.strokeStyle = '#f15bb5';
        rideCtx.lineWidth = 1.5;
        rideCtx.stroke();
    }

    // --- GPX Export ---
    function exportGPX() {
        if (trackPoints.length === 0) {
            showNotification('No track data to export', 'warn');
            return;
        }

        let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="NaveeHack" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>NaveeHack Ride</name>
    <time>${new Date(trackPoints[0].time).toISOString()}</time>
  </metadata>
  <trk>
    <name>Scooter Ride</name>
    <trkseg>
`;
        trackPoints.forEach(p => {
            gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">
        ${p.alt ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}
        <time>${new Date(p.time).toISOString()}</time>
        <extensions><speed>${p.speed.toFixed(1)}</speed></extensions>
      </trkpt>\n`;
        });

        gpx += `    </trkseg>
  </trk>
</gpx>`;

        const blob = new Blob([gpx], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `naveehack-ride-${Date.now()}.gpx`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`GPX exported (${trackPoints.length} points)`, 'success');
    }

    // --- Ride History ---
    function renderHistory() {
        const el = document.getElementById('rideHistory');
        if (!el) return;

        if (rideHistory.length === 0) {
            el.innerHTML = '<div style="color: var(--text-muted); font-size: 0.78rem;">No rides recorded yet.</div>';
            return;
        }

        let html = '';
        rideHistory.forEach(ride => {
            const date = new Date(ride.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
            html += `
                <div class="ride-history-item">
                    <div class="ride-history-date">${date}</div>
                    <div class="ride-history-stats">
                        <span>📏 ${ride.distance.toFixed(2)} km</span>
                        <span>⏱ ${formatDuration(ride.duration)}</span>
                        <span>🏎 ${ride.maxSpeed.toFixed(1)} km/h max</span>
                        <span>📍 ${ride.points} pts</span>
                    </div>
                </div>
            `;
        });
        el.innerHTML = html;
    }

    function saveHistory() {
        try { localStorage.setItem('naveehack_ride_history', JSON.stringify(rideHistory)); } catch (e) {}
    }

    function loadHistory() {
        try {
            const raw = localStorage.getItem('naveehack_ride_history');
            if (raw) rideHistory = JSON.parse(raw);
        } catch (e) {}
    }

    function clearHistory() {
        rideHistory = [];
        saveHistory();
        renderHistory();
        showNotification('Ride history cleared', 'info');
    }

    return {
        init,
        startTracking,
        stopTracking,
        exportGPX,
        isTracking: () => tracking,
    };
})();
