# diskmind

Lightweight SMART disk health monitoring for Linux servers. Collects SMART data from local and remote hosts via SSH, stores it in SQLite, and serves an interactive web dashboard.

![Dashboard Screenshot](docs/screenshot.png)

## Features

- **Multi-host collection** — gather SMART data from any number of hosts via SSH
- **All disk types** — HDD, SSD, and NVMe with full attribute capture
- **All SMART attributes** — stored as JSON, not limited to a fixed subset
- **Web dashboard** — sortable tables, dark/light theme, status filtering
- **Static reports** — generate standalone HTML files for sharing or archival
- **Trend tracking** — detect reallocated sector growth over 30 days
- **Zero dependencies** — Python 3 standard library only (no pip install needed)
- **Single-file scripts** — easy to deploy, nothing to compile

## Architecture

```
                          diskmind-scan              diskmind-fetch              diskmind-view
                         (runs on host)          (orchestrates SSH)           (serves dashboard)

┌─────────────┐                                 ┌──────────────────┐
│  Host A      │ ◄── SSH: push scan script ──── │                  │
│  (smartctl)  │ ──── CSV stdout ──────────────► │                  │
└─────────────┘                                 │  diskmind-fetch  │
                                                │                  │
┌─────────────┐                                 │  Collects data,  │        ┌──────────────────┐
│  Host B      │ ◄── SSH: push scan script ──── │  stores in       │        │  diskmind-view   │
│  (smartctl)  │ ──── CSV stdout ──────────────► │  SQLite          │        │                  │
└─────────────┘                                 └────────┬─────────┘        │  Web dashboard   │
                                                         │                  │  or static HTML  │
                                                    data/smart.db ─────────► │                  │
                                                                            └──────────────────┘
```

**Three components:**

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
# Clone the repo
git clone https://github.com/YOUR_USER/diskmind.git
cd diskmind

# Fetch data from hosts
./bin/diskmind-fetch --hosts 192.168.1.10,192.168.1.11

# Start the web dashboard
./bin/diskmind-view --port 8080
# Open http://localhost:8080
```

## Usage

### diskmind-fetch

```bash
# Single host
./bin/diskmind-fetch --hosts 192.168.1.10

# Multiple hosts
./bin/diskmind-fetch --hosts 192.168.1.10,192.168.1.11,192.168.1.12

# Custom SSH user (default: root)
./bin/diskmind-fetch --hosts 192.168.1.10 --ssh-user admin

# Custom database path (default: ./data/smart.db)
./bin/diskmind-fetch --hosts 192.168.1.10 --db ./my-data/disks.db

# Include localhost (no SSH, runs scan directly)
./bin/diskmind-fetch --hosts localhost,192.168.1.10
```

### diskmind-view

```bash
# Web server (default port 8080)
./bin/diskmind-view --port 8080

# Static HTML report
./bin/diskmind-view --static --output report.html

# Custom database path
./bin/diskmind-view --db ./my-data/disks.db
```

## Dashboard

The web dashboard provides:

- **Summary cards** — total, healthy, warning, critical disk counts
- **Host groups** — disks grouped by host, collapsible
- **Sortable columns** — click any column header to sort (Device sorts by type: NVMe → SSD → HDD)
- **Filtering** — by host, disk type, or free-text search
- **Status filtering** — click summary cards to filter by health status
- **Detail view** — click any disk row to expand all SMART attributes
- **Dark/light theme** — toggle with ☀️/🌙 button
- **Auto-refresh** — updates every 60 seconds

### Health Classification

| Status | Condition |
|--------|-----------|
| **Critical** | SMART self-test failed |
| **Warning** | Reallocated sectors, pending sectors, or offline uncorrectable > 0 |
| **Healthy** | All checks passed |

## Data Storage

SMART data is stored in SQLite with a simple schema:

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
    smart_attributes TEXT,     -- JSON with ALL SMART attributes
    PRIMARY KEY (serial, timestamp)
)
```

All SMART attributes are stored as a JSON object. This handles the fact that different disk types report different attributes without requiring schema changes.

## Automation

### Cron

```bash
# Fetch every hour
0 * * * * /opt/diskmind/bin/diskmind-fetch --hosts 192.168.1.10,192.168.1.11
```

### Systemd

```ini
# /etc/systemd/system/diskmind-fetch.service
[Unit]
Description=diskmind data fetch

[Service]
Type=oneshot
WorkingDirectory=/opt/diskmind
ExecStart=/opt/diskmind/bin/diskmind-fetch --hosts 192.168.1.10,192.168.1.11

# /etc/systemd/system/diskmind-fetch.timer
[Unit]
Description=diskmind hourly fetch

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
