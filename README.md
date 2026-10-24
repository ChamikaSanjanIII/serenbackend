# 🚀 Oxenora Backend Deployment & Setup Guide (GitHub & VPS)

ඔබ GitHub එකට Backend එක Manual Push කර, VPS Server එකට `git pull` කර Server එක Run කරන ආකාරය පියවරෙන් පියවර මෙහි දක්වා ඇත.

---

## 📌 පියවර 1: ඔබේ පරිගණකයෙන් GitHub එකට Push කිරීම (Local Machine)

1. `backend` folder එක තුළ `.gitignore` එකක් සාදා ගන්න (හෝ `.env` සහ `node_modules` නොයැවීමට වගබලා ගන්න).
2. Git commit කර GitHub එකට Push කරන්න:
```bash
git add .
git commit -m "Add Oxenora Backend API"
git branch -M main
git push -u origin main
```

---

## 📌 පියවර 2: VPS Server එකට Login වීම (SSH)

ඔබේ Terminal එකෙන් හෝ PuTTY මඟින් VPS එකට Login වන්න:
```bash
ssh root@YOUR_SERVER_IP
```

---

## 📌 පියවර 3: VPS එකට අවශ්‍ය Tools Install කරගැනීම (පළමු වර පමණි)

Server එකේ Node.js, PM2, Git සහ MongoDB නොමැති නම් පහත command එක run කරන්න:
```bash
# System Update
sudo apt update && sudo apt upgrade -y

# Git, Curl, Nginx install කිරීම
sudo apt install -y git curl nginx

# Node.js 20 LTS Install කිරීම
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 Process Manager Install කිරීම
sudo npm install -g pm2

# MongoDB Install කර Start කිරීම (Ubuntu සඳහා)
sudo apt install -y mongodb-org || sudo apt install -y mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

---

## 📌 පියවර 4: GitHub එකෙන් Repo එක Clone / Pull කිරීම

### පළමු වරට (First Time Clone):
```bash
cd /var/www
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git oxenora
cd /var/www/oxenora/backend
```

### පසුව Update කිරීමට අවශ්‍ය වූ විට (Subsequent Updates):
```bash
cd /var/www/oxenora/backend
git pull origin main
```

---

## 📌 පියවර 5: Dependencies Install කිරීම & `.env` File එක සෑදීම

1. Node packages install කරන්න:
```bash
npm install --production
```

2. Production `.env` file එකක් සාදන්න:
```bash
nano .env
```
පහත දත්ත paste කර `CTRL + O` (Save), `ENTER`, `CTRL + X` (Exit) කරන්න:
```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/oxenora
CLIPGO_API_URL=https://api.clipgo.xyz/api
ADMIN_API_KEY=oxenora_super_secret_admin_key_2025
CRON_SYNC_SCHEDULE=0 */6 * * *
FRONTEND_URL=https://oxenora.com
```

---

## 📌 පියවර 6: PM2 මඟින් `seren-api` නමින් Run කිරීම

ඔබගේ VPS එකේ PM2 service name එක **`seren-api`** නම්:

### A. අලුතින් start කරන්නේ නම්:
```bash
pm2 start server.js --name "seren-api"
pm2 save
```

### B. දැනටමත් `seren-api` run වේ නම් restart කිරීමට:
```bash
pm2 restart seren-api
```

### C. Live Logs පරීක්ෂා කිරීමට:
```bash
pm2 logs seren-api
```

---

## 📌 පියවර 7: Sync එක සහ API එක Test කිරීම

Server එක තුළදීම API එක වැඩ කරනවාදැයි පරීක්ෂා කරන්න:

1. **Health Check:**
```bash
curl http://localhost:5000/health
```
Output: `{"status":"ok","service":"oxenora-backend-api",...}`

2. **ClipGo Sync එක Trigger කිරීම:**
```bash
curl -X POST http://localhost:5000/api/sync
```
Output: `{"success":true,"message":"Sync completed successfully...", ...}`

---

## 📌 පියවර 8: Nginx Reverse Proxy (Domain එකෙන් API එක Live කිරීම)

ඔබේ Subdomain එක `api.oxenora.com` ලෙස Backend එකට සම්බන්ධ කිරීමට:

1. Nginx config එකක් සාදන්න:
```bash
sudo nano /etc/nginx/sites-available/oxenora-backend
```

2. පහත config එක paste කරන්න:
```nginx
server {
    listen 80;
    server_name api.oxenora.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

3. Enable කර Nginx restart කරන්න:
```bash
sudo ln -s /etc/nginx/sites-available/oxenora-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

4. නොමිලේ SSL (HTTPS) ලබාගැනීමට:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.oxenora.com
```

---

## 🔄 සෑම update එකකදීම කළ යුතු කෙටි පියවර (Quick Update Workflow)

ඔබ Local එකේ code වෙනස් කර GitHub දැමූ පසු, VPS එකට ගොස් පහත commands 3 පමණක් run කරන්න:
```bash
cd /var/www/oxenora/backend
git pull origin main
npm install
pm2 restart seren-api
```
Backend එක කිසිදු බිඳවැටීමකින් තොරව (Zero downtime) update වේ!
