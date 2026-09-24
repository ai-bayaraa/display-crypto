/**
 * Crypto TV Live Display - 15M Candlesticks & 2% Move Audio Alert System
 *
 * Features:
 * 1. 15-Minute Candlestick Chart: Real-time rendering via Binance REST + @kline_15m stream.
 * 2. 2% Audio Alert: Synthesizes melodic ascending / descending alerts on ±2% 15m moves.
 * 3. Zero-Idle CPU: Event-driven render loop, background suspension, and resource capping.
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
    candles: [], // [{ time, open, high, low, close, volume, isClosed, alertedUp, alertedDown }]
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
    candles: [],
    canvas: null,
    isDirty: false,
    lastTickDir: null,
    lastTickTime: 0
  },
  ws: null,
  reconnectAttempts: 0,
  maxCandles: 35,
  soundEnabled: true,
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
  aaveCandleSub: document.getElementById('aaveCandleSub'),

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
  btcCandleSub: document.getElementById('btcCandleSub'),

  // Header & Status & Alerts
  connectionStatus: document.getElementById('connectionStatus'),
  statusLabel: document.getElementById('statusLabel'),
  pingBadge: document.getElementById('pingBadge'),
  liveTime: document.getElementById('liveTime'),
  liveDate: document.getElementById('liveDate'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  wakeLockStatus: document.getElementById('wakeLockStatus'),
  lastSyncText: document.getElementById('lastSyncText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundIcon: document.getElementById('soundIcon'),
  soundLabel: document.getElementById('soundLabel'),
  toastContainer: document.getElementById('toastContainer')
};

// Cached canvas dimensions
const canvasDims = {
  aave: { w: 0, h: 0, dpr: 1 },
  btc: { w: 0, h: 0, dpr: 1 }
};

// Audio Context Singleton for Sound Alert
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play synthesizer audio alert for ±2% 15m moves
 * - type 'up': Ascending melodic chime (C5 -> E5 -> G5 -> C6)
 * - type 'down': Descending alert chime (G5 -> Eb5 -> C5 -> G4)
 */
function playAlertSound(type = 'up') {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const isUp = type === 'up';

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.28, now);
  masterGain.connect(ctx.destination);

  const notes = isUp
    ? [523.25, 659.25, 783.99, 1046.50]
    : [783.99, 622.25, 523.25, 392.00];

  const noteDuration = 0.12;

  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isUp ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * noteDuration);

    gain.gain.setValueAtTime(0.001, now + idx * noteDuration);
    gain.gain.exponentialRampToValueAtTime(0.28, now + idx * noteDuration + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (idx + 1) * noteDuration + 0.06);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now + idx * noteDuration);
    osc.stop(now + (idx + 1) * noteDuration + 0.07);
  });
}

// Visual Toast notification on 2% move
function showToastAlert(coinKey, pct, dir, price) {
  if (!DOM.toastContainer) return;

  const toast = document.createElement('div');
  const isUp = dir === 'up';
  toast.className = `toast-alert ${isUp ? 'toast-up' : 'toast-down'}`;
  const coinSymbol = coinKey === 'aave' ? 'AAVE' : 'BTC';
  const sign = isUp ? '+' : '';
  const arrow = isUp ? '▲' : '▼';

  toast.innerHTML = `
    <span>${isUp ? '🚀' : '⚠️'}</span>
    <span><strong>${coinSymbol}</strong> 15m Move: ${arrow} ${sign}${pct.toFixed(2)}% ($${formatUSD(price)})</span>
  `;

  DOM.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fade-out');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 400);
  }, 5000);
}

// Check 2% movement threshold on 15m candle
function checkCandleMoveAlert(coinKey, candle) {
  if (!candle || !candle.open) return;
  const pct = ((candle.close - candle.open) / candle.open) * 100;

  if (pct >= 2.0 && !candle.alertedUp) {
    candle.alertedUp = true;
    playAlertSound('up');
    showToastAlert(coinKey, pct, 'up', candle.close);
  } else if (pct <= -2.0 && !candle.alertedDown) {
    candle.alertedDown = true;
    playAlertSound('down');
    showToastAlert(coinKey, pct, 'down', candle.close);
  }
}

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
 * 15-Minute Candlestick Chart Renderer
 */
function renderCandlesticks(coinKey) {
  const coin = state[coinKey];
  const canvas = coin.canvas;
  const dims = canvasDims[coinKey];
  if (!canvas || !dims || dims.w === 0) return;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dims.dpr, dims.dpr);
  const candles = coin.candles;
  if (!candles || candles.length === 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '12px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading 15m Candlesticks...', dims.w / 2, dims.h / 2);
    ctx.restore();
    return;
  }

  // Update candle subtitle stats
  const lastCandle = candles[candles.length - 1];
  const subEl = coinKey === 'aave' ? DOM.aaveCandleSub : DOM.btcCandleSub;
  if (subEl && lastCandle && lastCandle.open) {
    const candlePct = ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100;
    const isUp = candlePct >= 0;
    const color = isUp ? 'var(--green)' : 'var(--red)';
    subEl.innerHTML = `<span style="color: ${color}; font-weight: 700;">15m: ${isUp ? '+' : ''}${candlePct.toFixed(2)}%</span> &bull; O: $${formatUSD(lastCandle.open)} &bull; H: $${formatUSD(lastCandle.high)} &bull; L: $${formatUSD(lastCandle.low)}`;
  }

  // Calculate min and max across all candles
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }

  const range = (max - min) || (max * 0.005) || 1;
  const padPrice = range * 0.09;
  const effMin = min - padPrice;
  const effMax = max + padPrice;
  const effRange = effMax - effMin;

  const getY = (val) => dims.h - ((val - effMin) / effRange) * dims.h;

  const rightPad = 62;
  const chartW = dims.w - rightPad;

  // Grid reference lines & prices
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  [0.2, 0.5, 0.8].forEach(ratio => {
    const p = effMin + effRange * ratio;
    const y = getY(p);
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(`$${formatUSD(p)}`, dims.w - 5, y);
  });

  // Candlesticks
  const count = candles.length;
  const slotW = chartW / count;
  const bodyW = Math.max(3, Math.min(16, slotW * 0.72));

  for (let i = 0; i < count; i++) {
    const c = candles[i];
    const isBull = c.close >= c.open;
    const color = isBull ? '#0ecb81' : '#f6465d';
    const xCenter = (i + 0.5) * slotW;

    const yOpen = getY(c.open);
    const yClose = getY(c.close);
    const yHigh = getY(c.high);
    const yLow = getY(c.low);

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(xCenter, yHigh);
    ctx.lineTo(xCenter, yLow);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(2, Math.abs(yClose - yOpen));
    ctx.fillStyle = color;
    ctx.fillRect(xCenter - bodyW / 2, bodyTop, bodyW, bodyH);

    // Active candle marker
    if (i === count - 1) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(xCenter - bodyW / 2 - 1, bodyTop - 1, bodyW + 2, bodyH + 2);
    }
  }

  // Current price line & tag badge
  const curPrice = coin.price || lastCandle.close;
  const curY = getY(curPrice);
  const curIsBull = lastCandle.close >= lastCandle.open;
  const curColor = curIsBull ? '#0ecb81' : '#f6465d';

  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = curColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, curY);
  ctx.lineTo(chartW, curY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Tag badge on right
  const badgeH = 18;
  const badgeW = rightPad - 4;
  const badgeY = Math.max(2, Math.min(dims.h - badgeH - 2, curY - badgeH / 2));
  ctx.fillStyle = curColor;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(chartW + 2, badgeY, badgeW, badgeH, 4);
    ctx.fill();
  } else {
    ctx.fillRect(chartW + 2, badgeY, badgeW, badgeH);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(curPrice.toFixed(coinKey === 'aave' ? 2 : 1), chartW + 2 + badgeW / 2, badgeY + badgeH / 2);

  ctx.restore();
}

/**
 * Event-Driven Render Scheduler
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

      // Redraw canvas 15m candlesticks
      renderCandlesticks(key);

      // Update range slider
      updateRangeBar(isAave, coin.price, coin.low, coin.high);
    }
  });
}

// Ingest Trade Update
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

  // Update current active candle live
  if (coin.candles.length > 0) {
    const currentCandle = coin.candles[coin.candles.length - 1];
    currentCandle.close = numPrice;
    if (numPrice > currentCandle.high) currentCandle.high = numPrice;
    if (numPrice < currentCandle.low) currentCandle.low = numPrice;
    checkCandleMoveAlert(isAave ? 'aave' : 'btc', currentCandle);
  }

  coin.isDirty = true;
  state.lastMsgTime = Date.now();

  scheduleRender();
}

// Ingest Kline Stream Update (15m)
function ingestKline(symbol, k) {
  const isAave = symbol.toUpperCase() === 'AAVEUSDT';
  const coinKey = isAave ? 'aave' : 'btc';
  const coin = state[coinKey];

  const time = Number(k.t);
  const open = Number(k.o);
  const high = Number(k.h);
  const low = Number(k.l);
  const close = Number(k.c);
  const volume = Number(k.v);
  const isClosed = k.x;

  let candle = coin.candles.find(c => c.time === time);
  if (candle) {
    candle.high = high;
    candle.low = low;
    candle.close = close;
    candle.volume = volume;
    candle.isClosed = isClosed;
  } else {
    candle = {
      time,
      open,
      high,
      low,
      close,
      volume,
      isClosed,
      alertedUp: false,
      alertedDown: false
    };
    coin.candles.push(candle);
    if (coin.candles.length > state.maxCandles) {
      coin.candles.shift();
    }
  }

  if (close) {
    coin.price = close;
  }

  checkCandleMoveAlert(coinKey, candle);

  coin.isDirty = true;
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

// REST Snapshot API with multi-endpoint fallback
async function fetchRestSnapshot() {
  const endpoints = [
    'https://api.binance.com/api/v3/ticker/24hr?symbols=["AAVEUSDT","BTCUSDT"]',
    'https://data-api.binance.vision/api/v3/ticker/24hr?symbols=["AAVEUSDT","BTCUSDT"]'
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        data.forEach(item => {
          ingestTicker(item.symbol, item);
        });
        DOM.connectionStatus.classList.add('connected');
        DOM.connectionStatus.classList.remove('disconnected');
        return;
      }
    } catch (err) {}
  }
}

async function loadKlineHistory(symbol, coinKey) {
  const endpoints = [
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=35`,
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=15m&limit=35`
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const klines = await res.json();
        if (Array.isArray(klines) && klines.length > 0) {
          state[coinKey].candles = klines.map(k => ({
            time: Number(k[0]),
            open: Number(k[1]),
            high: Number(k[2]),
            low: Number(k[3]),
            close: Number(k[4]),
            volume: Number(k[5]),
            isClosed: true,
            alertedUp: false,
            alertedDown: false
          }));
          state[coinKey].isDirty = true;
          scheduleRender();
          return;
        }
      }
    } catch (e) {}
  }
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
    'btcusdt@aggTrade',
    'aaveusdt@kline_15m',
    'btcusdt@kline_15m'
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
        } else if (stream.endsWith('@kline_15m')) {
          ingestKline(data.s, data.k);
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

    // 3. Watchdog check
    const elapsed = now - state.lastMsgTime;
    if (elapsed > 5500) {
      DOM.connectionStatus.classList.remove('connected');
      DOM.connectionStatus.classList.add('disconnected');
      DOM.statusLabel.textContent = 'REVIVING STREAM...';
      fetchRestSnapshot();
      state.isConnecting = false;
      connectWebSocket();
    }

    // 4. Background safety sync (every 30s)
    if (state.heartbeatTicks % 30 === 0) {
      fetchRestSnapshot();
    }
  }, 1000);
}

// Sound Control Setup & AudioContext Auto-unlock
function setupSoundControl() {
  if (!DOM.soundToggleBtn) return;

  const updateSoundUI = () => {
    if (state.soundEnabled) {
      DOM.soundToggleBtn.classList.remove('sound-muted');
      DOM.soundIcon.textContent = '🔔';
      DOM.soundLabel.textContent = 'SOUND: ON (±2%)';
    } else {
      DOM.soundToggleBtn.classList.add('sound-muted');
      DOM.soundIcon.textContent = '🔕';
      DOM.soundLabel.textContent = 'SOUND: MUTED';
    }
  };

  DOM.soundToggleBtn.addEventListener('click', () => {
    getAudioContext();
    state.soundEnabled = !state.soundEnabled;
    updateSoundUI();
    if (state.soundEnabled) {
      playAlertSound('up'); // Immediate test sound confirmation
    }
  });

  // Browser Autoplay policy: unlock on first gesture
  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
  };
  window.addEventListener('click', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('touchstart', unlockAudio);

  updateSoundUI();
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

// Visibility change handler
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    state.isRenderScheduled = false;
  } else {
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
  const tvUrlEl = document.querySelector('.tv-url-tip strong');
  if (tvUrlEl && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && !window.location.hostname.startsWith('192.168.')) {
    tvUrlEl.textContent = window.location.origin + window.location.pathname;
  }

  setupSoundControl();
  initSparklines();
  startConsolidatedHeartbeat();

  // 1. Initial REST snapshot
  await fetchRestSnapshot();

  // 2. Load historical 15m candles
  loadKlineHistory('AAVEUSDT', 'aave');
  loadKlineHistory('BTCUSDT', 'btc');

  // 3. Connect real-time WebSocket
  connectWebSocket();

  // 4. Request screen wake lock
  requestScreenWakeLock();
});
