# diskmind

Lightweight SMART disk health monitoring for Linux servers. Collects SMART data via SSH pull or agent push, stores it in SQLite, and serves an interactive web dashboard.

![Dashboard Screenshot](docs/screenshot.png)

## Features

- **Dual collection** — SSH pull from central server or agent push from remote hosts
- **Push-agent with auto-approval** — unknown hosts appear in dashboard for accept/dismiss
- **Per-host SSH users** — configure different SSH users per host (e.g. `stefan@192.168.1.10`)
- **All disk types** — HDD, SSD, and NVMe with full attribute capture
- **All SMART attributes** — stored as JSON, not limited to a fixed subset
- **Web dashboard** — sortable tables, dark/light theme, status filtering, custom dropdowns
- **Inline host editing** — edit hostname, SSH user, and collection method directly in the dashboard
- **Settings panel** — manage hosts and temperature unit (°C/°F) from the dashboard
- **Trend tracking** — sparkline charts showing attribute history with delta indicators
- **Delta-based alerting** — cumulative counters only trigger warnings if they increased within the selected time range
- **Configurable thresholds** — three presets (relaxed, conservative, backblaze) with custom threshold editor
- **Seagate decoding** — composite raw values decoded automatically
- **Attribute tooltips** — hover any attribute name for a plain-language explanation
- **Threshold tooltips** — hover colored values to see why they triggered a warning or critical alert
- **Human-readable LBAs** — Total_LBAs_Written/Read and Data_Units shown as TB/PB with raw value on hover
- **Zero dependencies** — Python 3 standard library only (no pip install needed)
- **Single-file scripts** — easy to deploy, nothing to compile

## Directory Structure

```
diskmind/
  bin/                User-facing executables
    diskmind-fetch      Orchestrates SSH collection, writes to SQLite
    diskmind-view       Serves web dashboard
    diskmind-scan       Runs on target hosts, calls smartctl, outputs CSV or pushes to server
  config/             User-editable settings
    config.yaml         Hosts, SSH, database, threshold preset, delta range
    thresholds.json     Threshold preset definitions
  data/               Runtime data (gitignored)
    smart.db            SQLite database
```

## Architecture

diskmind supports two collection methods per host:

### SSH Pull (default)

The central server connects via SSH, runs `diskmind-scan` on the target, and collects the output.

```
┌─────────────┐                             ┌──────────────────┐
│  Host A      │ ◄── SSH: run scan ──────── │                  │
│  (smartctl)  │ ──── CSV stdout ─────────► │  diskmind-fetch  │
└─────────────┘                             │                  │
                                            │  Stores in       │        ┌──────────────────┐
┌─────────────┐                             │  SQLite          │        │  diskmind-view   │
│  Host B      │ ◄── SSH: run scan ──────── │                  │        │                  │
│  (smartctl)  │ ──── CSV stdout ─────────► │                  │        │  Web dashboard   │
                                                     │                  │                  │
                                                data/smart.db ─────────►│                  │
                                                                        └──────────────────┘
```

### Agent Push

The agent runs on the target host (via cron), collects SMART data locally, and pushes it to the server over HTTP. If the server is unreachable, data is buffered locally and sent on the next successful attempt.

```
┌─────────────┐        HTTP POST
│  Host C      │ ──── /api/ingest ─────────►┌──────────────────┐
│  diskmind-   │                             │  diskmind-view   │
│  scan --push │ ◄──── 200 OK ──────────────│                  │
└─────────────┘                             │  Stores in       │
                                            │  SQLite          │
┌─────────────┐        HTTP POST            │                  │
│  Host D      │ ──── /api/ingest ─────────►│                  │
│  diskmind-   │                             └──────────────────┘
│  scan --push │ ◄──── 200 OK ──────────────
└─────────────┘
```

| Component | File | Role |
|-----------|------|------|
| **scan** | `bin/diskmind-scan` | Runs on each host, calls `smartctl`, outputs CSV or pushes to server |
| **fetch** | `bin/diskmind-fetch` | Pushes scan to SSH hosts, parses results, writes to SQLite |
| **view** | `bin/diskmind-view` | Reads SQLite, serves web dashboard |

## Requirements

- **Monitoring machine:** Python 3.8+, SSH access to target hosts (for SSH mode)
- **Target hosts:** `smartctl` (from `smartmontools`), `bash`, `curl` (for push mode)
- **Permissions:** Root or sudo access on target hosts (smartctl needs it)

## Quick Start

### SSH Mode (central collection)

```bash
git clone https://github.com/YOUR_USER/diskmind.git
cd diskmind

# Edit config
vi config/config.yaml    # Set your hosts

# Fetch data
./bin/diskmind-fetch

# Start dashboard
./bin/diskmind-view --port 8080
```

### Push Mode (agent on target host)

On the **monitoring server**, start the dashboard:
```bash
./bin/diskmind-view --port 8080
```

On each **target host**, copy `bin/diskmind-scan` and set up a cron job:
```bash
# Copy the scan script
scp diskmind/bin/diskmind-scan target-host:/opt/diskmind/bin/

# On the target host, add to crontab:
*/15 * * * * /bin/bash /opt/diskmind/bin/diskmind-scan --push http://SERVER:8080 --host HOST_IP --log /var/log/diskmind.log
```

The first time the agent pushes, the host will appear in the dashboard under **Pending Approval**. Click **Accept** to start monitoring.

## Usage

### diskmind-fetch

```bash
# Use config file (default: config/config.yaml)
./bin/diskmind-fetch

# Override hosts from CLI
./bin/diskmind-fetch --hosts 192.168.1.10,192.168.1.11

# Custom config file
./bin/diskmind-fetch -c /etc/diskmind/config.yaml

# Include localhost (no SSH, runs scan directly)
./bin/diskmind-fetch --hosts localhost,192.168.1.10

# Verbose output
./bin/diskmind-fetch -v
```

### diskmind-view

```bash
# Web server (default port 8080)
./bin/diskmind-view --port 8080

# Custom database path
./bin/diskmind-view --db /path/to/smart.db
```

### diskmind-scan (push mode)

```bash
# Push data to server
./bin/diskmind-scan --push http://server:8080 --host 192.168.1.10

# With authentication token
./bin/diskmind-scan --push http://server:8080 --host 192.168.1.10 --token mysecrettoken

# With logging
./bin/diskmind-scan --push http://server:8080 --host 192.168.1.10 --log /var/log/diskmind.log

# Custom buffer directory (default: /var/lib/diskmind/buffer)
./bin/diskmind-scan --push http://server:8080 --host 192.168.1.10 --buffer-dir /tmp/diskmind-buffer

# Output CSV to stdout (used internally by SSH mode)
./bin/diskmind-scan
```

## Configuration

### config/config.yaml

```yaml
hosts:
  - ssh:stefan@192.168.1.10     # SSH with specific user
  - ssh:root@192.168.1.11       # SSH with root
  - push:192.168.1.12           # Agent push
  - admin@192.168.1.13          # Legacy format (treated as SSH)

ssh:
  timeout: 30

database:
  path: ./data/smart.db
  retention_days: 365

# Threshold preset: relaxed, conservative, backblaze
threshold_preset: backblaze

# Delta time range for issue detection: 1h, 24h, 7d, 30d, 90d, all
delta_preset: 7d

# Temperature display unit: C or F
temp_unit: C

# Optional: require authentication token for push agents
push_token: mysecrettoken

# Rate limit for push requests (per IP)
rate_limit:
  max_requests: 10    # Set to 0 to disable
  window_seconds: 60
```

### Push Authentication

When `push_token` is set, all push agents must include the token in their requests. This prevents unauthorized hosts from submitting data. Configure the token on the server in `config.yaml`, then pass it to each agent:

```bash
./bin/diskmind-scan --push http://server:8080 --host 192.168.1.10 --token mysecrettoken
```

If a push request arrives without the correct token, the server responds with `401 Unauthorized`.

### Rate Limiting

The `/api/ingest` endpoint is rate-limited per IP address. Default: 10 requests per 60 seconds. Since each agent sends all disks in one request (typically every 15 minutes), this is very permissive.

Set `max_requests: 0` to disable rate limiting entirely. Rate limit settings can also be adjusted in the dashboard under Settings.

### Collection Methods

| Method | Prefix | Use Case |
|--------|--------|----------|
| **SSH** | `ssh:` | Central server has SSH access to target |
| **Push** | `push:` | Target behind firewall/NAT, or no SSH access |

SSH hosts are collected by `diskmind-fetch`. Push hosts send data via `diskmind-scan --push` on the target itself.

### Threshold Presets

| Preset | Use Case |
|--------|----------|
| **Relaxed** | Home/lab use. Higher thresholds, fewer false positives. |
| **Conservative** | Important data. Stricter thresholds for early warnings. |
| **Backblaze** | Industry standard based on 300k+ drive failure data. |

Presets can be selected from the dashboard or edited with the built-in threshold editor (⚙️ button).

### Delta-Based Issue Detection

SMART attributes fall into two categories:

| Type | Examples | Behavior |
|------|----------|----------|
| **Critical state** | Reallocated sectors, pending sectors, media errors | Always shown if threshold exceeded |
| **Cumulative counters** | Command timeouts, unsafe shutdowns, error log entries | Only shown if value increased within delta range |

This reduces noise from old events while highlighting active problems. Select the time range (1 hour to all time) from the History dropdown in the dashboard.

## Dashboard

The web dashboard provides:

- **Summary cards** — total, healthy, warning, critical counts (click to filter)
- **Host groups** — disks grouped by host with drive count, total capacity, and last scan time
- **Method badges** — SSH/PUSH indicator per host
- **Host management** — add, edit (✎), rescan (↻), and remove (✕) hosts directly in the UI
- **SSH/Push toggle** — switch collection method per host in the edit view
- **Pending approval** — unknown push hosts appear for accept/dismiss
- **Push attempt indicator** — ⚡ icon when an SSH host attempts to push data
- **Inline host editing** — edit SSH user and hostname without leaving the dashboard
- **Custom dropdowns** — polished UI elements for all filter controls
- **Type column** — separate sortable column for disk type (HDD/SSD/NVMe) with colored badges
- **Host filter & search** — dropdown and free-text search across all fields
- **Sortable columns** — device, type, model, serial, capacity, power-on hours, temperature, since, last, status
- **Detail panel** — click any row to expand; shows sidebar with disk identity and SMART attribute table with values, deltas, and sparkline trends
- **Show all attributes** — health attributes shown by default, click to expand all attributes
- **Settings panel** — temperature unit (°C/°F) preference
- **Threshold editor** — customize warning/critical thresholds per attribute
- **Dark/light theme** — persisted across reloads
- **Auto-refresh** — every 60 seconds, preserving scroll position and expanded panels

### Health Classification

Status is determined by visible issues (respecting both threshold preset and delta filter):

| Status | Condition |
|--------|-----------|
| **Critical** | SMART status FAILED, or any critical threshold exceeded |
| **Warning** | Any warning threshold exceeded (for visible issues) |
| **Healthy** | No visible issues |

### Seagate Composite Values

Seagate drives pack multiple counters into single 48-bit raw values. diskmind automatically decodes these so that e.g. Command_Timeout shows the actual timeout count rather than a misleading composite number. The original raw value is visible on hover.

## Data Storage

Schema v1.5:

```sql
readings (
    disk_id         TEXT,       -- Primary identifier (WWN or serial)
    wwn             TEXT,       -- World Wide Name
    serial          TEXT,       -- Disk serial number
    timestamp       DATETIME,  -- Collection time
    host            TEXT,       -- Source host
    device          TEXT,       -- e.g. /dev/sda
    type            TEXT,       -- HDD, SSD, NVMe
    model           TEXT,       -- Disk model
    capacity_bytes  INTEGER,   -- Disk size
    firmware        TEXT,       -- Firmware version
    rpm             INTEGER,   -- Rotation rate (0 for SSD)
    sector_size     INTEGER,   -- Logical sector size in bytes
    smart_status    TEXT,       -- PASSED, FAILED, N/A
    smart_attributes TEXT,     -- JSON with all SMART attributes
    PRIMARY KEY (disk_id, timestamp)
)

host_status (
    host            TEXT PRIMARY KEY,
    status          TEXT,       -- ok, offline, auth_failed, timeout, error
    message         TEXT,
    disk_count      INTEGER,
    last_attempt    DATETIME,
    last_success    DATETIME
)

push_attempts (
    host            TEXT PRIMARY KEY,
    last_attempt    DATETIME,
    attempts        INTEGER,
    reason          TEXT        -- 'unknown' (pending approval) or 'ssh' (method mismatch)
)
```

Database migrations run automatically on startup.

## Push Agent Details

### Buffering

When the server is unreachable, `diskmind-scan` buffers data locally in `/var/lib/diskmind/buffer/`. On the next successful connection, all buffered data is sent automatically.

When the server rejects data (host not configured or wrong method), data is **not** buffered — the agent logs the rejection and exits.

### Auto-Approval Flow

1. Install `diskmind-scan` on target host and configure cron
2. Agent pushes data to server → server responds with 403 (unknown host)
3. Dashboard shows host under **Pending Approval**
4. Admin clicks **Accept** → host is added as `push:IP` to config
5. Next cron run sends buffered data successfully

### Error Messages

| Message | Meaning |
|---------|---------|
| `Server unreachable, buffering data` | Server is down or wrong URL/port |
| `Rejected: Unknown host: x.x.x.x` | Host not in config — check Pending Approval in dashboard |
| `Rejected: Host x.x.x.x is configured for SSH, not push` | Switch host to Push mode in dashboard |
| `Auth failed: Invalid or missing push token` | Server has `push_token` set — add `--token` to agent |
| `Rate limited. Try again later.` | Too many requests — wait and retry (data will be buffered) |

## Automation

### Cron (SSH mode)

```bash
# Fetch every hour
0 * * * * cd /opt/diskmind && ./bin/diskmind-fetch
```

### Cron (Push mode, on target host)

```bash
# Push every 15 minutes
*/15 * * * * /bin/bash /opt/diskmind/bin/diskmind-scan --push http://SERVER:8080 --host HOST_IP --log /var/log/diskmind.log
```

### Systemd

```ini
# /etc/systemd/system/diskmind-fetch.service
[Unit]
Description=diskmind SMART data collection

[Service]
Type=oneshot
WorkingDirectory=/opt/diskmind
ExecStart=/opt/diskmind/bin/diskmind-fetch

# /etc/systemd/system/diskmind-fetch.timer
[Unit]
Description=diskmind hourly collection

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now diskmind-fetch.timer
```

## License

MIT
