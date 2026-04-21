# Nexus — GitHub Actions Secrets Setup

## Required Secrets

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add:

| Secret | Value | How to get |
|--------|-------|-----------|
| `SERVER_HOST` | Your server IP or `houssen-serveur.com` | Your server |
| `SERVER_USER` | `houssen` | Your Linux username |
| `SERVER_SSH_KEY` | Private SSH key content | See below |

## Generate SSH Key for CI/CD

Run this **on your local machine**:

```bash
ssh-keygen -t ed25519 -C "nexus-deploy" -f ~/.ssh/nexus_deploy -N ""
```

Copy the **public key** to your server:
```bash
ssh-copy-id -i ~/.ssh/nexus_deploy.pub houssen@YOUR_SERVER_IP
```

Add the **private key** to GitHub Secrets as `SERVER_SSH_KEY`:
```bash
cat ~/.ssh/nexus_deploy
# Copy the entire output including -----BEGIN and -----END lines
```

## First Manual Deploy

SSH into your server and run:
```bash
cd ~ && git clone https://github.com/AlibayPatelHoussen/nexus.git /opt/nexus
cd /opt/nexus && bash scripts/setup-server.sh
```

After that, every push to `main` will auto-deploy via GitHub Actions.

## Cloudflare Tunnel

Add this route in your tunnel config:
```
nexus.houssen-serveur.com → localhost:3001
```

The backend serves both the API (`/api/*`) and the built frontend (`/`).

## Sudoers (for service control)

```bash
sudo cp /opt/nexus/config/sudoers-nexus /etc/sudoers.d/nexus
sudo chmod 440 /etc/sudoers.d/nexus
sudo visudo -c  # verify no syntax errors
```

## Verify Everything Works

```bash
# Check backend is running
pm2 status

# Check logs
pm2 logs nexus-backend

# Test API
curl https://nexus.houssen-serveur.com/api/health
```
