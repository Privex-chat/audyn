# Deployment

A simple guide to cover a production setup of this project on like a Ubuntu 22.04 with Nginx as a reverse proxy, pm2 for process management, and Let's Encrypt for SSL.

## Prerequisites

- Ubuntu 22.04 VPS (2GB RAM minimum recommended)
- Domain pointed at the server's IP (`your-website.com` and `api.your-website.com` or a single domain with path-based routing)
- PostgreSQL 15+ (I used Supabase free tier)
- Node.js 20 LTS
- Python 3.11+
- pm2 (`npm install -g pm2`)
- Certbot

---

## 1. Database

```bash
sudo -u postgres psql -c "CREATE USER audyn WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE audyn OWNER audyn;"
psql -U audyn -d audyn -f backend/schema.sql
```

---

## 2. Backend

```bash
cd /opt/audyn/backend

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create `/opt/audyn/backend/.env`:

```env
DATABASE_URL=postgresql://audyn:your_password@localhost:5432/audyn
JWT_SECRET=<64-char random string — use: openssl rand -hex 32>
CORS_ORIGINS=https://audyn.xyz

SPOTIFY_CLIENT_ID=<optional>
SPOTIFY_CLIENT_SECRET=<optional>

CLOUDINARY_URL=<optional — required for avatars>

DAILY_TRACK_COUNT=10
```

### pm2 ecosystem file

Create `/opt/audyn/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'audyn-api',
      cwd: '/opt/audyn/backend',
      interpreter: '/opt/audyn/backend/venv/bin/python',
      script: '/opt/audyn/backend/venv/bin/uvicorn',
      args: 'server:app --host 127.0.0.1 --port 8000 --workers 2',
      env: { ENV_FILE: '/opt/audyn/backend/.env' },
    },
    {
      name: 'audyn-worker',
      cwd: '/opt/audyn/backend',
      interpreter: '/opt/audyn/backend/venv/bin/python',
      script: 'preview_worker.py',
    },
  ],
};
```

```bash
pm2 start /opt/audyn/ecosystem.config.js
pm2 save
pm2 startup   # follow the output instructions
```

---

## 3. Frontend Build

```bash
cd /opt/audyn/frontend

# Create .env.production
echo "REACT_APP_BACKEND_URL=https://api.audyn.xyz" > .env.production

npm install
npm run build
# Output: /opt/audyn/frontend/build
```

---

## 4. Nginx

```nginx
# /etc/nginx/sites-available/audyn

# Frontend
server {
    listen 80;
    server_name audyn.xyz www.audyn.xyz;
    return 301 https://audyn.xyz$request_uri;
}

server {
    listen 443 ssl http2;
    server_name audyn.xyz;

    ssl_certificate     /etc/letsencrypt/live/audyn.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/audyn.xyz/privkey.pem;

    root /opt/audyn/frontend/build;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|png|jpg|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}

# API
server {
    listen 80;
    server_name api.audyn.xyz;
    return 301 https://api.audyn.xyz$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.audyn.xyz;

    ssl_certificate     /etc/letsencrypt/live/api.audyn.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.audyn.xyz/privkey.pem;

    client_max_body_size 10M;   # avatar uploads

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Needed for audio proxy streaming
        proxy_buffering off;
        proxy_read_timeout 60s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/audyn /etc/nginx/sites-enabled/
certbot --nginx -d audyn.xyz -d api.audyn.xyz
nginx -t && systemctl reload nginx
```

---

## 5. Firewall

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

The FastAPI port (8000) should not be publicly accessible — only Nginx proxies to it.

---

## 6. Deploying Updates

```bash
cd /opt/audyn
git pull

# Backend
source backend/venv/bin/activate
pip install -r backend/requirements.txt
pm2 restart audyn-api audyn-worker

# Frontend
cd frontend
npm install
npm run build
# Build replaces /opt/audyn/frontend/build in-place; Nginx serves immediately
```

---

## 7. Monitoring

```bash
pm2 logs audyn-api        # live API logs
pm2 logs audyn-worker     # preview worker logs
pm2 monit                 # process dashboard
```

PostgreSQL slow query logging can be enabled in `postgresql.conf`:
```
log_min_duration_statement = 1000   # log queries taking > 1s
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | asyncpg-compatible PostgreSQL DSN |
| `JWT_SECRET` | Yes | HMAC secret for token signing |
| `CORS_ORIGINS` | No | Comma-separated allowed origins (default `*`) |
| `SPOTIFY_CLIENT_ID` | No | Enables full playlist pagination via Spotify API |
| `SPOTIFY_CLIENT_SECRET` | No | Required with CLIENT_ID |
| `CLOUDINARY_URL` | No | Required for avatar uploads |
| `CLOUDINARY_CLOUD_NAME` | No | Alternative to CLOUDINARY_URL |
| `CLOUDINARY_API_KEY` | No | Alternative to CLOUDINARY_URL |
| `CLOUDINARY_API_SECRET` | No | Alternative to CLOUDINARY_URL |
| `DAILY_TRACK_COUNT` | No | Tracks per daily challenge (default 10) |
