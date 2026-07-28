# ReavesBot — Username Sniper

Automatically monitors a Real app username and claims it the moment it becomes available.

## Deploy to Railway

### 1. Create GitHub repo
- Go to github.com → New repository → name it `reavesbot` → Create
- Upload all these files into it (drag and drop the whole folder)

### 2. Deploy on Railway
- Go to railway.app → Sign up with GitHub
- Click **New Project** → **Deploy from GitHub repo**
- Select your `reavesbot` repo
- Railway will auto-detect Node.js

### 3. Set build command
In Railway project settings:
- **Build Command**: `npm run build`
- **Start Command**: `npm start`

### 4. Deploy
- Click Deploy — takes about 2 minutes
- Railway gives you a public URL like `https://reavesbot.up.railway.app`

### 5. Use it
- Open the URL on any device
- Click **Connect Account** and paste a raw API request from the Real app
- Enter the username you want to snipe
- Set check interval (5s recommended)
- Click **Start Sniping** — it runs 24/7 on Railway's servers

## Local Development
```bash
npm install
cd client && npm install && cd ..
npm run dev
```
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
