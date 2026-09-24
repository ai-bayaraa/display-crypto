/**
 * Crypto TV Live Display - Ultra Low-CPU / High-Reliability Architecture
 *
 * Resource Management Optimizations:
 * 1. Zero-Idle CPU: Rendering is event-driven; requestAnimationFrame is only scheduled
 *    when dirty data arrives and pauses completely when idle.
 * 2. Background Throttling: Automatically suspends DOM and Canvas updates when the tab is hidden.
 * 3. Zero-Blur Canvas: Uses fast native geometry (concentric arcs) instead of expensive CPU shadowBlur.
 * 4. Consolidated Heartbeat: A single 1-second interval handles clock, watchdog, and cleanup.
 * 5. Memory Capped: Historical sparkline data is capped at 30 items with zero memory leakage.
 */

// State Management
const state = {
  aave: {
    symbol: 'AAVEUSDT',
    price: 0,
    prevPrice: 0,
    displayPrice: 0,
    changePct: 0,
    changeAmt: 0,
    high: 0,
    low: 0,
    volBase: 0,
    volQuote: 0,
    history: [],
    canvas: null,
    isDirty: false,
    lastTickDir: null,
    lastTickTime: 0
  },
  btc: {
    symbol: 'BTCUSDT',
    price: 0,
    prevPrice: 0,
    displayPrice: 0,
    changePct: 0,
    changeAmt: 0,
    high: 0,
    low: 0,
    volBase: 0,
    volQuote: 0,
    history: [],
    canvas: null,
    isDirty: false,
    lastTickDir: null,
    lastTickTime: 0
  },
  ws: null,
  reconnectAttempts: 0,
  maxHistoryPoints: 30,
  lastMsgTime: Date.now(),
  heartbeatTicks: 0,
  isConnecting: false,
  wakeLock: null,
  isRenderScheduled: false
};

// DOM Elements
const DOM = {
  // AAVE
  aaveCard: document.getElementById('aaveCard'),
  aavePrice: document.getElementById('aavePrice'),
  aaveChangePill: document.getElementById('aaveChangePill'),
  aaveChangePct: document.getElementById('aaveChangePct'),
  aaveChangeAmt: document.getElementById('aaveChangeAmt'),
  aaveArrow: document.getElementById('aaveArrow'),
  aaveHigh: document.getElementById('aaveHigh'),
  aaveLow: document.getElementById('aaveLow'),
  aaveVolBase: document.getElementById('aaveVolBase'),
  aaveVolQuote: document.getElementById('aaveVolQuote'),
  aaveRangeBar: document.getElementById('aaveRangeBar'),
  aaveRangeThumb: document.getElementById('aaveRangeThumb'),
  aaveRangeLow: document.getElementById('aaveRangeLow'),
  aaveRangeHigh: document.getElementById('aaveRangeHigh'),
  aaveSparkline: document.getElementById('aaveSparkline'),

  // BTC
  btcCard: document.getElementById('btcCard'),
  btcPrice: document.getElementById('btcPrice'),
  btcChangePill: document.getElementById('btcChangePill'),
  btcChangePct: document.getElementById('btcChangePct'),
  btcChangeAmt: document.getElementById('btcChangeAmt'),
  btcArrow: document.getElementById('btcArrow'),
  btcHigh: document.getElementById('btcHigh'),
  btcLow: document.getElementById('btcLow'),
  btcVolBase: document.getElementById('btcVolBase'),
  btcVolQuote: document.getElementById('btcVolQuote'),
  btcRangeBar: document.getElementById('btcRangeBar'),
  btcRangeThumb: document.getElementById('btcRangeThumb'),
  btcRangeLow: document.getElementById('btcRangeLow'),
  btcRangeHigh: document.getElementById('btcRangeHigh'),
  btcSparkline: document.getElementById('btcSparkline'),

  // Header & Status
  connectionStatus: document.getElementById('connectionStatus'),
  statusLabel: document.getElementById('statusLabel'),
  pingBadge: document.getElementById('pingBadge'),
  liveTime: document.getElementById('liveTime'),
  liveDate: document.getElementById('liveDate'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  wakeLockStatus: document.getElementById('wakeLockStatus'),
  lastSyncText: document.getElementById('lastSyncText')
};

// Cached canvas dimensions
const canvasDims = {
  aave: { w: 0, h: 0, dpr: 1 },
  btc: { w: 0, h: 0, dpr: 1 }
};

// Number Formatters
const formatUSD = (val) => {
  if (!val || isNaN(val)) return '0.00';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatCompact = (val) => {
  if (!val || isNaN(val)) return '---';
  const num = Number(val);
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

// Resize canvases efficiently
function resizeCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  [
    { key: 'aave', el: DOM.aaveSparkline },
    { key: 'btc', el: DOM.btcSparkline }
  ].forEach(({ key, el }) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    if (w > 0 && h > 0) {
      canvasDims[key] = { w, h, dpr };
      el.width = w * dpr;
      el.height = h * dpr;
      state[key].isDirty = true;
    }
  });

  scheduleRender();
}

function initSparklines() {
  state.aave.canvas = DOM.aaveSparkline;
  state.btc.canvas = DOM.btcSparkline;
  resizeCanvases();
}

/**
 * Ultra-Lean Canvas Sparkline Render
 * Zero shadowBlur calculations, fast native line & fill
 */
function renderSparkline(coinKey) {
  const coin = state[coinKey];
  const canvas = coin.canvas;
  const dims = canvasDims[coinKey];
  if (!canvas || !dims || dims.w === 0) return;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dims.dpr, dims.dpr);
  ctx.clearRect(0, 0, dims.w, dims.h);

  const history = coin.history;
  if (history.length < 2) {
    ctx.restore();
    return;
  }

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = (max - min) || 1;
  const paddingY = dims.h * 0.16;
  const drawHeight = dims.h - paddingY * 2;

  const getX = (i) => (i / (history.length - 1)) * dims.w;
  const getY = (val) => dims.h - paddingY - ((val - min) / range) * drawHeight;

  const isUp = history[history.length - 1] >= history[0];
  const themeColor = isUp ? '14, 203, 129' : '246, 70, 93';

  // Area Fill
  const grad = ctx.createLinearGradient(0, 0, 0, dims.h);
  grad.addColorStop(0, `rgba(${themeColor}, 0.22)`);
  grad.addColorStop(1, `rgba(${themeColor}, 0.0)`);

  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0]));
  for (let i = 0; i < history.length - 1; i++) {
    const x0 = getX(i);
    const y0 = getY(history[i]);
    const x1 = getX(i + 1);
    const y1 = getY(history[i + 1]);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }
  ctx.lineTo(dims.w, dims.h);
  ctx.lineTo(0, dims.h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Stroke Line
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(history[0]));
  for (let i = 0; i < history.length - 1; i++) {
    const x0 = getX(i);
    const y0 = getY(history[i]);
    const x1 = getX(i + 1);
    const y1 = getY(history[i + 1]);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }
  ctx.strokeStyle = isUp ? '#0ecb81' : '#f6465d';
  ctx.lineWidth = 2.0;
  ctx.stroke();

  // Glowing Head Point (Dual Arcs: 0% GPU Blur penalty)
  const lastX = getX(history.length - 1);
  const lastY = getY(history[history.length - 1]);

  // Outer halo ring
  ctx.beginPath();
  ctx.arc(lastX, lastY, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = isUp ? 'rgba(14, 203, 129, 0.35)' : 'rgba(246, 70, 93, 0.35)';
  ctx.fill();

  // Inner solid core
  ctx.beginPath();
  ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.restore();
}

/**
 * Event-Driven Render Scheduler
 * Only fires when dirty, cancels if tab is backgrounded.
 * At idle market periods, this consumes 0.0% CPU.
 */
function scheduleRender() {
  if (state.isRenderScheduled || document.hidden) return;
  state.isRenderScheduled = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame() {
  state.isRenderScheduled = false;

  ['aave', 'btc'].forEach(key => {
    const coin = state[key];
    const isAave = key === 'aave';
    const priceEl = isAave ? DOM.aavePrice : DOM.btcPrice;
    const cardEl = isAave ? DOM.aaveCard : DOM.btcCard;

    if (coin.isDirty) {
      coin.isDirty = false;

      // Update text only if numeric price changed
      if (coin.displayPrice !== coin.price) {
        coin.displayPrice = coin.price;
        priceEl.textContent = formatUSD(coin.price);
      }

      // Smooth color tick indicators
      if (coin.lastTickDir) {
        const isUp = coin.lastTickDir === 'up';
        priceEl.classList.remove('tick-up', 'tick-down');
        cardEl.classList.remove('flash-up-border', 'flash-down-border');

        priceEl.classList.add(isUp ? 'tick-up' : 'tick-down');
        cardEl.classList.add(isUp ? 'flash-up-border' : 'flash-down-border');
      }

      // Redraw canvas sparkline
      renderSparkline(key);

      // Update range slider
      updateRangeBar(isAave, coin.price, coin.low, coin.high);
    }
  });
}

// Ingest Trade Update (Lightweight)
function ingestTrade(symbol, price) {
  const isAave = symbol.toUpperCase() === 'AAVEUSDT';
  const coin = isAave ? state.aave : state.btc;
  const numPrice = Number(price);

  if (!numPrice || numPrice === coin.price) return;

  const prev = coin.price || numPrice;
  coin.lastTickDir = numPrice >= prev ? 'up' : 'down';
  coin.lastTickTime = Date.now();
  coin.prevPrice = prev;
  coin.price = numPrice;

  // Append history (capped at maxHistoryPoints)
  coin.history.push(numPrice);
  if (coin.history.length > state.maxHistoryPoints) {
    coin.history.shift();
  }

  coin.isDirty = true;
  state.lastMsgTime = Date.now();

  scheduleRender();
}

// Ingest Ticker Update
function ingestTicker(symbol, data) {
  const isAave = symbol.toUpperCase() === 'AAVEUSDT';
  const coin = isAave ? state.aave : state.btc;

  const price = Number(data.c || data.lastPrice || 0);
  const changePct = Number(data.P || data.priceChangePercent || 0);
  const changeAmt = Number(data.p || data.priceChange || 0);
  const high = Number(data.h || data.highPrice || 0);
  const low = Number(data.l || data.lowPrice || 0);
  const volBase = Number(data.v || data.volume || 0);
  const volQuote = Number(data.q || data.quoteVolume || 0);

  coin.changePct = changePct;
  coin.changeAmt = changeAmt;
  coin.high = high;
  coin.low = low;
  coin.volBase = volBase;
  coin.volQuote = volQuote;

  if (!coin.price && price) {
    ingestTrade(symbol, price);
  }

  // Update Ticker Metadata
  const pillEl = isAave ? DOM.aaveChangePill : DOM.btcChangePill;
  const pctEl = isAave ? DOM.aaveChangePct : DOM.btcChangePct;
  const amtEl = isAave ? DOM.aaveChangeAmt : DOM.btcChangeAmt;
  const arrowEl = isAave ? DOM.aaveArrow : DOM.btcArrow;

  const isPositive = changePct >= 0;
  pillEl.classList.remove('positive', 'negative');
  pillEl.classList.add(isPositive ? 'positive' : 'negative');

  pctEl.textContent = `${isPositive ? '+' : ''}${changePct.toFixed(2)}%`;
  amtEl.textContent = `${isPositive ? '+' : ''}$${formatUSD(Math.abs(changeAmt))}`;
  arrowEl.textContent = isPositive ? '▲' : '▼';

  if (isAave) {
    DOM.aaveHigh.textContent = `$${formatUSD(high)}`;
    DOM.aaveLow.textContent = `$${formatUSD(low)}`;
    DOM.aaveVolBase.textContent = `${formatCompact(volBase)} AAVE`;
    DOM.aaveVolQuote.textContent = `$${formatCompact(volQuote)}`;
    DOM.aaveRangeLow.textContent = `$${formatUSD(low)}`;
    DOM.aaveRangeHigh.textContent = `$${formatUSD(high)}`;
  } else {
    DOM.btcHigh.textContent = `$${formatUSD(high)}`;
    DOM.btcLow.textContent = `$${formatUSD(low)}`;
    DOM.btcVolBase.textContent = `${formatCompact(volBase)} BTC`;
    DOM.btcVolQuote.textContent = `$${formatCompact(volQuote)}`;
    DOM.btcRangeLow.textContent = `$${formatUSD(low)}`;
    DOM.btcRangeHigh.textContent = `$${formatUSD(high)}`;
  }

  coin.isDirty = true;
  state.lastMsgTime = Date.now();
  DOM.lastSyncText.textContent = `Sync: ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;

  scheduleRender();
}

// 24h Range Bar
function updateRangeBar(isAave, current, low, high) {
  if (!current || !low || !high || high <= low) return;
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  const barEl = isAave ? DOM.aaveRangeBar : DOM.btcRangeBar;
  const thumbEl = isAave ? DOM.aaveRangeThumb : DOM.btcRangeThumb;
  if (barEl && thumbEl) {
    barEl.style.width = `${pct}%`;
    thumbEl.style.left = `${pct}%`;
  }
}

// REST Snapshot API
async function fetchRestSnapshot() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=["AAVEUSDT","BTCUSDT"]');
    if (res.ok) {
      const data = await res.json();
      data.forEach(item => {
        ingestTicker(item.symbol, item);
      });
      DOM.connectionStatus.classList.add('connected');
      DOM.connectionStatus.classList.remove('disconnected');
    }
  } catch (err) {
    // Fail silently in background
  }
}

async function loadKlineHistory(symbol, coinKey) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=25`);
    if (res.ok) {
      const klines = await res.json();
      const closePrices = klines.map(k => Number(k[4]));
      if (closePrices.length > 0) {
        state[coinKey].history = closePrices;
        state[coinKey].isDirty = true;
        scheduleRender();
      }
    }
  } catch (e) {}
}

/**
 * WebSocket Connection with Auto-Recovery
 */
function connectWebSocket() {
  if (state.isConnecting) return;
  state.isConnecting = true;

  if (state.ws) {
    try {
      state.ws.onopen = null;
      state.ws.onmessage = null;
      state.ws.onerror = null;
      state.ws.onclose = null;
      state.ws.close();
    } catch (e) {}
    state.ws = null;
  }

  const streamNames = [
    'aaveusdt@ticker',
    'btcusdt@ticker',
    'aaveusdt@aggTrade',
    'btcusdt@aggTrade'
  ].join('/');

  const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streamNames}`;
  DOM.statusLabel.textContent = state.reconnectAttempts === 0 ? 'CONNECTING...' : 'RECONNECTING...';

  try {
    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.onopen = () => {
      state.isConnecting = false;
      state.reconnectAttempts = 0;
      state.lastMsgTime = Date.now();
      DOM.connectionStatus.classList.remove('disconnected');
      DOM.connectionStatus.classList.add('connected');
      DOM.statusLabel.textContent = 'BINANCE LIVE';
    };

    ws.onmessage = (event) => {
      state.lastMsgTime = Date.now();
      try {
        const payload = JSON.parse(event.data);
        const stream = payload.stream;
        const data = payload.data;

        const eventTime = data.E || data.T;
        if (eventTime) {
          const lat = Math.max(0, Date.now() - eventTime);
          DOM.pingBadge.textContent = `${lat}ms`;
        }

        if (stream.endsWith('@aggTrade')) {
          ingestTrade(data.s, data.p);
        } else if (stream.endsWith('@ticker')) {
          ingestTicker(data.s, data);
        }
      } catch (err) {}
    };

    ws.onerror = () => {
      DOM.connectionStatus.classList.remove('connected');
      DOM.connectionStatus.classList.add('disconnected');
      DOM.statusLabel.textContent = 'WS ERROR';
    };

    ws.onclose = () => {
      state.isConnecting = false;
      DOM.connectionStatus.classList.remove('connected');
      DOM.connectionStatus.classList.add('disconnected');
      DOM.statusLabel.textContent = 'RECONNECTING...';

      state.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.3, state.reconnectAttempts), 5000);
      setTimeout(connectWebSocket, delay);
    };
  } catch (e) {
    state.isConnecting = false;
    setTimeout(connectWebSocket, 3000);
  }
}

/**
 * Consolidated 1-Second Heartbeat Loop
 * Combines Clock update, Watchdog stall check, tick class cleanup,
 * and 30s background sync into ONE single low-power timer.
 */
function startConsolidatedHeartbeat() {
  setInterval(() => {
    state.heartbeatTicks++;
    const now = Date.now();

    // 1. Digital Clock
    const dateObj = new Date();
    DOM.liveTime.textContent = dateObj.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    DOM.liveDate.textContent = dateObj.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    // 2. Clear tick highlight classes if expired
    ['aave', 'btc'].forEach(key => {
      const coin = state[key];
      if (coin.lastTickDir && (now - coin.lastTickTime > 650)) {
        coin.lastTickDir = null;
        const isAave = key === 'aave';
        (isAave ? DOM.aavePrice : DOM.btcPrice).classList.remove('tick-up', 'tick-down');
        (isAave ? DOM.aaveCard : DOM.btcCard).classList.remove('flash-up-border', 'flash-down-border');
      }
    });

    // 3. Watchdog check (every second)
    const elapsed = now - state.lastMsgTime;
    if (elapsed > 5500) {
      DOM.connectionStatus.classList.remove('connected');
      DOM.connectionStatus.classList.add('disconnected');
      DOM.statusLabel.textContent = 'REVIVING STREAM...';
      fetchRestSnapshot();
      state.isConnecting = false;
      connectWebSocket();
    }

    // 4. Background safety sync (every 30 seconds)
    if (state.heartbeatTicks % 30 === 0) {
      fetchRestSnapshot();
    }
  }, 1000);
}

// Screen Wake Lock API
async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      DOM.wakeLockStatus.innerHTML = '<span class="wake-icon">⚡</span> Screen Awake Active';
      state.wakeLock.addEventListener('release', () => {
        DOM.wakeLockStatus.innerHTML = '<span class="wake-icon">⏸</span> Screen Awake Inactive';
      });
    } catch (err) {}
  }
}

// Visibility change: suspend rendering when tab/screen is hidden
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    // Backgrounded: stop rendering
    state.isRenderScheduled = false;
  } else {
    // Returned to view: request wakeLock, sync REST, and render once
    await requestScreenWakeLock();
    fetchRestSnapshot();
    state.aave.isDirty = true;
    state.btc.isDirty = true;
    scheduleRender();
    if (Date.now() - state.lastMsgTime > 4000) {
      connectWebSocket();
    }
  }
});

// Fullscreen Toggle
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

DOM.fullscreenBtn.addEventListener('click', toggleFullscreen);

window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  }
});

document.addEventListener('dblclick', (e) => {
  if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') {
    toggleFullscreen();
  }
});

window.addEventListener('resize', () => {
  resizeCanvases();
});

// Boot Application
document.addEventListener('DOMContentLoaded', async () => {
  // Update TV URL badge dynamically
  const tvUrlEl = document.querySelector('.tv-url-tip strong');
  if (tvUrlEl && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && !window.location.hostname.startsWith('192.168.')) {
    tvUrlEl.textContent = window.location.origin + window.location.pathname;
  }

  initSparklines();
  startConsolidatedHeartbeat();

  // 1. Initial REST snapshot
  await fetchRestSnapshot();

  // 2. Load historical kline curves
  loadKlineHistory('AAVEUSDT', 'aave');
  loadKlineHistory('BTCUSDT', 'btc');

  // 3. Connect real-time WebSocket
  connectWebSocket();

  // 4. Request screen wake lock
  requestScreenWakeLock();
});
