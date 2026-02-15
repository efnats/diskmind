let data = { disks: [], archived_disks: [], hosts: [], stats: {}, trends: {}, thresholds: {} };
let historyCache = {};
let statusFilter = '';
let deltaRangeDays = 30;
let settingsData = null;
let tempUnit = 'C'; // 'C' for Celsius, 'F' for Fahrenheit

// Host collapsed state management
function getHostCollapsedState() {
    try {
        return JSON.parse(localStorage.getItem('hostCollapsed') || '{}');
    } catch { return {}; }
}

function isHostCollapsed(host) {
    const state = getHostCollapsedState();
    // Default: Archived is collapsed, others are expanded
    if (state[host] !== undefined) return state[host];
    return host === 'Archived';
}

function toggleHostCollapsed(host) {
    const state = getHostCollapsedState();
    const hostGroup = document.querySelector(`.host-group[data-host="${host}"]`);
    if (hostGroup) {
        hostGroup.classList.toggle('collapsed');
        state[host] = hostGroup.classList.contains('collapsed');
        localStorage.setItem('hostCollapsed', JSON.stringify(state));
    }
}

// Health-relevant attributes by type (order matters - shown first)
// Attribute descriptions for tooltips
const ATTR_TIPS = {
    // ATA health
    'Reallocated_Sector_Ct': 'Number of defective sectors moved to a reserved spare area. A slowly rising count is normal aging; rapid growth suggests surface degradation.',
    'Reported_Uncorrect': 'Read or write errors that the error correction could not fix. Occasional errors can occur; a growing count points to media problems.',
    'Command_Timeout': 'Operations the drive failed to complete in time. Often caused by cable, power supply, or controller issues rather than the drive itself.',
    'Current_Pending_Sector': 'Sectors flagged as suspicious, waiting to be tested on the next write. May resolve on their own or become reallocated.',
    'Offline_Uncorrectable': 'Bad sectors found during background scans that could not be repaired or remapped. Indicates permanent media damage at those locations.',
    'Temperature_Celsius': 'Current drive temperature in \u00b0C. Most drives are rated for continuous operation up to 55-60\u00b0C.',
    'Airflow_Temperature_Cel': 'Current drive temperature in \u00b0C. Most drives are rated for continuous operation up to 55-60\u00b0C.',
    // ATA secondary
    'Raw_Read_Error_Rate': 'Rate of hardware read errors. On Seagate drives this is a composite value where the large raw number is normal and not an error count.',
    'Spin_Up_Time': 'Time in milliseconds for the platters to reach operating speed. Increases can indicate motor or bearing wear.',
    'Start_Stop_Count': 'Number of spindle start/stop cycles. Drives are typically rated for 50,000 or more cycles.',
    'Seek_Error_Rate': 'Rate of positioning errors when the head moves to a track. On Seagate drives this is a composite value; the large raw number is normal.',
    'Spin_Retry_Count': 'Number of times the drive needed more than one attempt to spin up. Non-zero values can point to power supply or motor issues.',
    'Power_Off_Retract_Count': 'Times the heads retracted due to power loss rather than a clean shutdown. Normal for drives that experience occasional outages.',
    'Load_Cycle_Count': 'Number of head load/unload cycles. Drives are typically rated for 300,000-600,000 cycles over their lifetime.',
    'UDMA_CRC_Error_Count': 'Data transfer errors between drive and controller, usually caused by a damaged or loose SATA cable.',
    'Multi_Zone_Error_Rate': 'Rate of errors when writing data across multiple zones. Can indicate problems with the write head or media surface.',
    'Head_Flying_Hours': 'Total time the read/write heads have been positioned over the platters. Similar to power-on hours but excludes idle/parked time.',
    'Total_LBAs_Written': 'Total logical block addresses written. Multiply by 512 bytes for approximate total data written to the drive.',
    'Total_LBAs_Read': 'Total logical block addresses read. Multiply by 512 bytes for approximate total data read from the drive.',
    'Power_On_Hours': 'Total accumulated hours the drive has been powered on.',
    'Power_Cycle_Count': 'Number of full power on/off cycles. Frequent cycling can stress components more than continuous operation.',
    'End-to-End_Error': 'Errors detected in the data path between the drive cache and the host interface. Should normally be zero.',
    'Runtime_Bad_Block': 'Bad blocks found during normal operation. Similar to reallocated sectors but tracked separately by some vendors.',
    'High_Fly_Writes': 'Write operations where the head was further from the platter surface than intended. Can lead to weak writes.',
    'G-Sense_Error_Rate': 'Shock and vibration events detected by the built-in accelerometer. Common in portable or poorly mounted drives.',
    'Hardware_ECC_Recovered': 'Number of errors corrected by hardware error correction. A rising count is normal as the drive ages.',
    // NVMe health
    'Percentage_Used': 'Vendor estimate of life consumed based on actual writes vs. rated endurance (TBW). Reaching 100% means the rated lifespan is used up, though many drives continue to work beyond that.',
    'Available_Spare': 'Percentage of reserved spare flash blocks still available for wear leveling. Starts at 100% and decreases over the lifetime of the drive.',
    'Available_Spare_Threshold': 'Vendor-defined minimum for available spare blocks. When Available Spare drops below this value, the drive raises a warning.',
    'Critical_Warning': 'Hardware-level warning flags reported by the NVMe controller. A value of 0 means no warnings are active.',
    'Media_and_Data_Integrity_Errors': 'Count of unrecovered data errors from the flash media. A value of 0 is expected; any increase means cells are failing.',
    'Error_Information_Log_Entries': 'Total number of error events logged by the drive. Some entries are normal over time; a sudden jump can indicate a new issue.',
    'Temperature': 'Current drive temperature in \u00b0C. NVMe drives typically throttle performance above 70\u00b0C to protect themselves.',
    'Unsafe_Shutdowns': 'Number of times the drive lost power without a clean shutdown command. Does not directly indicate damage, but high counts increase the risk of metadata issues.',
    // NVMe secondary
    'Data_Units_Read': 'Total data read in 512-byte units x1000. Divide by ~2 million to approximate terabytes read.',
    'Data_Units_Written': 'Total data written in 512-byte units x1000. Divide by ~2 million to approximate terabytes written.',
    'Host_Read_Commands': 'Total number of read commands issued by the host system.',
    'Host_Write_Commands': 'Total number of write commands issued by the host system.',
    'Controller_Busy_Time': 'Total time in minutes that the controller was busy handling I/O commands.',
    'Warning_Comp._Temperature_Time': 'Total minutes the drive spent above its warning temperature threshold.',
    'Critical_Comp._Temperature_Time': 'Total minutes the drive spent above its critical temperature threshold. Any non-zero value means the drive was at risk of damage.',
    'Temperature_Sensor_1': 'Reading from the first on-board temperature sensor, typically near the controller.',
    'Temperature_Sensor_2': 'Reading from the second on-board temperature sensor, typically near the NAND flash.',
    'Thermal_Temp._1_Transition_Count': 'Number of times the drive crossed into thermal throttling state 1 to manage heat.',
    'Thermal_Temp._1_Total_Time': 'Total time spent in thermal throttling state 1.',
};

const HEALTH_ATTRS = {
    ata: [
        {key: 'Reallocated_Sector_Ct', id: 5, label: 'Reallocated Sector Ct'},
        {key: 'Reported_Uncorrect', id: 187, label: 'Reported Uncorrect'},
        {key: 'Command_Timeout', id: 188, label: 'Command Timeout'},
        {key: 'Current_Pending_Sector', id: 197, label: 'Current Pending Sector'},
        {key: 'Offline_Uncorrectable', id: 198, label: 'Offline Uncorrectable'},
        {key: 'Temperature_Celsius', id: 194, label: 'Temperature'},
    ],
    nvme: [
        {key: 'Percentage_Used', label: 'Percentage Used'},
        {key: 'Available_Spare', label: 'Available Spare'},
        {key: 'Critical_Warning', label: 'Critical Warning'},
        {key: 'Media_and_Data_Integrity_Errors', label: 'Media & Data Integrity Errors'},
        {key: 'Error_Information_Log_Entries', label: 'Error Log Entries'},
        {key: 'Temperature', label: 'Temperature'},
    ]
};
// Alternate temperature key for ATA
const TEMP_KEYS = ['Temperature_Celsius', 'Airflow_Temperature_Cel', 'Temperature'];

// Key metrics shown in the top strip
const KEY_METRIC_ATTRS = ['Power_On_Hours', 'Power_Cycle_Count', 'Power_Cycles'];

function getTemp(attrs) {
    for (const k of TEMP_KEYS) { if (attrs[k] != null) return attrs[k]; }
    return null;
}

function formatTemp(celsius) {
    if (celsius == null || celsius === '-') return '-';
    const c = parseInt(celsius);
    if (isNaN(c)) return '-';
    if (tempUnit === 'F') {
        return Math.round(c * 9/5 + 32);
    }
    return c;
}

function getTempSymbol() {
    return tempUnit === 'F' ? '°F' : '°C';
}

function fmtHours(h) {
    if (!h) return '-';
    h = parseInt(h);
    if (h >= 1000) return (h / 1000).toFixed(1) + 'k';
    return String(h);
}

function fmtDuration(h) {
    if (!h) return '';
    h = parseInt(h);
    const days = Math.round(h / 24);
    if (days >= 365) {
        const years = (days / 365).toFixed(1);
        return years + (years === '1.0' ? ' year' : ' years');
    }
    if (days >= 30) {
        const months = Math.round(days / 30.44);
        return months + (months === 1 ? ' month' : ' months');
    }
    if (days >= 7) {
        const weeks = Math.round(days / 7);
        return weeks + (weeks === 1 ? ' week' : ' weeks');
    }
    return days + (days === 1 ? ' day' : ' days');
}

function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2) + ' ' + units[i];
}

function formatAge(ts, compact) {
    if (!ts) return '-';
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    const sec = Math.floor((new Date() - d) / 1000);
    if (sec < 60) return compact ? '1min' : 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return compact ? min + 'min' : min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return compact ? hr + 'h' : hr + 'h ago';
    const days = Math.floor(hr / 24);
    return compact ? days + 'd' : days + 'd ago';
}

// Keys that should be displayed as human-readable byte values
const LBA_KEYS = new Set(['Total_LBAs_Written', 'Total_LBAs_Read']);
const DATA_UNIT_KEYS = new Set(['Data_Units_Read', 'Data_Units_Written']);

// SVG sparkline generator
function sparkSVG(points, color, opts = {}) {
    if (!points || points.length < 2) {
        // Flat dashed line for no data or single point
        const y = 20;
        return `<svg viewBox="0 0 100 24" preserveAspectRatio="none"><line x1="0" y1="${y}" x2="100" y2="${y}" stroke="currentColor" stroke-width="1" stroke-dasharray="3,3" opacity="0.25"/></svg>`;
    }
    const w = 100, h = 24, pad = 2;
    let min = Math.min(...points), max = Math.max(...points);
    if (min === max) { min -= 1; max += 1; } // avoid div by zero
    const range = max - min;
    const coords = points.map((v, i) => {
        const x = (i / (points.length - 1)) * w;
        const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = coords.join(' L');
    const fill = coords.join(' L') + ` L${w},${h} L0,${h} Z`;
    const fillColor = color === '#f59e0b' ? 'rgba(245,158,11,0.12)' :
                      color === '#ef4444' ? 'rgba(239,68,68,0.12)' :
                      color === '#10b981' ? 'rgba(16,185,129,0.08)' :
                      'rgba(59,130,246,0.08)';
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <path d="M${fill}" fill="${fillColor}"/>
        <path d="M${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
}

// Seagate composite value decoder
// Seagate packs multiple counters into 48-bit raw values:
// - Command_Timeout (#188): [5-4]=cmds>7.5s, [3-2]=cmds>5s, [1-0]=actual timeouts
// - Raw_Read_Error_Rate (#1): [5-4]=error count, [3-0]=total operations
// - Seek_Error_Rate (#7): [5-4]=error count, [3-0]=total seeks
const SEAGATE_COMPOSITE_ATTRS = {
    'Command_Timeout': { extract: 'low16' },       // actual timeouts in low 16 bits
    'Raw_Read_Error_Rate': { extract: 'high16' },   // errors in high 16 bits
    'Seek_Error_Rate': { extract: 'high16' },       // errors in high 16 bits
};

function isSeagateComposite(attrKey, rawValue) {
    if (!SEAGATE_COMPOSITE_ATTRS[attrKey]) return false;
    // Composite values are >65535 (more than 16 bits used)
    return parseInt(rawValue) > 65535;
}

function decodeSeagateValue(attrKey, rawValue) {
    const raw = parseInt(rawValue);
    if (!isSeagateComposite(attrKey, rawValue)) return raw;
    const spec = SEAGATE_COMPOSITE_ATTRS[attrKey];
    if (spec.extract === 'low16') return raw & 0xFFFF;
    if (spec.extract === 'high16') return (raw >> 32) & 0xFFFF;
    return raw;
}

// Custom dropdown functions
function toggleDropdown(wrapperId) {
    const wrapper = document.getElementById(wrapperId);
    const wasOpen = wrapper.classList.contains('open');
    
    // Close all dropdowns
    document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
    
    // Toggle this one
    if (!wasOpen) {
        wrapper.classList.add('open');
    }
}

function selectOption(wrapperId, value, label, callback) {
    const wrapper = document.getElementById(wrapperId);
    const hiddenInput = wrapper.nextElementSibling;
    const valueDisplay = wrapper.querySelector('.custom-select-value');
    
    // Update hidden input
    if (hiddenInput && hiddenInput.tagName === 'INPUT') {
        hiddenInput.value = value;
    }
    
    // Update displayed value
    valueDisplay.innerHTML = label;
    
    // Update selected state
    wrapper.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    
    // Close dropdown
    wrapper.classList.remove('open');
    
    // Execute callback
    if (callback) callback(value);
}

function initDropdowns() {
    // Add click handlers to all options
    document.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrapper = opt.closest('.custom-select');
            const value = opt.dataset.value;
            const label = opt.innerHTML;
            
            // Determine callback based on wrapper id
            let callback = null;
            if (wrapper.id === 'typeFilterWrapper') callback = applyFilters;
            else if (wrapper.id === 'presetFilterWrapper') callback = (v) => changePreset(v);
            else if (wrapper.id === 'deltaRangeWrapper') callback = (v) => updateDeltaFromDropdown(v);
            else if (wrapper.id === 'hostFilterWrapper') callback = applyFilters;
            else if (wrapper.id === 'tempUnitWrapper') callback = () => saveTempUnit();
            else if (wrapper.id === 'refreshIntervalWrapper') callback = () => saveRefreshInterval();
            else if (wrapper.id === 'retentionWrapper') callback = () => saveRetention();
            else if (wrapper.id === 'alertThresholdWrapper') callback = () => saveNotifySettings();
            else if (wrapper.id === 'alertHistoryWrapper') callback = () => saveNotifySettings();
            else if (wrapper.id === 'notifyMinSeverityWrapper') callback = () => saveNotifySettings();
            else if (wrapper.id === 'notifyCooldownWrapper') callback = () => saveNotifySettings();
            else if (wrapper.id === 'alertRetentionWrapper') callback = () => savePanelSettings();
            else if (wrapper.id === 'alertSoundWrapper') callback = () => savePanelSettings();
            else if (wrapper.id === 'endpointServiceWrapper') callback = (v) => selectEndpointService(v);
            
            selectOption(wrapper.id, value, label, callback);
        });
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select')) {
            document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
        }
    });
}

function setDropdownValue(wrapperId, value) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    
    const option = wrapper.querySelector(`.custom-select-option[data-value="${value}"]`);
    if (option) {
        const label = option.innerHTML;
        const valueDisplay = wrapper.querySelector('.custom-select-value');
        const hiddenInput = wrapper.nextElementSibling;
        
        if (hiddenInput && hiddenInput.tagName === 'INPUT') {
            hiddenInput.value = value;
        }
        valueDisplay.innerHTML = label;
        
        wrapper.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });
    }
}

// Format time duration: <1h = Xmin, <1d = Xh, else Xd
function formatDuration(ms) {
    const minutes = ms / 60000;
    const hours = ms / 3600000;
    const days = ms / 86400000;
    if (days >= 1) return Math.floor(days) + 'd';
    if (hours >= 1) return Math.floor(hours) + 'h';
    return Math.max(1, Math.floor(minutes)) + 'min';
}

function getAttrColor(attrKey, value, diskType) {
    // Decode Seagate composites before threshold check
    const checkVal = (diskType !== 'NVMe') ? decodeSeagateValue(attrKey, value) : value;
    // Check against current thresholds
    const th = data.thresholds || {};
    const ruleSet = diskType === 'NVMe' ? (th.nvme || {}) : (th.ata || {});
    for (const [attr, rule] of Object.entries(ruleSet.critical || {})) {
        if (attr === attrKey && checkThreshold(checkVal, rule)) return '#ef4444';
    }
    for (const [attr, rule] of Object.entries(ruleSet.warning || {})) {
        if (attr === attrKey && checkThreshold(checkVal, rule)) return '#f59e0b';
    }
    // Temperature: always blue sparkline
    if (TEMP_KEYS.includes(attrKey) || attrKey === 'Temperature') return '#3b82f6';
    return '#3b82f6';
}

function checkThreshold(val, rule) {
    const v = parseFloat(val), t = rule.value;
    if (isNaN(v)) return false;
    if (rule.op === '>') return v > t;
    if (rule.op === '>=') return v >= t;
    if (rule.op === '<') return v < t;
    if (rule.op === '<=') return v <= t;
    if (rule.op === '==') return v === t;
    return false;
}

// Cumulative event counters - used for display hints (delta suffix)
// Actual filtering is now done in backend
const CUMULATIVE_EVENT_ATTRS = new Set([
    'Command_Timeout',
    'Reported_Uncorrect', 
    'UDMA_CRC_Error_Count',
    'Unsafe_Shutdowns',
    'Error_Information_Log_Entries',
    'Power_Off_Retract_Count',
    'G-Sense_Error_Rate',
]);

function getValClass(attrKey, value, diskType) {
    const checkVal = (diskType !== 'NVMe') ? decodeSeagateValue(attrKey, value) : value;
    const th = data.thresholds || {};
    const ruleSet = diskType === 'NVMe' ? (th.nvme || {}) : (th.ata || {});
    for (const [attr, rule] of Object.entries(ruleSet.critical || {})) {
        if (attr === attrKey && checkThreshold(checkVal, rule)) return 'val-danger';
    }
    for (const [attr, rule] of Object.entries(ruleSet.warning || {})) {
        if (attr === attrKey && checkThreshold(checkVal, rule)) return 'val-warning';
    }
    return 'val-ok';
}

function getValTip(attrKey, value, diskType, composite) {
    const checkVal = (diskType !== 'NVMe') ? decodeSeagateValue(attrKey, value) : value;
    const th = data.thresholds || {};
    const ruleSet = diskType === 'NVMe' ? (th.nvme || {}) : (th.ata || {});
    let level = '', rule = null;
    for (const [attr, r] of Object.entries(ruleSet.critical || {})) {
        if (attr === attrKey && checkThreshold(checkVal, r)) { level = 'Critical'; rule = r; break; }
    }
    if (!level) {
        for (const [attr, r] of Object.entries(ruleSet.warning || {})) {
            if (attr === attrKey && checkThreshold(checkVal, r)) { level = 'Warning'; rule = r; break; }
        }
    }
    if (!level) return '';
    const opLabel = rule.op === '>' ? 'above' : rule.op === '>=' ? 'at or above' : rule.op === '<' ? 'below' : rule.op === '<=' ? 'at or below' : '';
    let tip = `${level}: ${checkVal} is ${opLabel} ${rule.value}`;
    if (composite) tip += ` (decoded from raw ${value})`;
    return tip;
}

function getStatusIcon(attrKey, value, diskType) {
    const checkVal = (diskType !== 'NVMe') ? decodeSeagateValue(attrKey, value) : value;
    const th = data.thresholds || {};
    const ruleSet = diskType === 'NVMe' ? (th.nvme || {}) : (th.ata || {});
    for (const [attr, rule] of Object.entries(ruleSet.critical || {})) {
        if (attr === attrKey && checkThreshold(checkVal, rule)) return '<span style="color:var(--danger)">✕</span>';
    }
    for (const [attr, rule] of Object.entries(ruleSet.warning || {})) {
        if (attr === attrKey && checkThreshold(checkVal, rule)) return '<span style="color:var(--warning)">⚠</span>';
    }
    // Only show checkmark for health-monitored attributes
    const healthKeys = [...(HEALTH_ATTRS.ata || []), ...(HEALTH_ATTRS.nvme || [])].map(a => a.key);
    if (healthKeys.includes(attrKey) && !TEMP_KEYS.includes(attrKey) && attrKey !== 'Temperature') {
        return '<span style="color:var(--success)">✓</span>';
    }
    return '';
}

function renderAttrRow(attrDef, attrs, hist, diskType, showId, dataCoversFilter, dataAgeMs) {
    const key = attrDef.key;
    let val = attrs[key];
    // Temperature fallback
    if (val == null && TEMP_KEYS.includes(key)) {
        for (const tk of TEMP_KEYS) { if (attrs[tk] != null) { val = attrs[tk]; break; } }
    }
    if (val == null) val = 0;

    // Decode Seagate composite values for display and threshold checks
    let displayVal = val;
    let composite = false;
    if (diskType !== 'NVMe' && isSeagateComposite(key, val)) {
        displayVal = decodeSeagateValue(key, val);
        composite = true;
    }

    const h = hist ? hist[key] : null;
    const delta = h ? h.delta : 0;
    const points = h ? h.points : null;
    const color = getAttrColor(key, val, diskType);
    const valClass = getValClass(key, val, diskType);
    const statusIcon = getStatusIcon(key, val, diskType);
    const valTip = getValTip(key, val, diskType, composite);
    const idStr = showId && attrDef.id ? `<span class="attr-id">#${attrDef.id}</span>` : '';

    let deltaStr = '—';
    let deltaClass = '';
    if (delta > 0) { 
        deltaStr = `+${delta} ↑`; 
        deltaClass = 'delta-up'; 
    } else if (delta < 0) { 
        deltaStr = `${delta} ↓`; 
    }
    
    // Add period suffix if data doesn't cover filter period
    if (delta !== 0 && !dataCoversFilter && dataAgeMs > 0) {
        deltaStr += ` <span class="delta-period">(${formatDuration(dataAgeMs)})</span>`;
    }

    // Suffix for special attrs
    let suffix = '';
    if (key === 'Percentage_Used' || key === 'Available_Spare') suffix = '%';
    if (TEMP_KEYS.includes(key) || key === 'Temperature') suffix = '°C';

    // Value tooltip: threshold explanation, with composite decode info if applicable
    const valTipAttr = valTip ? ` data-tip="${valTip}"` : '';

    const tip = ATTR_TIPS[key] || '';
    const tipAttr = tip ? ` data-tip="${tip}"` : '';

    return `<tr>
        <td><span class="attr-name"${tipAttr}>${attrDef.label}</span>${idStr}</td>
        <td class="attr-value ${valClass}"${valTipAttr}>${displayVal}${suffix}</td>
        <td class="attr-delta ${deltaClass}">${deltaStr}</td>
        <td class="spark-cell">${sparkSVG(points, color)}</td>
        <td class="attr-status">${statusIcon}</td>
    </tr>`;
}

async function loadHistory(force = false) {
    try {
        const resp = await fetch(`/api/history?days=${deltaRangeDays}`);
        if (resp.ok) historyCache = await resp.json();
    } catch (e) { console.warn('History load failed:', e); }
}

let _consecutiveFailures = 0;

function showConnectionBanner(msg, isError) {
    const banner = document.getElementById('connectionBanner');
    document.getElementById('connectionMsg').textContent = msg;
    banner.classList.toggle('error', !!isError);
    banner.classList.add('visible');
}

function hideConnectionBanner() {
    document.getElementById('connectionBanner').classList.remove('visible');
}

async function loadData() {
    try {
        const [diskResp] = await Promise.all([
            fetch('/api/disks'),
            loadHistory(),
        ]);
        if (!diskResp.ok) throw new Error('HTTP ' + diskResp.status);
        data = await diskResp.json();
        renderData();
        document.getElementById('error').style.display = 'none';
        if (_consecutiveFailures > 0) {
            hideConnectionBanner();
            _consecutiveFailures = 0;
        }
        loadAlertBadge();
    } catch (e) {
        _consecutiveFailures++;
        if (_consecutiveFailures === 1) {
            showConnectionBanner('Connection lost \u2014 retrying\u2026');
        } else {
            showConnectionBanner('Connection lost \u2014 ' + _consecutiveFailures + ' failed retries', _consecutiveFailures >= 5);
        }
    }
}

// Refresh history periodically
setInterval(loadHistory, 120000);

function renderData() {
    // Save expanded detail rows and secondary sections before re-render
    const expandedDetails = new Set();
    const expandedSections = new Set();
    document.querySelectorAll('.detail-row.visible').forEach(el => expandedDetails.add(el.id));
    document.querySelectorAll('.secondary-attrs.visible').forEach(el => expandedSections.add(el.id));

    // Update stats
    document.getElementById('statCritical').textContent = data.stats.critical || 0;
    document.getElementById('statWarning').textContent = data.stats.warning || 0;
    document.getElementById('statWarningSub').textContent = (data.stats.warning || 0) === 1 ? 'Needs Attention' : 'Need Attention';
    document.getElementById('statHealthy').textContent = data.stats.healthy || 0;
    document.getElementById('statTotal').textContent = data.stats.total || 0;
    document.getElementById('statCapacity').textContent = (data.stats.total_capacity_tb || 0) + ' TB';
    document.getElementById('statMissing').textContent = data.stats.missing || 0;
    document.getElementById('statMissingSub').textContent = (data.stats.missing || 0) === 1 ? 'Not Seen' : 'Not Seen';
    document.getElementById('statArchived').textContent = (data.archived_disks || []).length;
    
    document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
    
    // Update host filter dropdown
    const hostFilter = document.getElementById('hostFilter');
    const currentHost = hostFilter.value;
    const hostWrapper = document.getElementById('hostFilterWrapper');
    const hostOptions = hostWrapper.querySelector('.custom-select-options');
    hostOptions.innerHTML = `<div class="custom-select-option${!currentHost ? ' selected' : ''}" data-value="">All Hosts</div>` +
        data.hosts.map(h => `<div class="custom-select-option${h === currentHost ? ' selected' : ''}" data-value="${h}">${h}</div>`).join('');
    
    // Re-attach click handlers for new options
    hostOptions.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            selectOption('hostFilterWrapper', opt.dataset.value, opt.textContent, applyFilters);
        });
    });
    
    // Group disks by host
    const byHost = {};
    data.disks.forEach(d => {
        if (!byHost[d.host]) byHost[d.host] = [];
        byHost[d.host].push(d);
    });
    
    // Add archived disks as special "Archived" host
    const archivedDisks = data.archived_disks || [];
    if (archivedDisks.length > 0) {
        byHost['Archived'] = archivedDisks.map(d => ({ ...d, _isArchived: true }));
    }
    
    // Get host_status from API response
    const hostStatus = data.host_status || {};
    const pushAttempts = data.push_attempts || {};
    
    // Build map of IP -> full config entry
    // Format: "ssh:user@host" or "ssh:user@host:port" or "push:host"
    const hostConfigMap = {};
    (settingsData?.hosts || []).forEach(h => {
        let method = 'ssh', rest = h;
        if (h.startsWith('push:')) { method = 'push'; rest = h.slice(5); }
        else if (h.startsWith('ssh:')) { method = 'ssh'; rest = h.slice(4); }
        let ip = rest.includes('@') ? rest.split('@')[1] : rest;
        // Extract port if present (format: host:port)
        let port = '';
        if (method === 'ssh' && ip.includes(':')) {
            const parts = ip.split(':');
            ip = parts[0];
            port = parts[1];
        }
        hostConfigMap[ip] = { full: h, method, rest, ip, port };
    });
    
    // Helper to get user for a host
    const getHostUser = (host) => {
        const entry = hostConfigMap[host];
        if (!entry) return null;
        return entry.rest.includes('@') ? entry.rest.split('@')[0] : null;
    };
    
    // Helper to get method for a host
    const getHostMethod = (host) => {
        const entry = hostConfigMap[host];
        return entry ? entry.method : 'ssh';
    };
    
    // Helper to get port for a host
    const getHostPort = (host) => {
        const entry = hostConfigMap[host];
        return entry?.port || '';
    };
    
    // Render hosts (all configured hosts, even those without disks)
    // Put "Archived" at the end if it exists
    const hostOrder = [...data.hosts];
    if (byHost['Archived']) hostOrder.push('Archived');
    
    let html = '';
    for (const host of hostOrder) {
        const disks = byHost[host] || [];
        const isArchived = host === 'Archived';
        const status = hostStatus[host] || {};
        const hasDisks = disks.length > 0;
        
        // Skip archived if no disks (shouldn't happen but just in case)
        if (isArchived && !hasDisks) continue;
        
        const hostUser = isArchived ? null : getHostUser(host);
        const hostMethod = isArchived ? null : getHostMethod(host);
        const hostPort = isArchived ? null : getHostPort(host);
        const fullHostEntry = isArchived ? null : (hostConfigMap[host]?.full || host);
        
        // User display (small text if != root)
        const userDisplay = hostUser ? `<span class="host-user">${hostUser}@</span>` : '';
        const methodBadge = isArchived ? '' : `<span class="host-method-badge ${hostMethod}">${hostMethod}</span>`;
        const pushHint = (!isArchived && hostMethod === 'ssh' && pushAttempts[host])
            ? `<span class="push-hint" data-tip="This host attempted to push data ${pushAttempts[host].attempts}×. Consider switching to Push mode.">⚡</span>`
            : '';
        
        // Inline edit form (hidden by default, replaces host name when editing)
        const hostEditForm = isArchived ? '' : `<div class="host-edit-form" id="hostEdit-${host.replace(/\\./g, '-')}" style="display:none;">
            <div class="method-toggle">
                <button type="button" class="method-toggle-btn${hostMethod === 'ssh' ? ' active' : ''}" onclick="setEditMethod('${host}', 'ssh')">SSH</button>
                <button type="button" class="method-toggle-btn${hostMethod === 'push' ? ' active' : ''}" onclick="setEditMethod('${host}', 'push')">Push</button>
            </div>
            <span class="host-edit-ssh-fields" id="hostEditSsh-${host.replace(/\\./g, '-')}" style="${hostMethod === 'push' ? 'display:none' : ''}">
                <input type="text" class="host-edit-input host-edit-user" value="${hostUser || ''}" placeholder="user">
                <span class="host-edit-at">@</span>
            </span>
            <input type="text" class="host-edit-input host-edit-ip" value="${host}">
            <span class="host-edit-ssh-fields" id="hostEditPort-${host.replace(/\\./g, '-')}" style="${hostMethod === 'push' ? 'display:none' : ''}">
                <span class="host-edit-at">:</span>
                <input type="text" class="host-edit-input host-edit-port" value="${hostPort}" placeholder="22">
            </span>
            <input type="hidden" class="host-edit-method-val" value="${hostMethod}">
            <button class="host-edit-confirm" onclick="event.stopPropagation();saveHostEdit('${host}')">✓</button>
            <button class="host-edit-cancel" onclick="event.stopPropagation();hideHostEdit('${host}')">✕</button>
        </div>`;
        
        // Host actions (reload, edit, remove buttons)
        const rescanBtn = hostMethod === 'push'
            ? `<button class="host-action-btn reload disabled" title="Push hosts sync automatically" disabled>↻</button>`
            : `<button class="host-action-btn reload" onclick="event.stopPropagation();rescanHost('${fullHostEntry}')" title="Rescan host">↻</button>`;
        const hostActions = isArchived ? '' : `
            <div class="host-actions">
                ${rescanBtn}
                <button class="host-action-btn edit" onclick="event.stopPropagation();showHostEdit('${host}')" title="Edit host">✎</button>
                <button class="host-action-btn delete" onclick="event.stopPropagation();removeHostByName('${fullHostEntry}')" title="Remove host">✕</button>
            </div>`;
        
        if (hasDisks) {
            // Normal host with disks
            const critical = disks.filter(d => d.status === 'critical').length;
            const warning = disks.filter(d => d.status === 'warning' || d.status === 'missing').length;
            const capacityTB = (disks.reduce((s, d) => s + (d.capacity_bytes || 0), 0) / 1e12).toFixed(1);
            
            // Find most recent scan timestamp for this host
            let lastScan = '';
            const timestamps = disks.map(d => d.timestamp).filter(Boolean).sort();
            if (timestamps.length > 0) {
                lastScan = formatAge(timestamps[timestamps.length - 1]);
            }
            
            let badge = '<span class="host-badge ok">OK</span>';
            if (critical > 0) badge = `<span class="host-badge critical">${critical} critical</span>`;
            else if (warning > 0) badge = `<span class="host-badge warning">${warning} warning</span>`;
            
            // Archived host has different header
            if (isArchived) {
                const collapsedClass = isHostCollapsed(host) ? ' collapsed' : '';
                html += `<div class="host-group${collapsedClass}" data-host="${host}">
                    <div class="host-header" onclick="toggleHostCollapsed('${host}')">
                        <div>
                            <span class="host-name-display" style="color:var(--text-muted)">Archived</span>
                        </div>
                        <div class="host-stats"><span>${disks.length} disk${disks.length !== 1 ? 's' : ''} · ${capacityTB} TB</span><span class="host-toggle">▼</span></div>
                    </div>
                    <div class="host-content">
                        <table class="disk-table">
                            <colgroup>
                                <col style="width: 120px">
                                <col style="width: 60px">
                                <col style="width: 240px">
                                <col style="width: 150px">
                                <col style="width: 80px">
                                <col style="width: 80px">
                                <col style="width: 60px">
                                <col style="width: 60px">
                                <col style="width: 60px">
                                <col style="width: 100px">
                                <col>
                            </colgroup>
                            <thead><tr>
                                <th class="sortable" onclick="sortDisks('device')">Device <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('type')">Type <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('model')">Model <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('serial')">Serial <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('size')">Size <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('hours')">Hours <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('temp')">${getTempSymbol()} <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('since')">First <span class="info-icon" data-tip="Time since first scan of this disk. Shows how long we have historical data.">ⓘ</span> <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('last')">Last <span class="info-icon" data-tip="Time since last scan. Shows how current the data is.">ⓘ</span> <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('status')">Status <span class="sort-icon">⇅</span></th>
                                <th>From</th>
                            </tr></thead>
                            <tbody>${sortedDisks(disks).map(d => renderDisk(d, true)).join('')}</tbody>
                        </table>
                    </div>
                </div>`;
            } else {
                const collapsedClass = isHostCollapsed(host) ? ' collapsed' : '';
                html += `<div class="host-group${collapsedClass}" data-host="${host}">
                    <div class="host-header" onclick="toggleHostCollapsed('${host}')">
                        <div>
                            <span class="host-name-display" id="hostDisplay-${host.replace(/\\./g, '-')}">${methodBadge}${userDisplay}${host}${pushHint}</span>
                            ${hostEditForm}
                            <span id="hostBadge-${host.replace(/\\./g, '-')}">${badge}</span>
                        </div>
                        <div class="host-stats"><span>${disks.length} drives · ${capacityTB} TB${lastScan ? ` · ${lastScan}` : ''}</span><span id="hostActions-${host.replace(/\\./g, '-')}">${hostActions}</span><span class="host-toggle">▼</span></div>
                    </div>
                    <div class="host-content">
                        <table class="disk-table">
                            <colgroup>
                                <col style="width: 120px">
                                <col style="width: 60px">
                                <col style="width: 240px">
                                <col style="width: 150px">
                                <col style="width: 80px">
                                <col style="width: 80px">
                                <col style="width: 60px">
                                <col style="width: 60px">
                                <col style="width: 60px">
                                <col style="width: 100px">
                                <col>
                            </colgroup>
                            <thead><tr>
                                <th class="sortable" onclick="sortDisks('device')">Device <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('type')">Type <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('model')">Model <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('serial')">Serial <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('size')">Size <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('hours')">Hours <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('temp')">${getTempSymbol()} <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('since')">First <span class="info-icon" data-tip="Time since first scan of this disk. Shows how long we have historical data.">ⓘ</span> <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('last')">Last <span class="info-icon" data-tip="Time since last scan. Shows how current the data is.">ⓘ</span> <span class="sort-icon">⇅</span></th>
                                <th class="sortable" onclick="sortDisks('status')">Status <span class="sort-icon">⇅</span></th>
                                <th>Issues</th>
                            </tr></thead>
                            <tbody>${sortedDisks(disks).map(d => renderDisk(d)).join('')}</tbody>
                        </table>
                    </div>
                </div>`;
            }
        } else {
            // Host without disks - show status
            const statusLabels = {
                'pending': { badge: 'pending', text: 'Pending' },
                'offline': { badge: 'offline', text: 'Offline' },
                'auth_failed': { badge: 'offline', text: 'Auth failed' },
                'timeout': { badge: 'offline', text: 'Timeout' },
                'no_smartctl': { badge: 'warning', text: 'No smartctl' },
                'no_disks': { badge: 'warning', text: 'No disks' },
                'error': { badge: 'offline', text: 'Error' },
            };
            const statusInfo = statusLabels[status.status] || { badge: 'offline', text: status.status || 'Unknown' };
            const badge = `<span class="host-badge ${statusInfo.badge}">${statusInfo.text}</span>`;
            
            // Format last attempt time
            const lastAttempt = status.last_attempt ? formatAge(status.last_attempt) : '';
            
            const message = status.message || '';
            const statusText = message + (lastAttempt ? ` · ${lastAttempt}` : '');
            
            html += `<div class="host-group host-error" data-host="${host}">
                <div class="host-header">
                    <div>
                        <span class="host-name-display" id="hostDisplay-${host.replace(/\\./g, '-')}">${methodBadge}${userDisplay}${host}${pushHint}</span>
                        ${hostEditForm}
                        <span id="hostBadge-${host.replace(/\\./g, '-')}">${badge}</span>
                    </div>
                    <div class="host-stats"><span>${statusText || 'Never scanned'}</span><span id="hostActions-${host.replace(/\\./g, '-')}">${hostActions}</span></div>
                </div>
            </div>`;
        }
    }
    
    // Pending push hosts (unknown hosts that attempted to push)
    const pendingHosts = Object.entries(pushAttempts).filter(([ip, info]) => info.reason === 'unknown');
    if (pendingHosts.length > 0) {
        html += `<div class="pending-hosts-section">
            <div class="pending-hosts-header">Pending Approval</div>`;
        for (const [ip, info] of pendingHosts) {
            // Format last attempt time
            const ago = info.last_attempt ? formatAge(info.last_attempt) : '';
            html += `<div class="pending-host-row">
                <div class="pending-host-info">
                    <span class="host-method-badge push">push</span>
                    <span class="pending-host-ip">${ip}</span>
                    <span class="pending-host-meta">${info.attempts}× · ${ago}</span>
                </div>
                <div class="pending-host-actions">
                    <button class="pending-btn accept" onclick="approvePushHost('${ip}', 'accept')">Accept</button>
                    <button class="pending-btn dismiss" onclick="approvePushHost('${ip}', 'dismiss')">Dismiss</button>
                </div>
            </div>`;
        }
        html += `</div>`;
    }
    
    document.getElementById('content').innerHTML = html || '<div class="loading">No data available</div>';

    // Restore expanded state
    expandedDetails.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('visible');
    });
    expandedSections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('visible');
    });

    applyFilters();
}

function renderDisk(d, isArchived = false) {
    const typeClass = (d.type || '').toLowerCase();
    const statusDot = d.smart_status === 'PASSED' ? 'ok' : 'fail';
    const capacity = d.capacity_bytes >= 1e12 ? (d.capacity_bytes / 1e12).toFixed(1) + 'TB' : (d.capacity_bytes / 1e9).toFixed(0) + 'GB';
    const diskId = d.disk_id || d.serial;
    const eid = diskId.replace(/[\"' ]/g, '_');
    const attrs = d.smart_attributes || {};
    const hist = historyCache[diskId] || {};

    // Hours & temp for main table row
    let hours = parseInt(attrs.Power_On_Hours || attrs.Power_On_Hours_and_Msec || 0);
    const hoursFmt = fmtHours(hours);
    let tempRaw = getTemp(attrs);
    let temp = formatTemp(tempRaw);
    
    // Check temperature against thresholds
    let tempClass = '';
    if (tempRaw !== null && data.thresholds) {
        const isNVMe = d.type === 'NVMe';
        const ruleSet = isNVMe ? (data.thresholds.nvme || {}) : (data.thresholds.ata || {});
        const tempKey = isNVMe ? 'Temperature' : 'Temperature_Celsius';
        const critRule = (ruleSet.critical || {})[tempKey];
        const warnRule = (ruleSet.warning || {})[tempKey];
        if (critRule && checkThreshold(tempRaw, critRule)) {
            tempClass = 'temp-critical';
        } else if (warnRule && checkThreshold(tempRaw, warnRule)) {
            tempClass = 'temp-warning';
        }
    }

    // Calculate data availability (time since first reading)
    const hMeta = hist || {};
    const firstSeen = (historyCache._first_seen || {})[diskId] || '';
    const firstReading = firstSeen || hMeta._first || '';
    const dataAgeMs = firstReading ? (new Date() - new Date(firstReading)) : 0;
    const dataDays = dataAgeMs / 86400000;
    const dataCoversFilter = dataDays >= deltaRangeDays || deltaRangeDays >= 36500;
    
    // Since cell - show when data started, highlight if filter exceeds data
    let sinceText = '-';
    let sinceClass = '';
    let sinceTooltip = '';
    if (firstReading) {
        sinceText = formatAge(firstReading, true);
        
        if (!dataCoversFilter) {
            sinceClass = 'since-incomplete';
            const filterStr = deltaRangeDays < 1 ? Math.round(deltaRangeDays * 24) + ' hours' : Math.round(deltaRangeDays) + ' days';
            sinceTooltip = `Only ${sinceText} of data, filter requests ${filterStr}`;
        }
    }

    // Last cell - show time since last scan
    const lastText = formatAge(d.timestamp, true);

    // Issues - already filtered by backend based on delta
    let issueSpans = '';
    if (d.issues && d.issues.length > 0) {
        for (const issue of d.issues) {
            let deltaStr = '';
            if (issue.attr && hist && hist[issue.attr]) {
                const delta = hist[issue.attr].delta || 0;
                if (delta > 0) {
                    deltaStr = ` <span class="issue-delta" title="+${delta} in selected period">(+${delta})</span>`;
                }
            }
            issueSpans += `<span class="issue ${issue.level}">${issue.text}${deltaStr}</span>`;
        }
    }
    
    // Build issues cell content
    let issues = '';
    if (isArchived) {
        // Archived disk - show host and Restore button
        const hostExists = data.hosts.includes(d.host);
        const hostClass = hostExists ? 'mono muted' : 'mono muted host-removed';
        const hostDisplay = `<span class="${hostClass}">${escapeHtml(d.host)}</span>`;
        if (hostExists) {
            issues = `${hostDisplay}<button class="restore-btn" onclick="event.stopPropagation(); restoreDisk('${escapeHtml(diskId)}')" title="Restore to active disks">Restore</button>`;
        } else {
            issues = `${hostDisplay}<button class="restore-btn disabled" disabled title="Cannot restore - host is no longer configured">Restore</button>`;
        }
    } else if (d.status === 'missing') {
        issues = `<span class="issues-list">${issueSpans || '-'}</span><button class="archive-btn" onclick="event.stopPropagation(); archiveDisk('${escapeHtml(diskId)}')" title="Move to archive. History is preserved.">Archive</button>`;
    } else {
        issues = issueSpans || '-';
    }

    // Determine health attrs for this disk type
    const diskType = d.type || 'HDD';
    const isNVMe = diskType === 'NVMe';
    const healthDefs = isNVMe ? HEALTH_ATTRS.nvme : HEALTH_ATTRS.ata;
    const healthKeys = new Set(healthDefs.map(a => a.key));
    TEMP_KEYS.forEach(k => healthKeys.add(k));

    // Sidebar
    const firmware = d.firmware || attrs.Firmware_Version || '';
    const powerCycles = attrs.Power_Cycle_Count || attrs.Power_Cycles || '-';
    const rpm = d.rpm;
    const sectorSize = d.sector_size;
    let sbHtml = '';
    if (d.wwn) sbHtml += `<div class="sidebar-item"><div class="sb-label">WWN</div><div class="sb-value">${d.wwn}</div></div>`;
    if (firmware) sbHtml += `<div class="sidebar-item"><div class="sb-label">Firmware</div><div class="sb-value">${firmware}</div></div>`;
    sbHtml += `<div class="sidebar-item"><div class="sb-label">Power Cycles</div><div class="sb-value">${powerCycles}</div></div>`;
    sbHtml += `<div class="sidebar-item"><div class="sb-label">Power On</div><div class="sb-value">${hours.toLocaleString()}h</div><div class="sb-sub">${fmtDuration(hours)}</div></div>`;
    if (rpm != null && !isNVMe) sbHtml += `<div class="sidebar-item"><div class="sb-label">RPM</div><div class="sb-value">${rpm > 0 ? rpm.toLocaleString() : 'SSD'}</div></div>`;
    if (sectorSize) sbHtml += `<div class="sidebar-item"><div class="sb-label">Sector Size</div><div class="sb-value">${sectorSize}B</div></div>`;

    // History footer info
    const nReadings = hMeta._readings || 0;
    const first = hMeta._first || '';
    const last = hMeta._last || '';
    let spanText = '';
    const filterLabel = deltaRangeDays >= 36500 ? 'all time' : deltaRangeDays < 1 ? Math.round(deltaRangeDays * 24) + 'h' : Math.round(deltaRangeDays) + 'd';
    if (nReadings) {
        spanText = `${nReadings} readings · ${filterLabel}`;
    }
    if (spanText) sbHtml += `<div class="sidebar-item"><div class="sb-label">History</div><div class="sb-sub">${spanText}</div></div>`;

    // Health attribute rows
    let healthRows = '';
    for (const attrDef of healthDefs) {
        healthRows += renderAttrRow(attrDef, attrs, hist, diskType, !isNVMe, dataCoversFilter, dataAgeMs);
    }

    // Secondary attributes
    const skipKeys = new Set([...healthKeys, ...KEY_METRIC_ATTRS, 'Firmware_Version']);
    const secondaryAttrs = Object.keys(attrs).filter(k => !skipKeys.has(k));
    let secondaryRows = '';
    for (const key of secondaryAttrs) {
        const val = attrs[key];
        const h = hist[key] || null;
        const delta = h ? h.delta : 0;
        const points = h ? h.points : null;
        let deltaStr = '\u2014';
        if (delta > 0) { deltaStr = `+${delta}`; }
        else if (delta < 0) { deltaStr = `${delta}`; }
        // Add period suffix if data doesn't cover filter
        if (delta !== 0 && !dataCoversFilter && dataAgeMs > 0) {
            deltaStr += ` <span class="delta-period">(${formatDuration(dataAgeMs)})</span>`;
        }
        const label = key.replace(/_/g, ' ');
        const tip = ATTR_TIPS[key] || '';
        const tipAttr = tip ? ` data-tip="${tip}"` : '';
        // Format LBA/Data Unit values as human-readable bytes
        let displayVal = val;
        let valTitle = '';
        const numVal = parseInt(val);
        if (LBA_KEYS.has(key) && !isNaN(numVal) && numVal > 0) {
            const bytes = numVal * 512;
            displayVal = fmtBytes(bytes);
            valTitle = ` data-tip="${numVal.toLocaleString()} sectors"`;
        } else if (DATA_UNIT_KEYS.has(key) && !isNaN(numVal) && numVal > 0) {
            const bytes = numVal * 512000;
            displayVal = fmtBytes(bytes);
            valTitle = ` data-tip="${numVal.toLocaleString()} units"`;
        }
        secondaryRows += `<tr>
            <td><span class="attr-name"${tipAttr}>${label}</span></td>
            <td class="attr-value val-ok"${valTitle}>${displayVal}</td>
            <td class="attr-delta">${deltaStr}</td>
            <td class="spark-cell">${points ? sparkSVG(points, '#3b82f6') : ''}</td>
            <td class="attr-status"></td>
        </tr>`;
    }

    const secId = 'sec-' + eid;
    const totalAttrs = healthDefs.length + secondaryAttrs.length;
    
    // Info banner if data doesn't cover filter period
    let infoBanner = '';
    if (!dataCoversFilter && dataAgeMs > 0) {
        const filterStr = deltaRangeDays < 1 ? `${Math.round(deltaRangeDays * 24)} hours` : deltaRangeDays >= 36500 ? 'all time' : `${Math.round(deltaRangeDays)} days`;
        infoBanner = `<div class="data-coverage-info">ℹ Data available: ${sinceText} · Filter: ${filterStr}</div>`;
    }

    const rowClass = isArchived ? 'disk-row' : `disk-row ${d.status}`;
    return `<tr class="${rowClass}" data-type="${d.type}" data-status="${d.status}" data-diskid="${escapeHtml(diskId)}" data-serial="${escapeHtml(d.serial || '')}" onclick="toggleDetail('${eid}')">
        <td><span class="device-name">${d.device}</span></td>
        <td><span class="type-badge ${typeClass}">${d.type}</span></td>
        <td>${d.model || '-'}</td>
        <td class="mono muted">${d.serial}</td>
        <td>${capacity}</td>
        <td class="mono">${hoursFmt}</td>
        <td class="${tempClass}">${temp !== '-' ? temp + '°' : '-'}</td>
        <td class="${sinceClass}"${sinceTooltip ? ` title="${sinceTooltip}"` : ''}>${sinceText}</td>
        <td>${lastText}</td>
        <td><span class="status-dot ${statusDot}"></span>${d.smart_status}</td>
        <td class="issues-cell">${issues || '-'}</td>
    </tr>
    <tr class="detail-row" id="detail-${eid}" data-diskid="${escapeHtml(diskId)}" data-serial="${escapeHtml(d.serial || '')}">
        <td colspan="11">
            <div class="detail-anim"><div class="detail-anim-inner">
            <div class="detail-panel">
                <div class="detail-sidebar">${sbHtml}</div>
                <div class="detail-main">
                    ${infoBanner}
                    <div class="attr-section-header">
                        <div class="attr-section-title">Health & Endurance</div>
                        ${secondaryAttrs.length > 0 ? `<button class="show-all-btn" id="btn-${secId}" onclick="event.stopPropagation(); let el=document.getElementById('${secId}'); el.classList.toggle('visible'); this.textContent=el.classList.contains('visible')?'Show less':'Show all ${totalAttrs} attributes';">Show all ${totalAttrs} attributes</button>` : ''}
                    </div>
                    <div class="detail-main-body" onclick="event.stopPropagation(); if(event.target.closest('.show-all-btn,.attr-name[data-tip],.attr-value[data-tip]'))return; let btn=document.getElementById('btn-${secId}'); if(btn) btn.click();" style="cursor:pointer;">
                    <table class="attr-table">
                        <thead><tr>
                            <th style="width:38%">Attribute</th>
                            <th class="right" style="width:12%">Value</th>
                            <th class="right" style="width:10%">\u0394</th>
                            <th style="width:25%">Trend</th>
                            <th style="width:5%"></th>
                        </tr></thead>
                        <tbody>${healthRows}</tbody>
                        ${secondaryAttrs.length > 0 ? `<tbody id="${secId}" class="secondary-attrs">${secondaryRows}</tbody>` : ''}
                    </table>
                    </div>
                    ${spanText ? `<div class="detail-footer">First scan: <span>${first}</span> · Last scan: <span>${last}</span></div>` : ''}
                </div>
            </div>
            </div></div>
        </td>
    </tr>`;
}

function toggleDetail(eid) {
    const target = document.getElementById('detail-' + eid);
    if (!target) return;
    const diskRow = target.previousElementSibling;
    const rowTop = diskRow.getBoundingClientRect().top;
    const isOpen = target.classList.contains('visible');
    document.querySelectorAll('.detail-row.visible').forEach(el => el.classList.remove('visible'));
    if (!isOpen) target.classList.add('visible');
    const newTop = diskRow.getBoundingClientRect().top;
    window.scrollBy(0, newTop - rowTop);
}

function navigateToDisk(diskId) {
    // Close alerts panel
    document.getElementById('alertsOverlay').classList.remove('open');
    // Try by diskid first, then by serial (alerts store serial, rows use WWN)
    let target = document.querySelector(`.detail-row[data-diskid="${CSS.escape(diskId)}"]`);
    if (!target) {
        target = document.querySelector(`.detail-row[data-serial="${CSS.escape(diskId)}"]`);
    }
    if (!target) return;
    setTimeout(() => {
        const hostGroup = target.closest('.host-group');
        if (hostGroup && hostGroup.classList.contains('collapsed')) {
            hostGroup.classList.remove('collapsed');
            // Save state
            const host = hostGroup.dataset.host;
            if (host) {
                const state = getHostCollapsedState();
                state[host] = false;
                localStorage.setItem('hostCollapsed', JSON.stringify(state));
            }
        }
        document.querySelectorAll('.detail-row.visible').forEach(el => el.classList.remove('visible'));
        target.classList.add('visible');
        target.previousElementSibling.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
}

function filterStatus(s) {
    statusFilter = s;
    document.querySelectorAll('.stat').forEach(el => el.classList.remove('active'));
    if (s) event.target.closest('.stat').classList.add('active');
    
    // Special handling for archived - show only Archived section
    if (s === 'archived') {
        document.querySelectorAll('.host-group').forEach(g => {
            if (g.dataset.host === 'Archived') {
                g.style.display = '';
                g.classList.remove('collapsed');
                // Save state
                const state = getHostCollapsedState();
                state['Archived'] = false;
                localStorage.setItem('hostCollapsed', JSON.stringify(state));
            } else {
                g.style.display = 'none';
            }
        });
        return;
    }
    
    applyFilters();
}

function applyFilters() {
    const host = document.getElementById('hostFilter').value;
    const type = document.getElementById('typeFilter').value;
    const search = document.getElementById('search').value.toLowerCase();
    
    // Special handling for archived filter
    if (statusFilter === 'archived') {
        document.querySelectorAll('.host-group').forEach(g => {
            if (g.dataset.host === 'Archived') {
                g.style.display = '';
            } else {
                g.style.display = 'none';
            }
        });
        return;
    }
    
    document.querySelectorAll('.host-group').forEach(g => {
        // Skip Archived section for normal status filters
        if (g.dataset.host === 'Archived') {
            g.style.display = statusFilter ? 'none' : '';
            return;
        }
        
        if (host && g.dataset.host !== host) { g.style.display = 'none'; return; }
        g.style.display = '';
        let visible = 0;
        g.querySelectorAll('.disk-row').forEach(r => {
            let show = true;
            if (type && r.dataset.type !== type) show = false;
            if (statusFilter && r.dataset.status !== statusFilter) show = false;
            if (search && !r.textContent.toLowerCase().includes(search)) show = false;
            r.style.display = show ? '' : 'none';
            if (!show) document.getElementById('detail-' + r.querySelector('.mono')?.textContent)?.classList.remove('visible');
            if (show) visible++;
        });
        if (!visible && (type || statusFilter || search)) g.style.display = 'none';
    });
}

// Delta range presets mapping
const DELTA_PRESETS = {
    '1h': 1/24,
    '24h': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    'all': 36500
};

function updateDeltaFromDropdown(value) {
    if (DELTA_PRESETS[value] !== undefined) {
        deltaRangeDays = DELTA_PRESETS[value];
    }
    
    // Persist to localStorage
    localStorage.setItem('deltaRangePreset', value);
    
    // Save to server config, then reload all data (backend recalculates issues/status)
    fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({delta_preset: value})
    }).then(() => {
        // Reload data - backend will recalculate issues and status based on new delta
        loadData();
    }).catch(e => console.warn('Failed to save delta range:', e));
}

function restoreDeltaRange() {
    // Try to get from settingsData (server), fall back to localStorage
    let preset = '7d';
    if (settingsData && settingsData.delta_preset) {
        preset = settingsData.delta_preset;
    } else {
        const saved = localStorage.getItem('deltaRangePreset');
        if (saved) preset = saved;
    }
    
    setDropdownValue('deltaRangeWrapper', preset);
    document.getElementById('deltaRange').value = preset;
    deltaRangeDays = DELTA_PRESETS[preset] || 7;
}

let currentSort = {field: 'device', asc: true};

function sortDisks(field) {
    // Toggle direction if same field
    if (currentSort.field === field) {
        currentSort.asc = !currentSort.asc;
    } else {
        currentSort.field = field;
        currentSort.asc = true;
    }
    
    // Re-render with new sort
    renderData();
    
    // Update sort icons
    document.querySelectorAll('.sort-icon').forEach(i => i.textContent = '⇅');
    document.querySelectorAll('.sortable').forEach(th => {
        if (th.textContent.toLowerCase().includes(field)) {
            th.querySelector('.sort-icon').textContent = currentSort.asc ? '↑' : '↓';
        }
    });
}

function getSortValue(disk, field) {
    const attrs = disk.smart_attributes || {};
    switch(field) {
        case 'device':
            return disk.device || '';
        case 'type':
            const typeOrder = {'NVMe': 0, 'SSD': 1, 'HDD': 2, 'Unknown': 3};
            return typeOrder[disk.type] ?? 3;
        case 'model': return disk.model || '';
        case 'serial': return disk.serial || '';
        case 'size': return disk.capacity_bytes || 0;
        case 'hours': return parseInt(attrs.Power_On_Hours || 0);
        case 'temp': return parseInt(attrs.Temperature_Celsius || attrs.Airflow_Temperature_Cel || attrs.Temperature || 0);
        case 'since':
            const diskId = disk.disk_id || disk.serial;
            const hist = historyCache[diskId] || {};
            const first = hist._first || '';
            return first ? new Date(first).getTime() : 0;
        case 'last':
            return disk.timestamp ? new Date(disk.timestamp.replace(' ', 'T') + 'Z').getTime() : 0;
        case 'status': 
            const statusOrder = {'critical': 0, 'warning': 1, 'ok': 2};
            return statusOrder[disk.status] ?? 2;
        default: return 0;
    }
}

function sortedDisks(disks) {
    return [...disks].sort((a, b) => {
        let va = getSortValue(a, currentSort.field);
        let vb = getSortValue(b, currentSort.field);
        let cmp = 0;
        if (typeof va === 'string') cmp = va.localeCompare(vb);
        else cmp = va - vb;
        return currentSort.asc ? cmp : -cmp;
    });
}

// --- Auto-Refresh ---
let refreshTimer = null;

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    const seconds = parseInt(localStorage.getItem('refreshInterval') || '60');
    if (seconds > 0) {
        refreshTimer = setInterval(loadData, seconds * 1000);
    }
}

function saveRefreshInterval() {
    const val = document.getElementById('refreshIntervalSelect').value;
    localStorage.setItem('refreshInterval', val);
    startAutoRefresh();
}

async function saveRetention() {
    const val = parseInt(document.getElementById('retentionSelect').value);
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({retention_days: val})
        });
    } catch (e) {
        console.error('Failed to save retention:', e);
    }
}

async function saveRateLimit() {
    const maxReq = parseInt(document.getElementById('rateLimitMax').value) || 10;
    const window = parseInt(document.getElementById('rateLimitWindow').value) || 60;
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({rate_limit: {max_requests: maxReq, window_seconds: window}})
        });
        const result = await res.json();
        if (result.success) {
            // Visual feedback
            const inputs = document.querySelectorAll('.settings-number-input');
            inputs.forEach(inp => {
                inp.style.borderColor = 'var(--success)';
                setTimeout(() => inp.style.borderColor = '', 1500);
            });
        }
    } catch (e) {
        console.error('Failed to save rate limit:', e);
    }
}

function toggleTokenVisibility() {
    const input = document.getElementById('pushTokenInput');
    const eyeShow = document.getElementById('tokenEyeShow');
    const eyeHide = document.getElementById('tokenEyeHide');
    const showing = input.type === 'password';
    input.type = showing ? 'text' : 'password';
    eyeShow.style.display = showing ? 'none' : '';
    eyeHide.style.display = showing ? '' : 'none';
}

function generateToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const arr = new Uint8Array(14);
    crypto.getRandomValues(arr);
    const token = Array.from(arr, b => chars[b % chars.length]).join('');
    const input = document.getElementById('pushTokenInput');
    input.value = token;
    input.type = 'text';
    document.getElementById('tokenEyeShow').style.display = 'none';
    document.getElementById('tokenEyeHide').style.display = '';
    savePushToken();
}

function copyToken() {
    const input = document.getElementById('pushTokenInput');
    const val = input.value;
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {
        const btn = document.getElementById('copyTokenBtn');
        const originalColor = btn.style.color;
        btn.style.color = 'var(--success)';
        setTimeout(() => { btn.style.color = originalColor; }, 1200);
    });
}

async function savePushToken() {
    const token = document.getElementById('pushTokenInput').value;
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({push_token: token})
        });
        const result = await res.json();
        if (result.success) {
            settingsData.push_token_set = token.length > 0;
            const input = document.getElementById('pushTokenInput');
            input.style.borderColor = 'var(--success)';
            setTimeout(() => input.style.borderColor = '', 1500);
        }
    } catch (e) {
        console.error('Failed to save push token:', e);
    }
}

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? '' : 'dark');
    document.getElementById('themeSun').style.display = isDark ? '' : 'none';
    document.getElementById('themeMoon').style.display = isDark ? 'none' : '';
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

// --- Settings Panel ---

// --- Alerts Panel ---
let alertsData = [];
let alertsUnread = -1;
let alertsFilter = 'all';

const FRIENDLY_ATTR_NAMES = {
    'Temperature_Celsius': 'Temp',
    'Airflow_Temperature_Cel': 'Airflow Temp',
    'Temperature': 'Temp',
    'Reallocated_Sector_Ct': 'Reallocated Sectors',
    'Current_Pending_Sector': 'Pending Sectors',
    'Offline_Uncorrectable': 'Offline Uncorrectable',
    'Command_Timeout': 'Command Timeouts',
    'UDMA_CRC_Error_Count': 'CRC Errors',
    'Reported_Uncorrect': 'Reported Uncorrectable',
    'Power_Off_Retract_Count': 'Power-Off Retracts',
    'Unsafe_Shutdowns': 'Unsafe Shutdowns',
    'Error_Information_Log_Entries': 'Error Log Entries',
    'Media_and_Data_Integrity_Errors': 'Media Errors',
    'Critical_Warning': 'Critical Warning',
    'Percentage_Used': 'Wear %',
    'Available_Spare': 'Spare %',
};

const TEMP_ATTRS = new Set(['Temperature_Celsius', 'Airflow_Temperature_Cel', 'Temperature']);

function friendlyAlertMsg(alert) {
    const attr = alert.attribute || '';
    const friendly = FRIENDLY_ATTR_NAMES[attr] || attr;
    
    if (alert.alert_type === 'smart_status') {
        return alert.new_value === 'FAILED' ? 'SMART Failed' : 'SMART Recovered';
    }
    
    if (alert.alert_type === 'disk_status_change') {
        // Extract reason from message: "Disk status: x → y (reason) — disk info"
        const reasonMatch = (alert.message || '').match(/\(([^)]+)\)/);
        const reason = reasonMatch ? reasonMatch[1] : '';
        let text = `Status: ${alert.old_value} → ${alert.new_value}`;
        if (reason) text += ` (${reason})`;
        return text;
    }
    
    if (alert.alert_type === 'temperature') {
        const temp = alert.new_value;
        const ref = alert.old_value;
        const deviation = (parseFloat(temp) - parseFloat(ref)).toFixed(0);
        if (alert.message && alert.message.includes('ceiling')) {
            return `🌡️ ${temp}°C (ceiling ${ref}°C)`;
        }
        return `🌡️ ${temp}°C (avg ${ref}°C, +${deviation}°C)`;
    }
    
    const unit = TEMP_ATTRS.has(attr) ? '°C' : '';
    
    if (alert.alert_type === 'cumulative_burst') {
        const delta = (parseFloat(alert.new_value) - parseFloat(alert.old_value));
        return `${friendly}: +${Math.round(delta)} (now ${alert.new_value}${unit})`;
    }
    
    return `${friendly}: ${alert.old_value} → ${alert.new_value}${unit}`;
}

function friendlyDiskInfo(alert) {
    // Extract from message: everything after " — "
    const parts = (alert.message || '').split(' — ');
    return parts[1] || '';
}

function toggleAlerts() {
    const overlay = document.getElementById('alertsOverlay');
    const isOpen = overlay.classList.contains('open');
    if (!isOpen) {
        overlay.classList.add('open');
        loadAlerts();
    } else {
        overlay.classList.remove('open');
    }
}

async function loadAlerts() {
    try {
        const res = await fetch('/api/alerts?limit=200');
        const data = await res.json();
        alertsData = data.alerts || [];
        alertsUnread = data.unread || 0;
        renderAlerts();
        updateAlertBadge();
    } catch (e) {
        console.error('Failed to load alerts:', e);
    }
}

async function loadAlertBadge() {
    try {
        const res = await fetch('/api/alerts?limit=1');
        const data = await res.json();
        const prevUnread = alertsUnread;
        alertsUnread = data.unread || 0;
        updateAlertBadge();
        // Play sound if new alerts appeared and severity meets threshold
        if (alertsUnread > prevUnread && prevUnread >= 0) {
            const snd = settingsData?.panel?.alert_sound || 'off';
            const maxSev = data.max_severity;
            const sevRank = { info: 1, warning: 2, critical: 3 };
            const threshold = sevRank[snd] || 0;
            if (threshold > 0 && (sevRank[maxSev] || 0) >= threshold) {
                playAlertSound();
            }
        }
    } catch (e) { /* silent */ }
}

function updateAlertBadge() {
    const badge = document.getElementById('alertBadge');
    if (alertsUnread > 0) {
        badge.textContent = alertsUnread > 99 ? '99+' : alertsUnread;
    } else {
        badge.textContent = '';
    }
}

function filterAlerts(sev) {
    alertsFilter = sev;
    document.querySelectorAll('.alerts-filter-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.sev === sev);
    });
    // Persist tab selection
    if (settingsData?.panel) settingsData.panel.alert_filter_tab = sev;
    fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ panel: { ...settingsData?.panel, alert_filter_tab: sev } }),
    }).catch(() => {});
    renderAlerts();
}

function renderAlerts() {
    const body = document.getElementById('alertsBody');
    const empty = document.getElementById('alertsEmpty');
    const countEl = document.getElementById('alertsHeaderCount');
    const ackBtn = document.getElementById('alertsAckAll');
    
    // Count by severity
    const counts = { all: alertsData.length, critical: 0, warning: 0, info: 0, recovery: 0 };
    alertsData.forEach(a => { if (counts[a.severity] !== undefined) counts[a.severity]++; });
    
    // Update filter tab counts
    for (const [sev, count] of Object.entries(counts)) {
        const el = document.getElementById('alertCount' + sev.charAt(0).toUpperCase() + sev.slice(1));
        if (el) el.textContent = count || '';
    }
    
    // Filter
    const filtered = alertsFilter === 'all'
        ? alertsData
        : alertsData.filter(a => a.severity === alertsFilter);
    
    if (!filtered.length) {
        empty.style.display = '';
        countEl.textContent = alertsUnread > 0 ? `(${alertsUnread} unread)` : '';
        ackBtn.disabled = alertsUnread === 0;
        body.querySelectorAll('.alert-item').forEach(el => el.remove());
        return;
    }
    
    empty.style.display = 'none';
    countEl.textContent = alertsUnread > 0 ? `(${alertsUnread} unread)` : '';
    ackBtn.disabled = alertsUnread === 0;
    
    // Build items
    const fragment = document.createDocumentFragment();
    for (const alert of filtered) {
        const el = document.createElement('div');
        el.className = 'alert-item' + (alert.acknowledged ? '' : ' unread');
        if (alert.disk_id) el.style.cursor = 'pointer';
        
        const msg = friendlyAlertMsg(alert);
        const disk = friendlyDiskInfo(alert);
        
        el.innerHTML = `
            <div class="alert-dot ${alert.severity}"></div>
            <div class="alert-content">
                <div class="alert-msg">${escapeHtml(msg)}</div>
                <div class="alert-meta">
                    <span>${formatAge(alert.timestamp)}</span>
                    <span>${escapeHtml(disk)}</span>
                </div>
            </div>
            <span class="alert-sev ${alert.severity}">${alert.severity}</span>
        `;
        if (alert.disk_id) {
            el.onclick = () => navigateToDisk(alert.disk_id);
        }
        fragment.appendChild(el);
    }
    
    // Replace content
    body.querySelectorAll('.alert-item').forEach(el => el.remove());
    body.appendChild(fragment);
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

async function acknowledgeAllAlerts() {
    try {
        await fetch('/api/alerts/acknowledge', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ all: true })
        });
        // Update local state
        alertsData.forEach(a => a.acknowledged = true);
        alertsUnread = 0;
        renderAlerts();
        updateAlertBadge();
    } catch (e) {
        console.error('Failed to acknowledge alerts:', e);
    }
}

// --- Settings Panel (cont.) ---

function toggleSettings(tab = 'general') {
    const overlay = document.getElementById('settingsOverlay');
    const isOpen = overlay.classList.contains('open');
    if (!isOpen) {
        overlay.classList.add('open');
        switchSettingsTab(tab);
        loadSettings();
    } else {
        overlay.classList.remove('open');
        // Reset to narrow width when closing
        document.getElementById('settingsPanel').classList.remove('wide');
    }
}

function switchSettingsTab(tab) {
    const panel = document.getElementById('settingsPanel');
    
    // Update tab buttons
    document.querySelectorAll('.settings-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    
    // Update tab content
    document.getElementById('tabGeneral').classList.toggle('active', tab === 'general');
    document.getElementById('tabThresholds').classList.toggle('active', tab === 'thresholds');
    document.getElementById('tabNotifications').classList.toggle('active', tab === 'notifications');
    
    // Adjust panel width
    if (tab === 'thresholds') {
        panel.classList.add('wide');
        renderThresholdEditor();
    } else {
        panel.classList.remove('wide');
    }
    
    if (tab === 'notifications') {
        loadNotifySettings();
    }
}

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        settingsData = await res.json();
        renderHosts();
        tempUnit = settingsData.temp_unit || 'C';
        setDropdownValue('tempUnitWrapper', tempUnit);
        setDropdownValue('refreshIntervalWrapper', localStorage.getItem('refreshInterval') || '60');
        setDropdownValue('retentionWrapper', String(settingsData.retention_days || 365));
        // Rate limit settings
        const rateLimit = settingsData.rate_limit || {max_requests: 10, window_seconds: 60};
        document.getElementById('rateLimitMax').value = rateLimit.max_requests;
        document.getElementById('rateLimitWindow').value = rateLimit.window_seconds;
        // Show placeholder based on whether token is set
        const tokenInput = document.getElementById('pushTokenInput');
        tokenInput.value = '';
        tokenInput.placeholder = settingsData.push_token_set ? '••••••••  (token set)' : 'No token set';
        updatePresetDropdown();
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function renderHosts() {
    const container = document.getElementById('hostsList');
    if (!container) return;
    const hosts = settingsData.hosts || [];
    const stats = settingsData.host_stats || {};
    if (hosts.length === 0) {
        container.innerHTML = '<div style="font-size:12px;color:#999;padding:4px 0">No hosts configured</div>';
        return;
    }
    container.innerHTML = hosts.map((h, i) => {
        const s = stats[h];
        let info = '<span class="host-status host-new">new</span>';
        if (s) {
            const ago = timeAgo(s.last_seen);
            info = `<span class="host-meta">${s.disk_count} disk${s.disk_count !== 1 ? 's' : ''} · ${ago}</span>`;
        }
        return `<div class="host-row"><span class="host-addr">${h}</span>${info}<button class="host-remove" onclick="removeHost(${i})" title="Remove">✕</button></div>`;
    }).join('');
}

function timeAgo(ts) {
    return formatAge(ts);
}

async function addHost() {
    const input = document.getElementById('hostInput');
    const host = input.value.trim();
    if (!host) return;
    const hosts = [...(settingsData.hosts || [])];
    if (hosts.includes(host)) { input.value = ''; return; }
    hosts.push(host);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hosts})
        });
        const result = await res.json();
        if (result.success) {
            settingsData.hosts = result.hosts || hosts;
            renderHosts();
            input.value = '';
        }
    } catch (e) { console.error('Failed to add host:', e); }
}

async function removeHost(idx) {
    const hosts = [...(settingsData.hosts || [])];
    hosts.splice(idx, 1);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hosts})
        });
        const result = await res.json();
        if (result.success) {
            settingsData.hosts = result.hosts || hosts;
            renderHosts();
        }
    } catch (e) { console.error('Failed to remove host:', e); }
}

async function removeHostByName(hostname) {
    const btn = event.target;
    
    // First click: show confirmation state
    if (!btn.classList.contains('confirming')) {
        btn.classList.add('confirming');
        btn.innerHTML = 'Remove?';
        btn.title = 'Click again to confirm';
        
        // Click anywhere else cancels
        const cancelHandler = (e) => {
            if (e.target !== btn) {
                btn.classList.remove('confirming');
                btn.innerHTML = '✕';
                btn.title = 'Remove host';
                document.removeEventListener('click', cancelHandler, true);
            }
        };
        setTimeout(() => document.addEventListener('click', cancelHandler, true), 0);
        return;
    }
    
    // Second click: actually remove
    btn.classList.remove('confirming');
    btn.innerHTML = '...';
    
    const hosts = (settingsData.hosts || []).filter(h => h !== hostname);
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hosts})
        });
        const result = await res.json();
        if (result.success) {
            settingsData.hosts = result.hosts || hosts;
            await loadData();
        }
    } catch (e) { 
        console.error('Failed to remove host:', e);
        btn.innerHTML = '✕';
    }
}

async function approvePushHost(ip, action) {
    try {
        const res = await fetch('/api/push-approve', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({host: ip, action})
        });
        const result = await res.json();
        if (result.success) {
            if (action === 'accept') {
                // Reload settings to get updated host list
                const settingsRes = await fetch('/api/settings');
                settingsData = await settingsRes.json();
            }
            await loadData();
        }
    } catch (e) {
        console.error('Failed to approve/dismiss host:', e);
    }
}

let pendingArchiveDiskId = null;

function archiveDisk(diskId) {
    pendingArchiveDiskId = diskId;
    document.getElementById('archiveModal').classList.add('visible');
}

function closeArchiveModal() {
    document.getElementById('archiveModal').classList.remove('visible');
    pendingArchiveDiskId = null;
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('archiveModal').classList.contains('visible')) {
        closeArchiveModal();
    }
});

async function confirmArchive() {
    if (!pendingArchiveDiskId) return;
    const diskId = pendingArchiveDiskId;
    closeArchiveModal();
    
    try {
        const res = await fetch('/api/disk/archive', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({disk_id: diskId})
        });
        const result = await res.json();
        if (result.success) {
            await loadData();
        }
    } catch (e) {
        console.error('Failed to archive disk:', e);
    }
}

async function restoreDisk(diskId) {
    try {
        const res = await fetch('/api/disk/unarchive', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({disk_id: diskId})
        });
        const result = await res.json();
        if (result.success) {
            await loadData();
        }
    } catch (e) {
        console.error('Failed to restore disk:', e);
    }
}

function showHostEdit(hostIp) {
    const id = hostIp.replace(/\\./g, '-');
    const display = document.getElementById('hostDisplay-' + id);
    const form = document.getElementById('hostEdit-' + id);
    const actions = document.getElementById('hostActions-' + id);
    const badge = document.getElementById('hostBadge-' + id);
    if (display && form) {
        display.style.display = 'none';
        form.style.display = 'inline-flex';
        if (actions) actions.style.display = 'none';
        if (badge) badge.style.display = 'none';
        form.querySelector('.host-edit-ip').focus();
    }
}

function hideHostEdit(hostIp) {
    const id = hostIp.replace(/\\./g, '-');
    const display = document.getElementById('hostDisplay-' + id);
    const form = document.getElementById('hostEdit-' + id);
    const actions = document.getElementById('hostActions-' + id);
    const badge = document.getElementById('hostBadge-' + id);
    if (display && form) {
        display.style.display = '';
        form.style.display = 'none';
        if (actions) actions.style.display = '';
        if (badge) badge.style.display = '';
    }
}

async function saveHostEdit(oldIp) {
    const id = oldIp.replace(/\\./g, '-');
    const form = document.getElementById('hostEdit-' + id);
    if (!form) return;
    
    const newMethod = form.querySelector('.host-edit-method-val').value;
    const newUser = form.querySelector('.host-edit-user').value.trim();
    const newIp = form.querySelector('.host-edit-ip').value.trim();
    const newPort = form.querySelector('.host-edit-port')?.value.trim() || '';
    
    if (!newIp) {
        hideHostEdit(oldIp);
        return;
    }
    
    // Find current entry in config
    const hosts = [...(settingsData.hosts || [])];
    const idx = hosts.findIndex(h => {
        let rest = h;
        if (h.startsWith('push:')) rest = h.slice(5);
        else if (h.startsWith('ssh:')) rest = h.slice(4);
        let ip = rest.includes('@') ? rest.split('@')[1] : rest;
        // Strip port for comparison
        ip = ip.split(':')[0];
        return ip === oldIp;
    });
    if (idx === -1) return;
    
    // Build new entry with method prefix
    let newEntry;
    if (newMethod === 'push') {
        newEntry = `push:${newIp}`;
    } else {
        if (!newUser) { form.querySelector('.host-edit-user').focus(); return; }
        newEntry = `ssh:${newUser}@${newIp}`;
        if (newPort && newPort !== '22') {
            newEntry += `:${newPort}`;
        }
    }
    
    if (newEntry === hosts[idx]) {
        hideHostEdit(oldIp);
        return; // No change
    }
    
    hosts[idx] = newEntry;
    
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hosts})
        });
        const result = await res.json();
        if (result.success) {
            settingsData.hosts = result.hosts || hosts;
            await loadData();
        }
    } catch (e) {
        console.error('Failed to update host:', e);
        hideHostEdit(oldIp);
    }
}

async function rescanHost(hostname) {
    const btn = event.target;
    btn.classList.add('spinning');
    
    try {
        await fetch('/api/collect', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({host: hostname})
        });
        await loadData();
    } catch (e) {
        console.error('Failed to rescan host:', e);
    } finally {
        btn.classList.remove('spinning');
    }
}

async function refreshAllHosts() {
    const btn = event.target;
    btn.classList.add('spinning');
    
    // Get filtered hosts (respects host filter), skip push hosts
    const hostFilter = document.getElementById('hostFilter').value;
    const allHosts = hostFilter ? [hostFilter] : (data.hosts || []);
    
    // Build config map for method check
    const cfgMap = {};
    (settingsData?.hosts || []).forEach(h => {
        let method = 'ssh', rest = h;
        if (h.startsWith('push:')) { method = 'push'; rest = h.slice(5); }
        else if (h.startsWith('ssh:')) { rest = h.slice(4); }
        const ip = rest.includes('@') ? rest.split('@')[1] : rest;
        cfgMap[ip] = { method, full: h };
    });
    
    const sshHosts = allHosts.filter(h => (cfgMap[h]?.method || 'ssh') === 'ssh');
    
    try {
        for (const host of sshHosts) {
            const entry = cfgMap[host]?.full || host;
            await fetch('/api/collect', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({host: entry})
            });
        }
        await loadData();
    } catch (e) {
        console.error('Failed to refresh hosts:', e);
    } finally {
        btn.classList.remove('spinning');
    }
}

function showAddHostInput() {
    document.getElementById('addHostBtn').style.display = 'none';
    document.getElementById('addHostInline').style.display = 'flex';
    setAddMethod('ssh');
    document.getElementById('addHostUser').value = '';
    document.getElementById('addHostPort').value = '';
    const input = document.getElementById('addHostInput');
    input.value = '';
    input.focus();
}

function hideAddHostInput() {
    document.getElementById('addHostBtn').style.display = '';
    document.getElementById('addHostInline').style.display = 'none';
    document.getElementById('addHostUser').value = '';
    document.getElementById('addHostInput').value = '';
    document.getElementById('addHostPort').value = '';
}

function toggleAddUserField(method) {
    const sshFields = document.getElementById('addHostSshFields');
    const portField = document.getElementById('addHostPortField');
    sshFields.style.display = method === 'push' ? 'none' : '';
    portField.style.display = method === 'push' ? 'none' : '';
}

function setAddMethod(method) {
    document.getElementById('addHostMethod').value = method;
    const btns = document.querySelectorAll('#addHostMethodToggle .method-toggle-btn');
    btns.forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === method));
    toggleAddUserField(method);
}

function setEditMethod(hostIp, method) {
    const id = hostIp.replace(/\\./g, '-');
    const form = document.getElementById('hostEdit-' + id);
    if (!form) return;
    form.querySelector('.host-edit-method-val').value = method;
    const btns = form.querySelectorAll('.method-toggle-btn');
    btns.forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === method));
    const sshFields = document.getElementById('hostEditSsh-' + id);
    const portFields = document.getElementById('hostEditPort-' + id);
    if (sshFields) sshFields.style.display = method === 'push' ? 'none' : '';
    if (portFields) portFields.style.display = method === 'push' ? 'none' : '';
}

function handleAddHostKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        addHostFromInput();
    } else if (event.key === 'Escape') {
        hideAddHostInput();
    }
}

async function addHostFromInput() {
    const methodSelect = document.getElementById('addHostMethod');
    const userInput = document.getElementById('addHostUser');
    const hostInput = document.getElementById('addHostInput');
    const portInput = document.getElementById('addHostPort');
    const method = methodSelect.value;
    const user = userInput.value.trim();
    const ip = hostInput.value.trim();
    const port = portInput.value.trim();
    if (!ip) return;
    
    // Format: "push:host" or "ssh:user@host" or "ssh:user@host:port"
    let hostEntry;
    if (method === 'push') {
        hostEntry = `push:${ip}`;
    } else {
        if (!user) { userInput.focus(); return; }
        hostEntry = `ssh:${user}@${ip}`;
        if (port && port !== '22') {
            hostEntry += `:${port}`;
        }
    }
    
    const hosts = [...(settingsData.hosts || [])];
    // Check if host already exists
    const existingIp = hosts.find(h => {
        let rest = h;
        if (h.startsWith('push:')) rest = h.slice(5);
        else if (h.startsWith('ssh:')) rest = h.slice(4);
        // Extract just the IP/hostname (before any port)
        const hostPart = rest.includes('@') ? rest.split('@')[1] : rest;
        const existingHost = hostPart.split(':')[0];
        return existingHost === ip;
    });
    if (existingIp) { 
        hideAddHostInput();
        return; 
    }
    hosts.push(hostEntry);
    
    // Clear input immediately and show scanning state
    userInput.value = '';
    hostInput.value = '';
    const btn = document.querySelector('.add-host-confirm');
    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    
    try {
        // First save the host to config
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hosts})
        });
        const result = await res.json();
        if (result.success) {
            settingsData.hosts = result.hosts || hosts;
            
            // Only trigger SSH fetch for SSH hosts
            if (method === 'ssh') {
                try {
                    await fetch('/api/collect', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({host: hostEntry})
                    });
                } catch (e) {
                    console.warn('Fetch failed:', e);
                }
            }
            
            // Refresh data to show new host
            await loadData();
            hideAddHostInput();
        }
    } catch (e) { 
        console.error('Failed to add host:', e); 
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function saveTempUnit() {
    const val = document.getElementById('tempUnitSelect').value;
    tempUnit = val;
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({temp_unit: val})
        });
        renderData(); // Re-render to show new unit
    } catch (e) { console.error('Failed to save temp unit:', e); }
}

async function setPreset(name) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({threshold_preset: name})
        });
        const result = await res.json();
        if (result.success) {
            // Update settingsData immediately with new preset
            if (settingsData) settingsData.active_preset = name;
            await loadSettings();
            loadData(); // Re-classify all disks with new thresholds
        }
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

async function changePreset(name) {
    // Immediately update UI
    document.getElementById('presetFilter').value = name;
    
    await setPreset(name);
}

function updatePresetDropdown() {
    if (settingsData && settingsData.active_preset) {
        setDropdownValue('presetFilterWrapper', settingsData.active_preset);
        document.getElementById('presetFilter').value = settingsData.active_preset;
    }
}

// Threshold Editor
const THRESHOLD_ATTRS = {
    ata: [
        { key: 'Reallocated_Sector_Ct', label: 'Reallocated Sectors', id: 5 },
        { key: 'Reported_Uncorrect', label: 'Reported Uncorrectable', id: 187 },
        { key: 'Command_Timeout', label: 'Command Timeout', id: 188 },
        { key: 'Current_Pending_Sector', label: 'Current Pending Sectors', id: 197 },
        { key: 'Offline_Uncorrectable', label: 'Offline Uncorrectable', id: 198 },
        { key: 'Temperature_Celsius', label: 'Temperature', id: 194, unit: '°C' },
    ],
    nvme: [
        { key: 'Critical_Warning', label: 'Critical Warning' },
        { key: 'Media_and_Data_Integrity_Errors', label: 'Media Errors' },
        { key: 'Available_Spare', label: 'Available Spare', unit: '%', defaultOp: '<' },
        { key: 'Percentage_Used', label: 'Percentage Used', unit: '%' },
        { key: 'Error_Information_Log_Entries', label: 'Error Log Entries' },
        { key: 'Unsafe_Shutdowns', label: 'Unsafe Shutdowns' },
        { key: 'Temperature', label: 'Temperature', unit: '°C' },
    ]
};

const PRESET_HINTS = {
    relaxed: 'Relaxed: Higher thresholds for home/lab use. Fewer false positives, alerts only on clear degradation.',
    conservative: 'Conservative: Stricter thresholds for important data. Earlier warnings for proactive replacement.',
    backblaze: 'Backblaze: Based on failure data from 300k+ drives. Balanced sensitivity, industry standard.',
    custom: 'Custom: Your own threshold values. Edit the fields below to customize.'
};

let thresholdPresets = {};

function toggleThresholdEditor() {
    // Open settings panel with thresholds tab
    const overlay = document.getElementById('settingsOverlay');
    if (overlay.classList.contains('open')) {
        // Already open, just switch to thresholds tab
        switchSettingsTab('thresholds');
    } else {
        toggleSettings('thresholds');
    }
}

// --- Panel Settings ---

function loadPanelSettings() {
    if (!settingsData) return;
    const p = settingsData.panel || {};
    // Backwards compat: old boolean true → 'warning', false → 'off'
    let sndVal = p.alert_sound || 'off';
    if (sndVal === true || sndVal === 'true') sndVal = 'warning';
    if (sndVal === false || sndVal === 'false') sndVal = 'off';
    setDropdownValue('alertSoundWrapper', sndVal);
    setDropdownValue('alertRetentionWrapper', String(p.alert_retention_days || 14));
    // Restore alert filter tab
    if (p.alert_filter_tab) filterAlerts(p.alert_filter_tab);
}

async function savePanelSettings() {
    const payload = {
        panel: {
            alert_sound: document.getElementById('alertSoundLevel').value || 'off',
            alert_retention_days: parseFloat(document.getElementById('alertRetentionDays').value) || 14,
        }
    };
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (result.success) {
            settingsData.panel = payload.panel;
            loadAlerts();
        }
    } catch (e) {
        console.error('Failed to save panel settings:', e);
    }
}

// Alert sound: short beep via Web Audio API
function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 660;
        osc.type = 'sine';
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {}
}

// --- Notification Settings ---

let webhookUrls = [];  // [{url, enabled, service}, ...]
let webhookStatus = {};  // {url: {success, error, timestamp}}

const WH_SERVICES = {
    ntfy: { label: 'ntfy', placeholder: 'https://ntfy.sh/your-topic', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' },
    gotify: { label: 'Gotify', placeholder: 'https://gotify.example.com/message?token=...', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' },
    discord: { label: 'Discord', placeholder: 'https://discord.com/api/webhooks/...', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>' },
    slack: { label: 'Slack', placeholder: 'https://hooks.slack.com/services/...', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>' },
    pushover: { label: 'Pushover', placeholder: 'https://api.pushover.net/1/messages.json', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>' },
    telegram: { label: 'Telegram', placeholder: 'https://api.telegram.org/bot.../sendMessage', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>' },
    generic: { label: 'Generic', placeholder: 'https://example.com/webhook', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' },
};
const WH_SERVICE_KEYS = Object.keys(WH_SERVICES);
let selectedEndpointService = 'ntfy';

function parseWebhookUrls(raw) {
    return (raw || []).map(s => {
        let enabled = true;
        if (s.startsWith('!')) { enabled = false; s = s.slice(1); }
        for (const svc of WH_SERVICE_KEYS) {
            if (s.startsWith(svc + ':')) {
                return { url: s.slice(svc.length + 1), enabled, service: svc };
            }
        }
        return { url: s, enabled, service: _detectService(s) };
    });
}

function _detectService(url) {
    const lower = url.toLowerCase();
    if (lower.includes('ntfy')) return 'ntfy';
    if (lower.includes('gotify')) return 'gotify';
    if (lower.includes('discord.com/api/webhooks')) return 'discord';
    if (lower.includes('hooks.slack.com')) return 'slack';
    if (lower.includes('pushover.net')) return 'pushover';
    if (lower.includes('api.telegram.org')) return 'telegram';
    return 'generic';
}

function serializeWebhookUrls() {
    return webhookUrls.map(w => {
        const prefix = w.enabled ? '' : '!';
        return `${prefix}${w.service || 'generic'}:${w.url}`;
    });
}

function loadNotifySettings() {
    if (!settingsData) return;
    loadPanelSettings();
    const n = settingsData.notifications || {};
    // Alert thresholds/history for notifications
    setDropdownValue('alertThresholdWrapper', n.threshold_preset || 'backblaze');
    setDropdownValue('alertHistoryWrapper', n.history || '7d');
    // Push settings
    setDropdownValue('notifyMinSeverityWrapper', n.min_severity || 'warning');
    document.getElementById('notifyRecoveryToggle').checked = String(n.include_recovery || 'false').toLowerCase() === 'true';
    setDropdownValue('notifyCooldownWrapper', String(n.cooldown_minutes || 60));
    document.getElementById('notifyStatus').textContent = '';
    webhookUrls = parseWebhookUrls(settingsData.webhook_urls);
    loadWebhookStatus();
}

async function loadWebhookStatus() {
    try {
        const res = await fetch('/api/webhook-status');
        webhookStatus = await res.json();
    } catch (e) {
        webhookStatus = {};
    }
    renderWebhookUrls();
}

function formatTimeAgo(ts) {
    if (!ts) return '';
    const diff = (Date.now() - new Date(ts + 'Z').getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

async function saveNotifySettings() {
    const payload = {
        notifications: {
            threshold_preset: document.getElementById('alertThresholdPreset').value,
            history: document.getElementById('alertHistory').value,
            min_severity: document.getElementById('notifyMinSeveritySelect').value,
            include_recovery: document.getElementById('notifyRecoveryToggle').checked,
            cooldown_minutes: parseInt(document.getElementById('notifyCooldown').value) || 60,
        }
    };
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (result.success) {
            settingsData.notifications = payload.notifications;
        }
    } catch (e) {
        console.error('Failed to save notification settings:', e);
    }
}

async function saveWebhookUrls() {
    const serialized = serializeWebhookUrls();
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ webhook_urls: serialized }),
        });
        const result = await res.json();
        if (result.success) {
            settingsData.webhook_urls = serialized;
        }
    } catch (e) {
        console.error('Failed to save webhook URLs:', e);
    }
}

function renderWebhookUrls() {
    const container = document.getElementById('webhookUrlsList');
    if (!webhookUrls.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = webhookUrls.map((w, i) => {
        const st = webhookStatus[w.url];
        let statusHtml = '';
        if (st) {
            if (st.success) {
                statusHtml = `<span class="endpoint-status-ok">✓ ${formatTimeAgo(st.timestamp)}</span>`;
            } else {
                const errText = st.error ? ` — ${escapeHtml(st.error).substring(0, 20)}` : '';
                statusHtml = `<span class="endpoint-status-err">✗ ${formatTimeAgo(st.timestamp)}${errText}</span>`;
            }
        }
        const displayUrl = w.url.replace(/^https?:\/\//, '');
        const svc = w.service || 'generic';
        const svcData = WH_SERVICES[svc] || { label: svc, icon: '' };
        return `<div class="endpoint-card${w.enabled ? '' : ' disabled'}">
            <div class="endpoint-card-header">
                <span class="endpoint-card-icon">${svcData.icon}</span>
                <span class="endpoint-card-url" data-idx="${i}" onclick="startEditUrl(this, ${i})" title="Click to edit">${escapeHtml(displayUrl)}</span>
                <input type="text" class="endpoint-card-url-input" value="${escapeHtml(w.url)}" data-idx="${i}" onblur="finishEditUrl(${i}, this)" onkeydown="if(event.key==='Enter'){this.blur()}else if(event.key==='Escape'){cancelEditUrl(this)}" style="display:none" />
                <label class="wh-toggle"><input type="checkbox" ${w.enabled ? 'checked' : ''} onchange="toggleWebhookUrl(${i})"><span class="wh-slider"></span></label>
            </div>
            <div class="endpoint-card-footer">
                <span class="endpoint-card-status">${statusHtml || '<span class="endpoint-status-pending">Not tested</span>'}</span>
                <div class="endpoint-card-actions">
                    <button class="endpoint-action-btn" onclick="testWebhookUrl(${i})" title="Test">▶</button>
                    <button class="endpoint-action-btn endpoint-del-btn" data-idx="${i}" onclick="confirmRemoveWebhookUrl(this,${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function confirmRemoveWebhookUrl(btn, index) {
    if (btn.dataset.confirm === '1') {
        removeWebhookUrl(index);
        return;
    }
    btn.dataset.confirm = '1';
    btn.innerHTML = '?';
    btn.classList.add('endpoint-del-confirm');
    setTimeout(() => {
        if (btn.parentNode) {
            btn.dataset.confirm = '';
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            btn.classList.remove('endpoint-del-confirm');
        }
    }, 2000);
}

async function addWebhookUrl() {
    const input = document.getElementById('webhookUrlInput');
    const url = input.value.trim();
    if (!url) return;
    if (webhookUrls.some(w => w.url === url)) { input.value = ''; return; }
    webhookUrls.push({ url, enabled: true, service: selectedEndpointService });
    input.value = '';
    renderWebhookUrls();
    await saveWebhookUrls();
}

function selectEndpointService(service) {
    selectedEndpointService = service;
    const input = document.getElementById('webhookUrlInput');
    const svcData = WH_SERVICES[service] || {};
    input.placeholder = svcData.placeholder || '';
    input.value = svcData.label || service;
    input.classList.add('showing-service');
    // Update dropdown display with icon
    const trigger = document.querySelector('#endpointServiceWrapper .custom-select-value');
    if (trigger) trigger.innerHTML = `<span class="svc-icon">${svcData.icon || ''}</span>${svcData.label || service}`;
    // Update selected state
    document.querySelectorAll('#endpointServiceWrapper .custom-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === service);
    });
    document.getElementById('endpointServiceWrapper').classList.remove('open');
}

function onEndpointInputFocus() {
    const input = document.getElementById('webhookUrlInput');
    const svcData = WH_SERVICES[selectedEndpointService] || {};
    if (input.value === svcData.label || input.value === selectedEndpointService) {
        input.value = '';
    }
    input.classList.remove('showing-service');
}

function initEndpointServiceDropdown() {
    const container = document.getElementById('endpointServiceOptions');
    if (!container) return;
    container.innerHTML = WH_SERVICE_KEYS.map(key => {
        const svc = WH_SERVICES[key];
        const selected = key === 'ntfy' ? ' selected' : '';
        return `<div class="custom-select-option${selected}" data-value="${key}"><span class="svc-icon">${svc.icon}</span>${svc.label}</div>`;
    }).join('');
    // Set initial trigger display
    const trigger = document.querySelector('#endpointServiceWrapper .custom-select-value');
    if (trigger) trigger.innerHTML = `<span class="svc-icon">${WH_SERVICES.ntfy.icon}</span>ntfy`;
}

async function cycleWebhookService(index) {
    const current = webhookUrls[index].service || 'generic';
    const idx = WH_SERVICE_KEYS.indexOf(current);
    const next = WH_SERVICE_KEYS[(idx + 1) % WH_SERVICE_KEYS.length];
    webhookUrls[index].service = next;
    renderWebhookUrls();
    await saveWebhookUrls();
}

async function removeWebhookUrl(index) {
    webhookUrls.splice(index, 1);
    renderWebhookUrls();
    await saveWebhookUrls();
}

async function toggleWebhookUrl(index) {
    webhookUrls[index].enabled = !webhookUrls[index].enabled;
    renderWebhookUrls();
    await saveWebhookUrls();
}

async function updateWebhookUrl(index, newUrl) {
    newUrl = newUrl.trim();
    if (!newUrl || newUrl === webhookUrls[index].url) return;
    // Check for duplicates
    if (webhookUrls.some((w, i) => i !== index && w.url === newUrl)) {
        renderWebhookUrls(); // Reset to original
        return;
    }
    webhookUrls[index].url = newUrl;
    // Auto-detect service from new URL
    webhookUrls[index].service = _detectService(newUrl);
    // Clear old status since URL changed
    delete webhookStatus[newUrl];
    renderWebhookUrls();
    await saveWebhookUrls();
}

function startEditUrl(span, index) {
    const input = span.nextElementSibling;
    span.style.display = 'none';
    input.style.display = '';
    input.focus();
    input.select();
}

function finishEditUrl(index, input) {
    const newUrl = input.value.trim();
    input.style.display = 'none';
    input.previousElementSibling.style.display = '';
    if (newUrl && newUrl !== webhookUrls[index].url) {
        updateWebhookUrl(index, newUrl);
    }
}

function cancelEditUrl(input) {
    input.value = webhookUrls[input.dataset.idx].url;
    input.blur();
}

async function testWebhookUrl(index) {
    const w = webhookUrls[index];
    const statusEl = document.getElementById('notifyStatus');
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = 'Sending test…';
    try {
        const res = await fetch('/api/test-webhook', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ url: w.url, service: w.service || 'generic' }),
        });
        const result = await res.json();
        if (result.success) {
            statusEl.style.color = 'var(--success)';
            statusEl.textContent = '✓ Test sent';
            // Update inline status
            webhookStatus[w.url] = { success: true, error: '', timestamp: new Date().toISOString().replace('Z','') };
            renderWebhookUrls();
        } else {
            statusEl.style.color = 'var(--danger)';
            statusEl.textContent = '✗ ' + (result.error || 'Failed');
            webhookStatus[w.url] = { success: false, error: result.error || 'Failed', timestamp: new Date().toISOString().replace('Z','') };
            renderWebhookUrls();
        }
    } catch (e) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = '✗ Request failed';
    }
    setTimeout(() => statusEl.textContent = '', 3000);
}

function renderThresholdEditor() {
    if (!settingsData) return;
    
    thresholdPresets = settingsData.all_presets || {};
    
    // Editor starts with the currently active preset
    currentEditorPreset = currentEditorPreset || settingsData.active_preset || 'backblaze';
    
    // Load the preset data (user override if exists, else shipped)
    const presetData = getEditorPresetData(currentEditorPreset);
    
    // Render tables (always editable now)
    renderThresholdTable('ata', presetData.ata || {}, true);
    renderThresholdTable('nvme', presetData.nvme || {}, true);
    
    // Update UI
    updateEditorPresetButtons();
    updateEditorHint();
    updateResetButton();
}

function getEditorPresetData(presetName) {
    // Check for user override first
    const userOverrides = settingsData.user_overrides || {};
    if (presetName in userOverrides && userOverrides[presetName] !== null) {
        return userOverrides[presetName];
    }
    // Fall back to shipped preset
    return thresholdPresets[presetName] || {};
}

let currentEditorPreset = null;  // Which preset we're editing

function renderThresholdTable(type, thresholds, editable) {
    const tbody = document.querySelector(`#${type}Thresholds tbody`);
    const attrs = THRESHOLD_ATTRS[type];
    
    const opLabels = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '-': 'off' };
    
    let html = '';
    for (const attr of attrs) {
        const warn = (thresholds.warning || {})[attr.key] || {};
        const crit = (thresholds.critical || {})[attr.key] || {};
        const defaultOp = attr.defaultOp || '>';
        const disabledClass = editable ? '' : 'disabled';
        
        const warnOp = warn.op || (warn.value !== undefined ? defaultOp : '-');
        const critOp = crit.op || (crit.value !== undefined ? defaultOp : '-');
        
        const warnSelectId = `thresholdOp-${type}-warning-${attr.key}`;
        const critSelectId = `thresholdOp-${type}-critical-${attr.key}`;
        
        const buildOptions = (selectedOp) => {
            return ['>', '>=', '<', '<=', '-'].map(op => 
                `<div class="custom-select-option${op === selectedOp ? ' selected' : ''}" data-value="${op}">${opLabels[op]}</div>`
            ).join('');
        };
        
        html += `<tr data-attr="${attr.key}">
            <td>${attr.label}</td>
            <td>
                <div class="threshold-input">
                    <div class="custom-select ${disabledClass}" id="${warnSelectId}" data-type="${type}" data-level="warning" data-attr="${attr.key}" data-value="${warnOp}">
                        <div class="custom-select-trigger" onclick="toggleDropdown('${warnSelectId}')">
                            <span class="custom-select-value">${opLabels[warnOp]}</span>
                            <svg class="custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                        </div>
                        <div class="custom-select-options">${buildOptions(warnOp)}</div>
                    </div>
                    <input type="number" min="0" value="${warn.value ?? ''}" 
                        data-type="${type}" data-level="warning" data-attr="${attr.key}" data-field="value"
                        onchange="onThresholdChange()" ${!editable || warnOp === '-' ? 'disabled' : ''}>
                    ${attr.unit ? `<span class="unit">${attr.unit}</span>` : ''}
                </div>
            </td>
            <td>
                <div class="threshold-input">
                    <div class="custom-select ${disabledClass}" id="${critSelectId}" data-type="${type}" data-level="critical" data-attr="${attr.key}" data-value="${critOp}">
                        <div class="custom-select-trigger" onclick="toggleDropdown('${critSelectId}')">
                            <span class="custom-select-value">${opLabels[critOp]}</span>
                            <svg class="custom-select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                        </div>
                        <div class="custom-select-options">${buildOptions(critOp)}</div>
                    </div>
                    <input type="number" min="0" value="${crit.value ?? ''}" 
                        data-type="${type}" data-level="critical" data-attr="${attr.key}" data-field="value"
                        onchange="onThresholdChange()" ${!editable || critOp === '-' ? 'disabled' : ''}>
                    ${attr.unit ? `<span class="unit">${attr.unit}</span>` : ''}
                </div>
            </td>
        </tr>`;
    }
    tbody.innerHTML = html;
    
    // Attach click handlers to threshold select options
    tbody.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', function() {
            const wrapper = this.closest('.custom-select');
            if (wrapper.classList.contains('disabled')) return;
            const value = this.dataset.value;
            selectThresholdOp(wrapper.id, value);
        });
    });
}

function selectThresholdOp(wrapperId, value) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper || wrapper.classList.contains('disabled')) return;
    
    const opLabels = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '-': 'off' };
    
    // Update selected state
    wrapper.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    
    // Update displayed value
    wrapper.querySelector('.custom-select-value').textContent = opLabels[value];
    wrapper.dataset.value = value;
    
    // Close dropdown
    wrapper.classList.remove('open');
    
    // Enable/disable the adjacent input
    const input = wrapper.parentElement.querySelector('input');
    if (input) {
        input.disabled = value === '-';
    }
    
    // Trigger save
    onThresholdChange();
}

function onThresholdChange() {
    // Save after short delay
    clearTimeout(window._thresholdSaveTimeout);
    window._thresholdSaveTimeout = setTimeout(savePresetThresholds, 500);
}

function updateEditorPresetButtons() {
    const modifiedPresets = settingsData.modified_presets || [];
    document.querySelectorAll('.threshold-content .preset-btn').forEach(btn => {
        const preset = btn.dataset.preset;
        btn.classList.toggle('active', preset === currentEditorPreset);
        btn.classList.toggle('modified', modifiedPresets.includes(preset));
    });
}

function updateEditorHint() {
    document.getElementById('presetHint').textContent = PRESET_HINTS[currentEditorPreset] || '';
}

function updateResetButton() {
    const resetBtn = document.getElementById('resetPresetBtn');
    const modifiedPresets = settingsData.modified_presets || [];
    const canReset = currentEditorPreset !== 'custom' && modifiedPresets.includes(currentEditorPreset);
    resetBtn.style.display = canReset ? '' : 'none';
}

function selectEditorPreset(name) {
    currentEditorPreset = name;
    
    // Load the preset data (user override if exists, else shipped)
    const presetData = getEditorPresetData(name);
    
    // Render tables (always editable)
    renderThresholdTable('ata', presetData.ata || {}, true);
    renderThresholdTable('nvme', presetData.nvme || {}, true);
    
    // Update UI
    updateEditorPresetButtons();
    updateEditorHint();
    updateResetButton();
}

async function savePresetThresholds() {
    // Collect all threshold values from the form
    const thresholds = { ata: { warning: {}, critical: {} }, nvme: { warning: {}, critical: {} } };
    
    document.querySelectorAll('.threshold-input .custom-select:not(.disabled)').forEach(sel => {
        const type = sel.dataset.type;
        const level = sel.dataset.level;
        const attr = sel.dataset.attr;
        const op = sel.dataset.value;
        
        if (op !== '-') {
            const input = sel.parentElement.querySelector('input');
            const value = parseInt(input.value) || 0;
            const attrDef = THRESHOLD_ATTRS[type].find(a => a.key === attr);
            
            thresholds[type][level][attr] = {
                op: op,
                value: value,
                display: attrDef?.label?.toLowerCase() || attr.replace(/_/g, ' ').toLowerCase()
            };
            if (attrDef?.id) thresholds[type][level][attr].id = attrDef.id;
        }
    });
    
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ preset_thresholds: { preset: currentEditorPreset, thresholds: thresholds } })
        });
        const result = await res.json();
        if (result.saved_preset) {
            // Update local state
            settingsData.user_overrides = settingsData.user_overrides || {};
            settingsData.user_overrides[currentEditorPreset] = thresholds;
            settingsData.modified_presets = result.modified_presets || [];
            
            // Show status
            const statusEl = document.getElementById('thresholdStatus');
            statusEl.textContent = '✓ Saved';
            setTimeout(() => statusEl.textContent = '', 2000);
            
            // Update UI
            updateEditorPresetButtons();
            updateResetButton();
            
            // Reload disk data if editing the active preset
            if (currentEditorPreset === settingsData.active_preset) {
                loadData();
            }
        }
    } catch (e) {
        console.error('Failed to save thresholds:', e);
        const statusEl = document.getElementById('thresholdStatus');
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = '✗ Save failed';
        setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 3000);
    }
}

async function resetPresetToDefaults() {
    if (currentEditorPreset === 'custom') return;
    
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ reset_preset: currentEditorPreset })
        });
        const result = await res.json();
        if (result.reset_preset) {
            // Update local state
            settingsData.user_overrides = settingsData.user_overrides || {};
            settingsData.user_overrides[currentEditorPreset] = null;
            settingsData.modified_presets = result.modified_presets || [];
            
            // Reload the shipped preset data
            const presetData = thresholdPresets[currentEditorPreset] || {};
            renderThresholdTable('ata', presetData.ata || {}, true);
            renderThresholdTable('nvme', presetData.nvme || {}, true);
            
            // Show status
            const statusEl = document.getElementById('thresholdStatus');
            statusEl.textContent = '✓ Reset to defaults';
            setTimeout(() => statusEl.textContent = '', 2000);
            
            // Update UI
            updateEditorPresetButtons();
            updateResetButton();
            
            // Reload disk data if editing the active preset
            if (currentEditorPreset === settingsData.active_preset) {
                loadData();
            }
        }
    } catch (e) {
        console.error('Failed to reset preset:', e);
    }
}

// Init
if (localStorage.getItem('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    document.getElementById('themeSun').style.display = 'none';
    document.getElementById('themeMoon').style.display = '';
}
initEndpointServiceDropdown();
initDropdowns();
// Load settings to get delta range and preset, then load data
fetch('/api/settings').then(r => r.json()).then(s => {
    settingsData = s;
    restoreDeltaRange();
    updatePresetDropdown();
    loadData();
}).catch(() => {
    restoreDeltaRange();
    loadData();
});
// Restore refresh interval setting and start timer
const savedInterval = localStorage.getItem('refreshInterval') || '60';
document.getElementById('refreshIntervalSelect').value = savedInterval;
startAutoRefresh();
