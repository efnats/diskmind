# Push Agent Setup

Push mode is for hosts behind firewalls/NAT or without SSH access. The agent runs on the target host and pushes data to your diskmind server.

## Quick Setup

**1. Copy the agent to the target host:**
```bash
scp bin/diskmind_scan target-host:/opt/diskmind/
```

**2. Test it:**
```bash
/opt/diskmind/diskmind_scan --push http://your-server:8080 --host $(hostname -I | awk '{print $1}')
```

**3. Approve the host:**

First push from an unknown host returns `403`. Check your dashboard → **Pending Approval** → Click **Accept**.

**4. Set up cron:**
```bash
# /etc/cron.d/diskmind
*/15 * * * * root /opt/diskmind/diskmind_scan --push http://your-server:8080 --host $(hostname -I | awk '{print $1}') --log /var/log/diskmind.log
```

## Command Line Options

```bash
diskmind_scan --push URL --host IP [OPTIONS]

Options:
  --push URL         Server URL (e.g., http://server:8080)
  --host IP          This host's IP (for identification)
  --token TOKEN      Auth token (if server requires it)
  --log FILE         Log to file
  --buffer-dir DIR   Buffer directory (default: /var/lib/diskmind/buffer)
```

## Authentication

If the server has `push_token` configured:

```bash
diskmind_scan --push http://server:8080 --host 192.168.1.10 --token your-secret-token
```

## Buffering

When the server is unreachable, data is buffered locally in `/var/lib/diskmind/buffer/`. On next successful connection, buffered data is sent automatically.

**Note:** Rejected requests (wrong token, unknown host) are not buffered.

## Auto-Approval Flow

```
1. Agent pushes → Server returns 403 (unknown host)
2. Data buffered locally
3. Admin sees host in "Pending Approval"
4. Admin clicks "Accept"
5. Next push succeeds, buffer cleared
```

## Troubleshooting

| Error | Solution |
|-------|----------|
| `Server unreachable, buffering data` | Check URL/port, ensure server is running |
| `Rejected: Unknown host` | Accept host in dashboard |
| `Host configured for SSH, not push` | Change host to push mode in dashboard |
| `Auth failed: Invalid or missing push token` | Add `--token` with correct value |
| `Rate limited` | Wait and retry (data is buffered) |

## Requirements

Target host needs:
- `bash`
- `curl`
- `smartctl` (from `smartmontools`)
- Root access (smartctl requires it)

## systemd Service (Alternative to Cron)

```ini
# /etc/systemd/system/diskmind-agent.service
[Unit]
Description=diskmind push agent

[Service]
Type=oneshot
ExecStart=/opt/diskmind/diskmind_scan --push http://server:8080 --host %H --log /var/log/diskmind.log

# /etc/systemd/system/diskmind-agent.timer
[Unit]
Description=diskmind push every 15 minutes

[Timer]
OnCalendar=*:0/15
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now diskmind-agent.timer
```
