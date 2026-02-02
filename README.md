# diskmind

Lightweight SMART disk health monitoring for Linux servers. Collects SMART data from local and remote hosts via SSH, stores it in SQLite, and serves an interactive web dashboard.

![Dashboard Screenshot](docs/screenshot.png)

## Features

- **Multi-host collection** — gather SMART data from any number of hosts via SSH
- **All disk types** — HDD, SSD, and NVMe with full attribute capture
- **All SMART attributes** — stored as JSON, not limited to a fixed subset
- **Web dashboard** — sortable tables, dark/light theme, status filtering
- **Settings panel** — manage hosts, SSH user, and threshold presets from the dashboard
- **Static reports** — generate standalone HTML files for sharing or archival
- **Trend tracking** — sparkline charts showing 30-day attribute history with delta indicators
- **Seagate decoding** — composite raw values (Command_Timeout, Raw_Read_Error_Rate, Seek_Error_Rate) decoded automatically
- **Attribute tooltips** — hover any attribute name for a plain-language explanation
- **Threshold tooltips** — hover colored values to see why they triggered a warning or critical alert
- **Human-readable LBAs** — Total_LBAs_Written/Read and Data_Units shown as TB/PB with raw value on hover
- **Configurable thresholds** — three presets (backblaze, conservative, relaxed) selectable via config or UI
- **Zero dependencies** — Python 3 standard library only (no pip install needed)
- **Single-file scripts** — easy to deploy, nothing to compile

## Directory Structure

```
diskmind/
  bin/                User-facing executables
    diskmind-fetch      Orchestrates SSH collection, writes to SQLite
    diskmind-view       Serves web dashboard or generates static HTML
  lib/                Internal components (not user-edited)
    diskmind-scan       Runs on each target host, calls smartctl, outputs CSV
  config/             User-editable settings
    config.yaml         Hosts, SSH, database, threshold preset
    thresholds.json     Threshold preset definitions
  data/               Runtime data (gitignored)
    smart.db            SQLite database
```

## Architecture

```
                      diskmind-scan              diskmind-fetch              diskmind-view
                     (runs on host)          (orchestrates SSH)           (serves dashboard)

┌─────────────┐                             ┌──────────────────┐
│  Host A      │ ◄── SSH: push scan ─────── │                  │
│  (smartctl)  │ ──── CSV stdout ──────────► │                  │
└─────────────┘                             │  diskmind-fetch  │
                                            │                  │
┌─────────────┐                             │  Collects data,  │        ┌──────────────────┐
│  Host B      │ ◄── SSH: push scan ─────── │  stores in       │        │  diskmind-view   │
│  (smartctl)  │ ──── CSV stdout ──────────► │  SQLite          │        │                  │
└─────────────┘                             └────────┬─────────┘        │  Web dashboard   │
                                                     │                  │  or static HTML  │
                                                data/smart.db ─────────► │                  │
                                                                        └──────────────────┘
```

| Component | File | Role |
|-----------|------|------|
| **scan** | `lib/diskmind-scan` | Runs on each host, calls `smartctl`, outputs CSV |
| **fetch** | `bin/diskmind-fetch` | Pushes scan to hosts via SSH, parses results, writes to SQLite |
| **view** | `bin/diskmind-view` | Reads SQLite, serves web dashboard or generates static HTML |

## Requirements

- **Monitoring machine:** Python 3.8+, SSH access to target hosts
- **Target hosts:** `smartctl` (from `smartmontools`), `bash`
- **Permissions:** Root or sudo access on target hosts (smartctl needs it)

## Quick Start

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

# Static HTML report
./bin/diskmind-view -o report.html

# Custom database path
./bin/diskmind-view --db /path/to/smart.db
```

## Configuration

### config/config.yaml

```yaml
hosts:
  - 192.168.1.10
  - 192.168.1.11

ssh:
  user: root
  timeout: 30

database:
  path: ./data/smart.db
  retention_days: 365

# Threshold preset: backblaze, conservative, relaxed
threshold_preset: backblaze
```

Available presets: `backblaze` (default), `conservative`, `relaxed`. Preset definitions are in `config/thresholds.json`.

Hosts, SSH user, and threshold preset can also be managed from the dashboard settings panel (⚙️ button). Changes are written directly to `config.yaml`.

## Dashboard

The web dashboard provides:

- **Summary cards** — total, healthy, warning, critical counts (click to filter)
- **Host groups** — disks grouped by host with drive count, total capacity, and last scan time
- **Host filter & search** — dropdown and free-text search across all fields
- **Sortable columns** — device, model, serial, capacity, power-on hours, temperature, status
- **Detail panel** — click any row to expand; shows sidebar with disk identity (WWN, firmware, RPM, sector size, power cycles, history count) and SMART attribute table with values, deltas, and sparkline trends
- **Show all attributes** — health attributes shown by default, click anywhere in the attribute area or the link to expand all attributes
- **Settings panel** — manage monitored hosts (add/remove with last-seen status), SSH user, and threshold presets directly from the UI
- **Dark/light theme** — persisted across reloads
- **Auto-refresh** — every 60 seconds, preserving scroll position and expanded panels

### Health Classification

Thresholds are configurable per preset. The default (backblaze) classification:

| Status | Example triggers |
|--------|-----------------|
| **Critical** | SMART status FAILED, Reallocated_Sector_Ct > 100, Temperature > 65°C |
| **Warning** | Reallocated_Sector_Ct > 0, Command_Timeout > 0, Current_Pending_Sector > 0, Temperature > 55°C |
| **Healthy** | All checks passed |

### Seagate Composite Values

Seagate drives pack multiple counters into single 48-bit raw values. diskmind automatically decodes these so that e.g. Command_Timeout shows the actual timeout count rather than a misleading composite number. The original raw value is visible on hover.

## Data Storage

Schema v1.2:

```sql
readings (
    serial          TEXT,       -- Disk serial number
    timestamp       DATETIME,  -- Collection time
    host            TEXT,       -- Source host
    device          TEXT,       -- e.g. /dev/sda
    type            TEXT,       -- HDD, SSD, NVMe
    model           TEXT,       -- Disk model
    capacity_bytes  INTEGER,   -- Disk size
    smart_status    TEXT,       -- PASSED, FAILED, N/A
    smart_attributes TEXT,     -- JSON with all SMART attributes
    wwn             TEXT,       -- World Wide Name
    firmware        TEXT,       -- Firmware version
    rpm             INTEGER,   -- Rotation rate (0 for SSD)
    sector_size     INTEGER,   -- Logical sector size in bytes
    PRIMARY KEY (serial, timestamp)
)
```

Database migrations run automatically on startup.

## Automation

### Cron

```bash
# Fetch every hour
0 * * * * cd /opt/diskmind && ./bin/diskmind-fetch
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
