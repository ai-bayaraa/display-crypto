# Crypto TV Live Display (AAVE & BTC)

A real-time, TV-optimized cryptocurrency display dashboard designed for continuous, long-running operation.

## Features
- **Real-Time Data**: Direct Binance WebSocket liquid stream (`@aggTrade` & `@ticker`) with zero delay.
- **Hero AAVE Focus**: Massive, legible typography for AAVE/USDT with BTC/USDT as benchmark.
- **TV & Large Screen Optimized**: High-contrast OLED dark theme with subtle neon accents. Legible from across the room.
- **Silent Stall Watchdog**: Detects network dropouts and automatically refreshes and reconnects.
- **Ultra-Low CPU Architecture**: Event-driven RAF rendering, 0% idle CPU, no heavy backdrop blur kernels.
- **Screen Wake Lock**: Prevents TVs and monitors from sleeping.
- **Fullscreen Mode**: Press `F` or double-click to enter fullscreen.

## Live Access
- **GitHub Pages**: `https://ai-bayaraa.github.io/display-crypto/`

## Quick Start Commands

### 1. Clone Repository
```bash
git clone https://github.com/ai-bayaraa/display-crypto.git
cd display-crypto
```

### 2. Run Locally (Choose Any)

**Using Python 3:**
```bash
python3 -m http.server 3344
```

**Using Node.js (npx):**
```bash
npx serve -l 3344
```

**Using PHP:**
```bash
php -S localhost:3344
```

Then open your browser at:
```text
http://localhost:3344
```

### 3. Git Workflow Commands

**Check status:**
```bash
git status
```

**Pull latest changes:**
```bash
git pull origin main
```

**Commit and push changes (deploys automatically to GitHub Pages):**
```bash
git add .
git commit -m "Your commit message"
git push origin main
```

## Controls & Shortcuts
- `F` or **Double Click**: Toggle Fullscreen Mode
- **Sound Button** (top bar): Click to toggle / test ±2% 15m audio alert

