# Automation

## SSH Mode (Cron)

Collect data hourly from all configured hosts:

```bash
# /etc/cron.d/diskmind
0 * * * * root cd /opt/diskmind && ./diskmind fetch >> /var/log/diskmind-fetch.log 2>&1
```

## SSH Mode (Systemd)

```ini
# /etc/systemd/system/diskmind-fetch.service
[Unit]
Description=diskmind SMART data collection

[Service]
Type=oneshot
WorkingDirectory=/opt/diskmind
ExecStart=/opt/diskmind/diskmind fetch
StandardOutput=journal
StandardError=journal
```

```ini
# /etc/systemd/system/diskmind-fetch.timer
[Unit]
Description=Collect SMART data hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
systemctl enable --now diskmind-fetch.timer
```

## Web Dashboard (Systemd)

Run the dashboard as a service:

```ini
# /etc/systemd/system/diskmind-web.service
[Unit]
Description=diskmind web dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/diskmind
ExecStart=/opt/diskmind/diskmind web --port 8080
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
systemctl enable --now diskmind-web.service
```

## Push Agent (on target hosts)

See [Push Agent Setup](PUSH.md) for cron and systemd examples.

## Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name diskmind.example.com;

    ssl_certificate /etc/letsencrypt/live/diskmind.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/diskmind.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Docker (Coming Soon)

Docker support is planned. For now, use the native installation.
