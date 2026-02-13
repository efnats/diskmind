# Configuration Reference

diskmind uses `config/config.yaml` for settings. If it doesn't exist, `config.yaml.example` is used as fallback. On first change via the web UI, `config.yaml` is created automatically.

## Example Configuration

```yaml
hosts:
  - ssh:root@192.168.1.10
  - ssh:stefan@192.168.1.11
  - push:192.168.1.12

ssh:
  timeout: 30

database:
  path: ./data/diskmind.db
  retention_days: 365

threshold_preset: backblaze    # relaxed, conservative, backblaze, custom
delta_preset: 7d               # 1h, 24h, 7d, 30d, 90d, all

push_token: your-secret-token  # Optional: require token for push agents

rate_limit:
  max_requests: 10             # Per IP, set to 0 to disable
  window_seconds: 60

panel:
  alert_retention_days: 7
  alert_sound: warning         # off, critical, warning, info

notifications:
  min_severity: warning        # off, critical, warning, info
  cooldown_minutes: 15
  include_recovery: false
  threshold_preset: backblaze
  history: 7d

webhook_urls:
  - ntfy:https://ntfy.sh/your-topic
  - discord:https://discord.com/api/webhooks/xxx/yyy
  - slack:https://hooks.slack.com/services/xxx/yyy/zzz
```

## Hosts

```yaml
hosts:
  - ssh:root@192.168.1.10      # SSH with specific user
  - ssh:192.168.1.11           # SSH with default user
  - push:192.168.1.12          # Push agent
```

| Prefix | Description |
|--------|-------------|
| `ssh:` | Collect via SSH (default) |
| `push:` | Agent pushes data to server |

## Threshold Presets

| Preset | Use Case |
|--------|----------|
| `relaxed` | Home/lab. Higher thresholds, fewer alerts. |
| `conservative` | Production. Stricter thresholds, early warnings. |
| `backblaze` | Industry standard from 300k+ drive failure data. |
| `custom` | Your own thresholds via the built-in editor. |

## Delta-Based Detection

SMART attributes are categorized:

| Type | Examples | Behavior |
|------|----------|----------|
| Critical state | Reallocated sectors, pending sectors | Always alert if threshold exceeded |
| Cumulative | Command timeouts, unsafe shutdowns | Only alert if increased within delta range |

This prevents old events from spamming alerts while highlighting active problems.

## Push Authentication

When `push_token` is set, agents must include it:

```bash
./bin/diskmind_scan --push http://server:8080 --host 192.168.1.10 --token your-secret-token
```

Without valid token → `401 Unauthorized`.

## Notification Endpoints

Supported services (auto-detected from URL):

| Service | URL Pattern |
|---------|-------------|
| ntfy | `https://ntfy.sh/topic` or `https://your-server/topic` |
| Gotify | `https://gotify.example.com/message?token=...` |
| Discord | `https://discord.com/api/webhooks/...` |
| Slack | `https://hooks.slack.com/services/...` |
| Pushover | `https://api.pushover.net/1/messages.json` |
| Telegram | `https://api.telegram.org/bot.../sendMessage` |
| Generic | Any URL (receives JSON POST) |

## Database

SQLite database at `data/diskmind.db`. Schema migrations run automatically.

Tables: `readings`, `host_status`, `push_attempts`, `alerts`, `notification_log`

Retention controlled by `database.retention_days`.
