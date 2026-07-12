// ============================================================
// NaveeHack — speedgraph.js
// Live Speed Chart with Canvas Rendering
// "Speed is just a number until you graph it" — ENI
// ============================================================

const SpeedGraph = (() => {
    let canvas = null;
    let ctx = null;
    let dataPoints = [];
    let maxPoints = 300; // ~5 minutes at 1 update/sec
    let maxSpeed = 0;
    let startTime = null;
    let animFrame = null;

    function init() {
        canvas = document.getElementById('speedCanvas');
        if (canvas) {
            ctx = canvas.getContext('2d');
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
        }

        const clearBtn = document.getElementById('btnGraphClear');
        const exportBtn = document.getElementById('btnGraphExport');
        if (clearBtn) clearBtn.addEventListener('click', clearData);
        if (exportBtn) exportBtn.addEventListener('click', exportData);

        // Start render loop
        render();
    }

    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width || 800;
        canvas.height = 280;
    }

    function addDataPoint(speed, battery, voltage, current) {
        const now = Date.now();
        if (!startTime) startTime = now;

        dataPoints.push({
            time: now,
            elapsed: (now - startTime) / 1000,
            speed: speed || 0,
            battery: battery || 0,
            voltage: voltage || 0,
            current: current || 0,
        });

        if (speed > maxSpeed) maxSpeed = speed;

        // Trim old data
        if (dataPoints.length > maxPoints) {
            dataPoints.shift();
        }

        updateStats();
        updatePowerStats(voltage, current, speed);
    }

    function updateStats() {
        if (dataPoints.length === 0) return;

        const current = dataPoints[dataPoints.length - 1];
        const speeds = dataPoints.map(d => d.speed);
        const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        const elapsed = current.elapsed;

        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('graphCurrentSpeed', current.speed.toFixed(1));
        el('graphMaxSpeed', maxSpeed.toFixed(1));
        el('graphAvgSpeed', avg.toFixed(1));

        const mins = Math.floor(elapsed / 60);
        const secs = Math.floor(elapsed % 60);
        el('graphDuration', `${mins}:${secs.toString().padStart(2, '0')}`);
    }

    function updatePowerStats(voltage, current, speed) {
        const power = voltage * current;
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };

        el('graphPower', `${power.toFixed(0)} W`);

        if (speed > 0.5 && power > 0) {
            const whPerKm = power / speed;
            el('graphEfficiency', `${whPerKm.toFixed(1)} Wh/km`);

            // Estimate range: assume typical 36V 10Ah = 360Wh battery
            const telemetry = Dashboard.getTelemetry();
            const batteryWh = (telemetry.battery.voltage || 36) * 10 * (telemetry.battery.percent / 100);
            const estRange = batteryWh / whPerKm;
            el('graphEstRange', `${estRange.toFixed(1)} km`);
        }
    }

    function render() {
        if (canvas && ctx && dataPoints.length > 1) {
            drawGraph();
        }
        animFrame = requestAnimationFrame(render);
    }

    function drawGraph() {
        const w = canvas.width;
        const h = canvas.height;
        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const graphW = w - padding.left - padding.right;
        const graphH = h - padding.top - padding.bottom;

        ctx.clearRect(0, 0, w, h);

        // Max Y scale
        const yMax = Math.max(maxSpeed * 1.2, 30);

        // Grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (graphH / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(w - padding.right, y);
            ctx.stroke();

            // Y labels
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'right';
            const val = yMax - (yMax / 5) * i;
            ctx.fillText(`${val.toFixed(0)}`, padding.left - 8, y + 4);
        }

        // Time labels on X
        if (dataPoints.length > 2) {
            const totalTime = dataPoints[dataPoints.length - 1].elapsed - dataPoints[0].elapsed;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.textAlign = 'center';
            for (let i = 0; i <= 4; i++) {
                const x = padding.left + (graphW / 4) * i;
                const t = dataPoints[0].elapsed + (totalTime / 4) * i;
                const m = Math.floor(t / 60);
                const s = Math.floor(t % 60);
                ctx.fillText(`${m}:${s.toString().padStart(2, '0')}`, x, h - 8);
            }
        }

        // Speed limit line (20 km/h Germany)
        const limitY = padding.top + graphH * (1 - 20 / yMax);
        ctx.strokeStyle = 'rgba(255, 0, 110, 0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padding.left, limitY);
        ctx.lineTo(w - padding.right, limitY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 0, 110, 0.5)';
        ctx.textAlign = 'left';
        ctx.fillText('DE 20 km/h', w - padding.right - 60, limitY - 4);

        // Draw speed line
        if (dataPoints.length < 2) return;

        const firstTime = dataPoints[0].elapsed;
        const lastTime = dataPoints[dataPoints.length - 1].elapsed;
        const timeRange = lastTime - firstTime || 1;

        // Gradient fill under curve
        const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
        gradient.addColorStop(0, 'rgba(0, 245, 212, 0.15)');
        gradient.addColorStop(1, 'rgba(0, 245, 212, 0.0)');

        ctx.beginPath();
        ctx.moveTo(padding.left, h - padding.bottom);

        dataPoints.forEach((d, i) => {
            const x = padding.left + ((d.elapsed - firstTime) / timeRange) * graphW;
            const y = padding.top + graphH * (1 - d.speed / yMax);
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.lineTo(padding.left + graphW, h - padding.bottom);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw the line itself
        ctx.beginPath();
        dataPoints.forEach((d, i) => {
            const x = padding.left + ((d.elapsed - firstTime) / timeRange) * graphW;
            const y = padding.top + graphH * (1 - d.speed / yMax);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0, 245, 212, 0.4)';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Current speed dot
        if (dataPoints.length > 0) {
            const last = dataPoints[dataPoints.length - 1];
            const x = padding.left + graphW;
            const y = padding.top + graphH * (1 - last.speed / yMax);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#00f5d4';
            ctx.fill();
            ctx.shadowColor = 'rgba(0, 245, 212, 0.6)';
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    function clearData() {
        dataPoints = [];
        maxSpeed = 0;
        startTime = null;
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('graphCurrentSpeed', '0.0');
        el('graphMaxSpeed', '0.0');
        el('graphAvgSpeed', '0.0');
        el('graphDuration', '0:00');
        el('graphPower', '0 W');
        el('graphEfficiency', '— Wh/km');
        el('graphEstRange', '— km');
    }

    function exportData() {
        if (dataPoints.length === 0) {
            showNotification('No data to export', 'warn');
            return;
        }
        let csv = 'Elapsed(s),Speed(km/h),Battery(%),Voltage(V),Current(A)\n';
        dataPoints.forEach(d => {
            csv += `${d.elapsed.toFixed(1)},${d.speed.toFixed(1)},${d.battery},${d.voltage.toFixed(2)},${d.current.toFixed(2)}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `naveehack-speed-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showNotification(`Exported ${dataPoints.length} data points`, 'success');
    }

    return {
        init,
        addDataPoint,
        clearData,
        exportData,
    };
})();
