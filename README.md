# diskmind

Lightweight SMART disk health monitoring for Linux servers. Collects SMART data from local and remote hosts via SSH, stores it in SQLite, and serves an interactive web dashboard.

![Dashboard Screenshot](docs/screenshot.png)

## Features

- **Multi-host collection** — gather SMART data from any number of hosts via SSH
- **All disk types** — HDD, SSD, and NVMe with full attribute capture
- **All SMART attributes** — stored as JSON, not limited to a fixed subset
- **Backblaze failure thresholds** — health classification based on real-world failure data from 300,000+ drives
- **Three threshold presets** — Backblaze (datacenter), Conservative (early replacement), Relaxed (home/lab)
- **Settings panel** — switch presets from the web UI, see active thresholds at a glance
- **WWN identification** — globally unique disk IDs (World Wide Name), serial number as display ID
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

Additional files:

| File | Role |
|------|------|
| `lib/thresholds.json` | Health classification rules (editable) |
| `data/config.json` | User settings — active preset selection (created at runtime) |

## Requirements

- **Monitoring machine:** Python 3.8+, SSH access to target hosts
- **Target hosts:** `smartctl` (from `smartmontools`), `bash`
- **Permissions:** Root or sudo access on target hosts (smartctl needs it)

## Quick Start

```bash
# Clone the repo
git clone https://github.com/efnats/diskmind.git
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
- **Detail view** — click any disk row to expand all SMART attributes (including WWN)
- **Dark/light theme** — toggle with ☀️/🌙 button
- **Settings panel** — ⚙️ button to switch threshold presets and review active thresholds
- **Auto-refresh** — updates every 60 seconds

## Health Classification

Disk health is classified using thresholds based on [Backblaze drive failure research](https://www.backblaze.com/blog/what-smart-stats-indicate-hard-drive-failures/) (300,000+ drives) and the NVMe specification. Three presets are available, selectable via the ⚙️ Settings panel in the dashboard:

| Preset | Use Case | Philosophy |
|--------|----------|------------|
| **Backblaze** (default) | Datacenter, production | Warning at any non-zero value, critical at elevated counts |
| **Conservative** | Critical data, RAID arrays | Lower critical thresholds for earlier drive replacement |
| **Relaxed** | Home/lab, media storage | Higher thresholds to reduce false positives |

### Backblaze Preset (default)

Backblaze found that in 76.7% of drive failures, at least one of five key SMART attributes had a non-zero raw value.

**ATA (HDD / SATA SSD):**

| Attribute | Warning | Critical | SMART ID |
|-----------|---------|----------|----------|
| Reallocated Sector Count | > 0 | > 100 | 5 |
| Reported Uncorrectable Errors | > 0 | — | 187 |
| Command Timeout | > 0 | — | 188 |
| Current Pending Sector | > 0 | > 10 | 197 |
| Offline Uncorrectable | > 0 | > 10 | 198 |

**NVMe:**

| Attribute | Warning | Critical |
|-----------|---------|----------|
| Percentage Used | > 80% | > 95% |
| Available Spare | < 20% | < 10% |
| Error Log Entries | > 0 | — |
| Unsafe Shutdowns | > 50 | — |
| Critical Warning | — | > 0 |
| Media and Data Integrity Errors | — | > 0 |

### Conservative Preset

**ATA:** Warning > 0, Critical at > 50 (realloc), > 10 (reported uncorrect), > 50 (timeout), > 5 (pending/offline).
**NVMe:** Warning at > 70% used / < 25% spare, Critical at > 85% / < 15%.

### Relaxed Preset

**ATA:** Warning > 10 (realloc/reported) / > 100 (timeout) / > 5 (pending/offline), Critical at > 500 (realloc) / > 100 (pending/offline).
**NVMe:** Warning at > 90% used / < 15% spare, Critical at > 100% / < 5%.

A SMART self-test failure (`FAILED` status) is always classified as critical, regardless of individual attributes or preset.

### Custom Thresholds

The active preset is stored in `data/config.json` and can be changed via the Settings panel or by editing the file directly:

```json
{
  "threshold_preset": "backblaze"
}
```

To customize individual thresholds beyond the presets, edit `lib/thresholds.json`. Each preset contains `ata` and `nvme` sections with `warning` and `critical` levels:

```json
{
  "ata": {
    "warning": {
      "Reallocated_Sector_Ct": { "id": 5, "op": ">", "value": 0 }
    },
    "critical": {
      "Reallocated_Sector_Ct": { "id": 5, "op": ">", "value": 100 }
    }
  }
}
```

Supported operators: `>`, `>=`, `<`, `<=`, `==`

## Disk Identification

Disks are identified by **WWN** (World Wide Name) internally — a globally unique identifier assigned by the IEEE, similar to a MAC address. This prevents collisions even when collecting data from hundreds of hosts worldwide.

The **serial number** is displayed in the dashboard, since that's what's printed on the drive label and used for RMA processes.

If a disk has no WWN (older drives, some USB enclosures), the serial number is used as fallback.

## Data Storage

SMART data is stored in SQLite with a simple schema:

```sql
readings (
    disk_id          TEXT,       -- WWN (preferred) or serial number
    wwn              TEXT,       -- World Wide Name (may be NULL)
    serial           TEXT,       -- Disk serial number
    timestamp        DATETIME,   -- Collection time
    host             TEXT,       -- Source host
    device           TEXT,       -- e.g. /dev/sda
    type             TEXT,       -- HDD, SSD, NVMe
    model            TEXT,       -- Disk model
    capacity_bytes   INTEGER,    -- Disk size
    smart_status     TEXT,       -- PASSED, FAILED, N/A
    smart_attributes TEXT,       -- JSON with ALL SMART attributes
    PRIMARY KEY (disk_id, timestamp)
)
```

All SMART attributes are stored as a JSON object. This handles the fact that different disk types report different attributes without requiring schema changes.

Existing v1.0 databases are migrated automatically on first run.

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
