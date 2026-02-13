"""
diskmind-core — Shared library for diskmind components.

Provides common utilities used by both diskmind-fetch and diskmind-view:
- Config parsing
- SMART attribute classification (thresholds, delta logic)
- Seagate composite value decoding
"""

import json
from datetime import datetime as _dt, timedelta as _td

VERSION = '1.6'


# ---------------------------------------------------------------------------
# SMART Attribute Constants
# ---------------------------------------------------------------------------

# Cumulative event counters - only show if delta > 0 in selected time range
# These are counters that accumulate over time; old values aren't necessarily concerning
CUMULATIVE_EVENT_ATTRS = {
    'Command_Timeout',
    'Reported_Uncorrect',
    'UDMA_CRC_Error_Count',
    'Unsafe_Shutdowns',
    'Error_Information_Log_Entries',
    'Power_Off_Retract_Count',
}

# Critical state attributes - always show regardless of delta
# These represent current state or irreversible damage
CRITICAL_STATE_ATTRS = {
    'Reallocated_Sector_Ct',
    'Current_Pending_Sector',
    'Offline_Uncorrectable',
    'Media_and_Data_Integrity_Errors',
    'Critical_Warning',
    'Percentage_Used',
    'Available_Spare',
}

# Temperature monitoring (Type E alerts — independent of disk status)
TEMPERATURE_ATTRS_ATA = ('Temperature_Celsius', 'Airflow_Temperature_Cel')
TEMPERATURE_ATTRS_NVME = ('Temperature',)
TEMP_HARD_CEILING_ATA = 55    # °C — always alert regardless of baseline
TEMP_HARD_CEILING_NVME = 70   # °C — NVMe runs hotter by design
TEMP_BASELINE_DAYS = 14       # rolling average window
TEMP_MIN_HISTORY_DAYS = 7     # minimum data before baseline alerts activate
TEMP_DEVIATION_INFO = 8       # °C above baseline
TEMP_DEVIATION_WARNING = 12
TEMP_DEVIATION_CRITICAL = 18


# ---------------------------------------------------------------------------
# Seagate Decoding
# ---------------------------------------------------------------------------

def decode_seagate_value(attr_name: str, raw_value) -> int:
    """Decode Seagate composite 48-bit raw values.

    Seagate packs multiple counters into raw values:
    - Command_Timeout (#188): low 16 bits = actual timeout count
    - Raw_Read_Error_Rate (#1): high 16 bits = error count
    - Seek_Error_Rate (#7): high 16 bits = error count
    """
    try:
        raw = int(raw_value)
    except (ValueError, TypeError):
        return 0

    if raw <= 65535:  # Not a composite value
        return raw

    if attr_name == 'Command_Timeout':
        return raw & 0xFFFF
    elif attr_name in ('Raw_Read_Error_Rate', 'Seek_Error_Rate'):
        return (raw >> 32) & 0xFFFF

    return raw


# ---------------------------------------------------------------------------
# Threshold Checking & Disk Classification
# ---------------------------------------------------------------------------

def check_threshold(attr_value, rule: dict) -> bool:
    """Check if an attribute value exceeds a threshold rule."""
    try:
        val = float(attr_value)
    except (ValueError, TypeError):
        return False

    op = rule.get('op', '>')
    threshold = rule.get('value', 0)

    if op == '>':
        return val > threshold
    elif op == '>=':
        return val >= threshold
    elif op == '<':
        return val < threshold
    elif op == '<=':
        return val <= threshold
    elif op == '==':
        return val == threshold
    return False


def get_disk_issues(r: dict, thresholds: dict, history: dict = None,
                    delta_days: float = None) -> list[dict]:
    """Get list of threshold violations for a disk, filtered by delta time range.

    Args:
        r: Disk reading dict
        thresholds: Threshold rules dict with 'ata' and 'nvme' keys
        history: History data for this disk (with deltas)
        delta_days: Time range in days (None or >= 36500 means all time)

    Returns:
        List of issues that should be shown based on:
        - Critical state attrs: always shown if threshold exceeded
        - Cumulative counters: only shown if delta > 0 in time range
    """
    attrs = r.get('smart_attributes', {})
    if isinstance(attrs, str):
        try:
            attrs = json.loads(attrs)
        except Exception:
            attrs = {}

    disk_type = (r.get('type') or '').strip()
    is_nvme = disk_type == 'NVMe'

    if is_nvme:
        rules = thresholds.get('nvme', {})
    else:
        rules = thresholds.get('ata', {})

    issues = []
    all_time = delta_days is None or delta_days >= 36500

    # SMART self-test failure is always critical
    if r.get('smart_status') not in ('PASSED', 'N/A', None):
        issues.append({'level': 'critical', 'text': 'SMART Failed'})

    def should_show_attr(attr_name: str) -> bool:
        """Determine if an attribute's issue should be shown based on delta filter."""
        if all_time:
            return True
        if attr_name in CRITICAL_STATE_ATTRS:
            return True
        if attr_name in CUMULATIVE_EVENT_ATTRS:
            if history and attr_name in history:
                attr_hist = history[attr_name]
                delta = attr_hist.get('delta', 0) if isinstance(attr_hist, dict) else 0
                return delta > 0
            return False
        return True

    # Temperature attributes don't affect disk status — handled by Type E alerts
    _temp_skip = set(TEMPERATURE_ATTRS_ATA + TEMPERATURE_ATTRS_NVME)

    # Check critical thresholds
    for attr_name, rule in rules.get('critical', {}).items():
        if attr_name.startswith('_') or attr_name in _temp_skip:
            continue
        val = attrs.get(attr_name)
        if val is not None:
            check_val = decode_seagate_value(attr_name, val) if not is_nvme else val
            if check_threshold(check_val, rule):
                if should_show_attr(attr_name):
                    display = rule.get('display', attr_name)
                    issues.append({'level': 'critical', 'attr': attr_name, 'text': f'{check_val} {display}'})

    # Check warning thresholds (skip if already critical for same attribute)
    critical_attrs = set(rules.get('critical', {}).keys())
    for attr_name, rule in rules.get('warning', {}).items():
        if attr_name.startswith('_') or attr_name in _temp_skip:
            continue
        if attr_name in critical_attrs:
            val = attrs.get(attr_name)
            if val is not None:
                check_val = decode_seagate_value(attr_name, val) if not is_nvme else val
                if check_threshold(check_val, rules['critical'][attr_name]):
                    continue
        val = attrs.get(attr_name)
        if val is not None:
            check_val = decode_seagate_value(attr_name, val) if not is_nvme else val
            if check_threshold(check_val, rule):
                if should_show_attr(attr_name):
                    display = rule.get('display', attr_name)
                    issues.append({'level': 'warning', 'attr': attr_name, 'text': f'{check_val} {display}'})

    return issues


def classify_disk(r: dict, thresholds: dict, history: dict = None,
                  delta_days: float = None) -> str:
    """Classify disk status based on visible issues (respecting delta filter).

    Returns 'critical', 'warning', or 'ok'.
    """
    issues = get_disk_issues(r, thresholds, history, delta_days)

    for issue in issues:
        if issue['level'] == 'critical':
            return 'critical'
    for issue in issues:
        if issue['level'] == 'warning':
            return 'warning'

    return 'ok'


# ---------------------------------------------------------------------------
# Threshold Loading (standalone, no dependency on diskmind-view)
# ---------------------------------------------------------------------------

DEFAULT_PRESET = 'backblaze'


def load_thresholds_from_dir(config_dir) -> dict:
    """Load active thresholds from a config directory.

    Reads config.yaml for preset selection, then resolves from
    thresholds.json (shipped defaults) merged with custom_thresholds.json (user overrides).

    Args:
        config_dir: Path to config/ directory (str or Path)

    Returns:
        Dict with 'ata' and 'nvme' threshold rules.
    """
    from pathlib import Path
    config_dir = Path(config_dir)

    # Read preset name from config
    config_path = config_dir / 'config.yaml'
    config = {}
    if config_path.exists():
        try:
            config = parse_simple_yaml(config_path.read_text())
        except IOError:
            pass
    preset_name = config.get('threshold_preset', DEFAULT_PRESET)

    return load_preset_thresholds(config_dir, preset_name)


def load_preset_thresholds(config_dir, preset_name: str) -> dict:
    """Load thresholds for a specific preset.
    
    Merges shipped defaults with user overrides from custom_thresholds.json.
    
    Args:
        config_dir: Path to config/ directory
        preset_name: Name of preset (relaxed, conservative, backblaze, custom)
    
    Returns:
        Dict with 'ata' and 'nvme' threshold rules.
    """
    from pathlib import Path
    config_dir = Path(config_dir)
    
    # Load shipped presets
    shipped = {}
    thresholds_path = config_dir / 'thresholds.json'
    if thresholds_path.exists():
        try:
            data = json.loads(thresholds_path.read_text())
            shipped = data.get('presets', {})
        except (json.JSONDecodeError, IOError):
            pass
    
    # Load user overrides
    user_overrides = {}
    custom_path = config_dir / 'custom_thresholds.json'
    if custom_path.exists():
        try:
            user_overrides = json.loads(custom_path.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    
    # Check if user has override for this preset
    if preset_name in user_overrides and user_overrides[preset_name] is not None:
        override = user_overrides[preset_name]
        return {'ata': override.get('ata', {}), 'nvme': override.get('nvme', {})}
    
    # Fall back to shipped preset
    if preset_name in shipped:
        p = shipped[preset_name]
        return {'ata': p.get('ata', {}), 'nvme': p.get('nvme', {})}
    
    # For 'custom' without saved data, or unknown preset, try default
    if DEFAULT_PRESET in shipped:
        p = shipped[DEFAULT_PRESET]
        return {'ata': p.get('ata', {}), 'nvme': p.get('nvme', {})}
    
    return {'ata': {}, 'nvme': {}}


# ---------------------------------------------------------------------------
# Alert Generation
# ---------------------------------------------------------------------------

# Set of attributes known to be composite Seagate values
SEAGATE_COMPOSITE_ATTRS = {'Command_Timeout', 'Raw_Read_Error_Rate', 'Seek_Error_Rate'}


def _fmt_val(v) -> str:
    """Format a numeric value: show as int if whole, else float."""
    try:
        f = float(v)
        return str(int(f)) if f == int(f) else str(f)
    except (ValueError, TypeError):
        return str(v)


def generate_alerts(conn, readings: list[dict], thresholds: dict,
                    timestamp: str) -> list[dict]:
    """Compare readings against previous state and generate alerts.

    Args:
        conn: SQLite connection (must have disk_status and alerts tables)
        readings: List of reading dicts (smart_attributes must be parsed dicts)
        thresholds: Threshold rules dict with 'ata' and 'nvme' keys
        timestamp: Current scan timestamp string

    Returns:
        List of newly created alert dicts (for optional notification sending).
    """
    cursor = conn.cursor()
    new_alerts = []

    for r in readings:
        disk_id = r.get('disk_id') or r.get('serial', '').strip()
        if not disk_id:
            continue

        host = r.get('host', '')
        model = r.get('model', 'Unknown')
        serial = r.get('serial', '')
        device = r.get('device', '')
        disk_type = (r.get('type') or '').strip()
        is_nvme = disk_type == 'NVMe'
        smart_status = r.get('smart_status', '')

        # Current attributes
        new_attrs = r.get('smart_attributes', {})
        if isinstance(new_attrs, str):
            try:
                new_attrs = json.loads(new_attrs)
            except Exception:
                new_attrs = {}

        # Load previous state
        cursor.execute(
            'SELECT smart_status, smart_attributes, status FROM disk_status WHERE disk_id = ?',
            (disk_id,))
        row = cursor.fetchone()

        if row is None:
            # First time — save snapshot, no alerts
            cursor.execute('''
                INSERT INTO disk_status (disk_id, smart_status, smart_attributes, status, updated_at)
                VALUES (?, ?, ?, ?, ?)
            ''', (disk_id, smart_status, json.dumps(new_attrs),
                  classify_disk(r, thresholds), timestamp))
            conn.commit()
            continue

        old_smart_status = row[0] or ''
        try:
            old_attrs = json.loads(row[1]) if row[1] else {}
        except (json.JSONDecodeError, TypeError):
            old_attrs = {}
        old_disk_status = row[2] or 'ok'
        new_disk_status = classify_disk(r, thresholds)

        disk_alerts = []

        # --- Type D: Disk Status Change (ok→warning, warning→critical, etc.) ---
        if new_disk_status != old_disk_status:
            status_rank = {'ok': 0, 'warning': 1, 'critical': 2}
            degraded = status_rank.get(new_disk_status, 0) > status_rank.get(old_disk_status, 0)

            # Build reason from current issues
            issues = get_disk_issues(r, thresholds)
            reason = ', '.join(i['text'] for i in issues) if issues else ''

            if degraded:
                sev = new_disk_status  # warning or critical
                msg = f'Disk status: {old_disk_status} → {new_disk_status}'
                if reason:
                    msg += f' ({reason})'
                msg += f' — {model} ({serial}) on {host} {device}'
                disk_alerts.append({
                    'alert_type': 'disk_status_change',
                    'severity': sev,
                    'attribute': 'disk_status',
                    'old_value': old_disk_status,
                    'new_value': new_disk_status,
                    'message': msg,
                })
            else:
                msg = f'Disk status: {old_disk_status} → {new_disk_status}'
                if reason:
                    msg += f' ({reason})'
                msg += f' — {model} ({serial}) on {host} {device}'
                disk_alerts.append({
                    'alert_type': 'disk_status_change',
                    'severity': 'recovery',
                    'attribute': 'disk_status',
                    'old_value': old_disk_status,
                    'new_value': new_disk_status,
                    'message': msg,
                })

        # --- Typ C: SMART Status Change ---
        if smart_status != old_smart_status and old_smart_status:
            if smart_status == 'FAILED':
                disk_alerts.append({
                    'alert_type': 'smart_status',
                    'severity': 'critical',
                    'attribute': 'smart_status',
                    'old_value': old_smart_status,
                    'new_value': smart_status,
                    'message': f'SMART Failed — {model} ({serial}) on {host} {device}',
                })
            elif old_smart_status == 'FAILED' and smart_status == 'PASSED':
                disk_alerts.append({
                    'alert_type': 'smart_status',
                    'severity': 'recovery',
                    'attribute': 'smart_status',
                    'old_value': old_smart_status,
                    'new_value': smart_status,
                    'message': f'SMART recovered — {model} ({serial}) on {host} {device}',
                })

        # --- Type A: State Attribute Changes (dashboard log only) ---
        # Monotonic counters that can never decrease (hardware constraint)
        MONOTONIC_ATTRS = {'Reallocated_Sector_Ct', 'Media_and_Data_Integrity_Errors', 'Percentage_Used'}
        for attr_name in CRITICAL_STATE_ATTRS:
            new_val = new_attrs.get(attr_name)
            old_val = old_attrs.get(attr_name)
            if new_val is None:
                continue

            if not is_nvme and attr_name in SEAGATE_COMPOSITE_ATTRS:
                new_decoded = decode_seagate_value(attr_name, new_val)
                old_decoded = decode_seagate_value(attr_name, old_val) if old_val is not None else None
            else:
                try:
                    new_decoded = float(new_val)
                except (ValueError, TypeError):
                    continue
                try:
                    old_decoded = float(old_val) if old_val is not None else None
                except (ValueError, TypeError):
                    old_decoded = None

            if old_decoded is None or new_decoded == old_decoded:
                continue

            # Skip impossible decreases on monotonic counters (SMART reporting artifacts)
            if attr_name in MONOTONIC_ATTRS and new_decoded < old_decoded:
                continue

            disk_alerts.append({
                'alert_type': 'state_change',
                'severity': 'info',
                'attribute': attr_name,
                'old_value': _fmt_val(old_decoded),
                'new_value': _fmt_val(new_decoded),
                'message': f'{attr_name}: {_fmt_val(old_decoded)} → {_fmt_val(new_decoded)} — {model} ({serial}) on {host}',
            })

        # --- Type B: Cumulative Event Changes (dashboard log only) ---
        for attr_name in CUMULATIVE_EVENT_ATTRS:
            new_val = new_attrs.get(attr_name)
            old_val = old_attrs.get(attr_name)
            if new_val is None:
                continue

            if not is_nvme and attr_name in SEAGATE_COMPOSITE_ATTRS:
                new_decoded = decode_seagate_value(attr_name, new_val)
                old_decoded = decode_seagate_value(attr_name, old_val) if old_val is not None else None
            else:
                try:
                    new_decoded = float(new_val)
                except (ValueError, TypeError):
                    continue
                try:
                    old_decoded = float(old_val) if old_val is not None else None
                except (ValueError, TypeError):
                    old_decoded = None

            if old_decoded is None:
                continue

            delta = new_decoded - old_decoded
            if delta <= 0:
                continue

            disk_alerts.append({
                'alert_type': 'cumulative_burst',
                'severity': 'info',
                'attribute': attr_name,
                'old_value': _fmt_val(old_decoded),
                'new_value': _fmt_val(new_decoded),
                'message': f'{attr_name}: +{_fmt_val(delta)} (now {_fmt_val(new_decoded)}) — {model} ({serial}) on {host}',
            })

        # --- Type E: Temperature Anomaly ---
        temp_attrs = TEMPERATURE_ATTRS_NVME if is_nvme else TEMPERATURE_ATTRS_ATA
        hard_ceiling = TEMP_HARD_CEILING_NVME if is_nvme else TEMP_HARD_CEILING_ATA
        for temp_attr in temp_attrs:
            tv = new_attrs.get(temp_attr)
            if tv is None:
                continue
            try:
                temp_now = float(tv)
            except (ValueError, TypeError):
                continue

            temp_alert = None

            # Hard ceiling — always active, no baseline needed
            if temp_now >= hard_ceiling:
                temp_alert = {
                    'alert_type': 'temperature',
                    'severity': 'critical',
                    'attribute': temp_attr,
                    'old_value': str(hard_ceiling),
                    'new_value': _fmt_val(temp_now),
                    'message': f'{temp_attr}: {_fmt_val(temp_now)}°C (ceiling {hard_ceiling}°C) — {model} ({serial}) on {host}',
                }
            else:
                # Baseline comparison — needs sufficient history
                cursor.execute('''
                    SELECT smart_attributes, timestamp FROM readings
                    WHERE disk_id = ? AND timestamp > datetime(?, '-14 days')
                    ORDER BY timestamp
                ''', (disk_id, timestamp))
                hist_rows = cursor.fetchall()

                # Check minimum history span
                if hist_rows:
                    try:
                        first_ts = _dt.fromisoformat(hist_rows[0][1].replace('Z', '+00:00'))
                        last_ts = _dt.fromisoformat(hist_rows[-1][1].replace('Z', '+00:00'))
                        history_days = (last_ts - first_ts).total_seconds() / 86400
                    except (ValueError, TypeError):
                        history_days = 0

                    if history_days >= TEMP_MIN_HISTORY_DAYS:
                        temps = []
                        for hrow in hist_rows:
                            try:
                                hattrs = json.loads(hrow[0]) if hrow[0] else {}
                                hv = hattrs.get(temp_attr)
                                if hv is not None:
                                    temps.append(float(hv))
                            except (json.JSONDecodeError, ValueError, TypeError):
                                continue

                        if temps:
                            avg_temp = sum(temps) / len(temps)
                            deviation = temp_now - avg_temp

                            if deviation >= TEMP_DEVIATION_CRITICAL:
                                sev = 'critical'
                            elif deviation >= TEMP_DEVIATION_WARNING:
                                sev = 'warning'
                            elif deviation >= TEMP_DEVIATION_INFO:
                                sev = 'info'
                            else:
                                sev = None

                            if sev:
                                temp_alert = {
                                    'alert_type': 'temperature',
                                    'severity': sev,
                                    'attribute': temp_attr,
                                    'old_value': _fmt_val(avg_temp),
                                    'new_value': _fmt_val(temp_now),
                                    'message': f'{temp_attr}: {_fmt_val(temp_now)}°C (avg {_fmt_val(avg_temp)}°C, +{_fmt_val(deviation)}°C) — {model} ({serial}) on {host}',
                                }

            if temp_alert:
                disk_alerts.append(temp_alert)
            break  # Only use first available temp attr

        # Write alerts to DB
        for alert in disk_alerts:
            cursor.execute('''
                INSERT INTO alerts
                    (disk_id, host, timestamp, alert_type, severity,
                     attribute, old_value, new_value, message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (disk_id, host, timestamp, alert['alert_type'], alert['severity'],
                  alert['attribute'], alert['old_value'], alert['new_value'],
                  alert['message']))
            alert['id'] = cursor.lastrowid
            alert['disk_id'] = disk_id
            alert['host'] = host
            alert['timestamp'] = timestamp

        # Update disk_status snapshot
        cursor.execute('''
            UPDATE disk_status
            SET smart_status = ?, smart_attributes = ?, status = ?, updated_at = ?
            WHERE disk_id = ?
        ''', (smart_status, json.dumps(new_attrs),
              new_disk_status, timestamp, disk_id))

        conn.commit()
        new_alerts.extend(disk_alerts)

    return new_alerts


# ---------------------------------------------------------------------------
# Webhook Notifications
# ---------------------------------------------------------------------------

def send_notifications(conn, alerts: list[dict], notify_config: dict,
                       webhook_urls: list = None):
    """Send webhook notifications for alerts that meet the configured severity.

    Args:
        conn: SQLite connection
        alerts: List of alert dicts (as returned by generate_alerts)
        notify_config: Notification config section from config.yaml
        webhook_urls: List of webhook URL strings. Format: [!]service:url
            service: ntfy, gotify, generic (default)
            ! prefix = disabled
    """
    if not alerts:
        return

    import sys

    min_severity = str(notify_config.get('min_severity', 'warning')).lower()
    
    # 'off' disables all push notifications
    if min_severity == 'off':
        return

    include_recovery = str(notify_config.get('include_recovery', 'false')).lower() == 'true'
    cooldown_minutes = int(notify_config.get('cooldown_minutes', 60))

    # Parse enabled endpoints: [{service, url, raw}, ...]
    endpoints = []
    for entry in (webhook_urls or []):
        if not entry or entry.startswith('!'):
            continue
        service, url = _parse_webhook_entry(entry)
        endpoints.append({'service': service, 'url': url, 'raw': entry})

    if not endpoints:
        return

    severity_rank = {'info': 0, 'warning': 1, 'critical': 2}
    min_rank = severity_rank.get(min_severity, 1)

    cursor = conn.cursor()

    for alert in alerts:
        sev = alert.get('severity', '')
        atype = alert.get('alert_type', '')

        # Type A/B are dashboard-only log entries, no webhook
        if atype in ('state_change', 'cumulative_burst'):
            continue

        # Recovery handled separately
        if sev == 'recovery':
            if not include_recovery:
                continue
        else:
            if severity_rank.get(sev, -1) < min_rank:
                continue

        # Cooldown: skip if a webhook was sent for this disk recently
        if cooldown_minutes > 0:
            disk_id = alert.get('disk_id', '')
            ts = alert.get('timestamp', '')
            try:
                cutoff = (_dt.fromisoformat(ts.replace('Z', '+00:00'))
                          - _td(minutes=cooldown_minutes)
                         ).strftime('%Y-%m-%d %H:%M:%S')
            except (ValueError, TypeError):
                cutoff = ts
            cursor.execute('''
                SELECT COUNT(*) FROM notification_log nl
                JOIN alerts a ON nl.alert_id = a.id
                WHERE a.disk_id = ? AND nl.success = 1
                  AND nl.timestamp > ?
            ''', (disk_id, cutoff))
            if cursor.fetchone()[0] > 0:
                print(f"  Notification skipped (cooldown {cooldown_minutes}m): [{sev}] {alert.get('message', '')}",
                      file=sys.stderr)
                continue

        title = _format_alert_title(alert)
        message = alert.get('message', '')

        for ep in endpoints:
            payload = _format_payload(ep['service'], title, message, sev)
            url = ep['url']

            # ntfy JSON API: POST to base URL with topic in body
            if ep['service'] == 'ntfy':
                from urllib.parse import urlparse
                parsed = urlparse(url)
                topic = parsed.path.strip('/')
                if topic:
                    payload['topic'] = topic
                    url = f"{parsed.scheme}://{parsed.netloc}/"

            success, error = _send_webhook(url, payload)

            cursor.execute('''
                INSERT INTO notification_log (alert_id, timestamp, channel, success, error)
                VALUES (?, ?, ?, ?, ?)
            ''', (alert.get('id'), alert.get('timestamp', ''), ep['url'],
                  int(success), error))
            conn.commit()

            status_str = '✓' if success else '✗'
            print(f"  Notification {status_str}: [{sev}] {alert.get('message', '')} → {ep['url']}",
                  file=sys.stderr)


def _parse_webhook_entry(entry: str) -> tuple:
    """Parse 'service:url' format. Returns (service, url).
    Entries without prefix default to 'generic'."""
    for prefix in ('ntfy:', 'gotify:', 'generic:'):
        if entry.startswith(prefix):
            return prefix[:-1], entry[len(prefix):]
        if entry.startswith('!' + prefix):
            return prefix[:-1], entry[len(prefix) + 1:]
    return 'generic', entry


def _format_payload(service: str, title: str, message: str,
                    severity: str) -> dict:
    """Format webhook payload for the given service type."""
    priority_map = {'critical': 5, 'warning': 3, 'info': 2, 'recovery': 2}
    pri = priority_map.get(severity, 2)

    if service == 'ntfy':
        return {'title': title, 'message': message, 'priority': pri}
    elif service == 'gotify':
        return {'title': title, 'message': message, 'priority': pri}
    else:  # generic
        return {'title': title, 'message': message, 'severity': severity}


def _format_alert_title(alert: dict) -> str:
    """Format a short title for webhook payloads."""
    sev = alert.get('severity', 'info')
    icons = {'critical': '🔴', 'warning': '🟡', 'info': 'ℹ️', 'recovery': '✅'}
    icon = icons.get(sev, '')
    attr = alert.get('attribute', '')

    if alert.get('alert_type') == 'smart_status':
        return f"{icon} SMART {alert.get('new_value', '')}"
    if alert.get('alert_type') == 'disk_status_change':
        return f"{icon} Disk {alert.get('old_value', '')} → {alert.get('new_value', '')}"
    if alert.get('alert_type') == 'temperature':
        return f"{icon} Temperature: {alert.get('new_value', '')}°C"
    return f"{icon} {sev.upper()}: {attr}"


def _send_webhook(url: str, payload: dict) -> tuple:
    """Send notification via HTTP POST (JSON).

    Returns:
        (success: bool, error: str or None)
    """
    import urllib.request
    import urllib.error

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return (200 <= resp.status < 300, None)
    except urllib.error.HTTPError as e:
        return (False, f'HTTP {e.code}')
    except (urllib.error.URLError, OSError, ValueError) as e:
        return (False, str(e))


def parse_simple_yaml(text: str) -> dict:
    """Parse simple YAML (flat keys, string values, simple lists, one level of nesting).

    Supports:
      - Top-level scalar keys:  ``key: value``
      - Top-level lists:        indented ``- item`` lines below a key
      - One-level nested maps:  indented ``subkey: value`` lines below a key

    No external YAML library required.
    """
    result = {}
    current_key = None
    current_list = None

    for raw_line in text.split('\n'):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        indent = len(raw_line) - len(raw_line.lstrip())

        if indent > 0 and current_key and stripped.startswith('- '):
            val = stripped[2:].strip()
            if current_list is None:
                current_list = []
                result[current_key] = current_list
            current_list.append(val)

        elif indent > 0 and current_key and ':' in stripped:
            k, _, v = stripped.partition(':')
            v = v.strip()
            if not isinstance(result.get(current_key), dict):
                result[current_key] = {}
            if v:
                try:
                    result[current_key][k.strip()] = int(v)
                except ValueError:
                    result[current_key][k.strip()] = v

        elif ':' in stripped and indent == 0:
            k, _, v = stripped.partition(':')
            k = k.strip()
            v = v.strip()
            current_key = k
            current_list = None
            if v:
                try:
                    result[k] = int(v)
                except ValueError:
                    result[k] = v

    return result
