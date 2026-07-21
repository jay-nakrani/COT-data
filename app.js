// ---------------------------------------------------------------------------
// COT Desk — shared front-end logic (no build step; plain fetch + DOM)
// ---------------------------------------------------------------------------

const DATA_URL = "data/cot.json";
let __DATA__ = null;

async function loadData() {
  if (__DATA__) return __DATA__;
  const res = await fetch(DATA_URL);
  const json = await res.json();
  __DATA__ = json;
  const meta = document.getElementById("meta");
  if (meta) {
    const asOf = json.assets[0]?.weeks?.slice(-1)[0]?.date || "";
    meta.innerHTML = `<span class="dot"></span>${json.assets.length} pairs tracked · latest week ${asOf}`;
  }
  return json;
}

function fmtInt(n) {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString("en-US");
}
function fmtSigned(n) {
  if (n === null || n === undefined) return "—";
  const s = Math.round(n).toLocaleString("en-US");
  return n > 0 ? "+" + s : s;
}
function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return (n * 100).toFixed(1) + "%";
}
function fmtCompact2(n) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000000) return (n / 1000000).toFixed(2) + "M";
  if (abs >= 1000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n).toLocaleString("en-US");
}
function fmtPrice(n) {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 10) return n.toFixed(4);
  if (Math.abs(n) < 1000) return n.toFixed(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtSigned2(n) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  const s = abs < 10 ? abs.toFixed(4) : abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (n >= 0 ? "+" : "-") + s;
}
function dirClass(n) {
  if (n === null || n === undefined || n === 0) return "";
  return n > 0 ? "pos" : "neg";
}

// Build a small inline SVG sparkline from an array of numbers.
function sparklineSVG(values, w = 240, h = 40, colorVar = "--amber") {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 4;
  const step = (w - pad * 2) / (values.length - 1 || 1);
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  const zeroY = h - pad - ((0 - min) / range) * (h - pad * 2);
  const zeroLine = (min < 0 && max > 0)
    ? `<line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${w - pad}" y2="${zeroY.toFixed(1)}" stroke="#23272f" stroke-width="1" stroke-dasharray="2,2"/>`
    : "";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    ${zeroLine}
    <path d="${path}" fill="none" stroke="var(${colorVar})" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="var(${colorVar})"/>
  </svg>`;
}

// Build a horizontal "where are we in the range" gauge.
function rangeGaugeSVG(min, max, current, w = 100, h = 28) {
  const range = max - min || 1;
  const pad = 3;
  const trackY = h / 2;
  const pct = Math.min(1, Math.max(0, (current - min) / range));
  const x = pad + pct * (w - pad * 2);
  const zeroPct = min < 0 && max > 0 ? Math.min(1, Math.max(0, (0 - min) / range)) : null;
  const zeroX = zeroPct !== null ? pad + zeroPct * (w - pad * 2) : null;
  const color = pct >= 0.8 ? "var(--green)" : pct <= 0.2 ? "var(--red)" : "var(--amber)";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="${pad}" y1="${trackY}" x2="${w - pad}" y2="${trackY}" stroke="#23272f" stroke-width="3" stroke-linecap="round"/>
    ${zeroX !== null ? `<line x1="${zeroX.toFixed(1)}" y1="${trackY - 5}" x2="${zeroX.toFixed(1)}" y2="${trackY + 5}" stroke="#3a3f48" stroke-width="1"/>` : ""}
    <circle cx="${x.toFixed(1)}" cy="${trackY}" r="4.5" fill="${color}" stroke="#0a0c10" stroke-width="1.5"/>
  </svg>`;
}

// Range/percentile/streak/trend stats for the speculative net-position series.
function computeInsights(asset) {
  const weeks = asset.weeks;
  const vals = weeks.map(w => w.specNet);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const latest = vals[vals.length - 1];
  const pct = (max - min) !== 0 ? (latest - min) / (max - min) : 0.5;

  // streak: consecutive weeks (from the end) moving in the same direction
  let streak = 0;
  let streakDir = null;
  for (let i = weeks.length - 1; i > 0; i--) {
    const d = weeks[i].specDir;
    if (!d || d === "FLAT") break;
    if (streakDir === null) { streakDir = d; streak = 1; }
    else if (d === streakDir) { streak++; }
    else break;
  }

  // 4-week trend
  const lookback = Math.min(4, weeks.length - 1);
  const past = weeks[weeks.length - 1 - lookback];
  const trend4wk = past ? latest - past.specNet : null;

  // OI trend over the same lookback
  const oiNow = weeks[weeks.length - 1].totalOI;
  const oiPast = past ? past.totalOI : null;
  const oiTrend = oiPast !== null ? oiNow - oiPast : null;

  // price change over full window, if available
  let priceChangePct = null;
  if (asset.hasPriceData) {
    const firstPrice = weeks.find(w => w.price !== null)?.price;
    const lastPrice = weeks[weeks.length - 1].price;
    if (firstPrice && lastPrice) priceChangePct = (lastPrice - firstPrice) / firstPrice;
  }

  // count divergence weeks in the window
  const divergenceCount = weeks.filter(w => w.divergence === "DIVERGENCE").length;

  return { min, max, latest, pct, streak, streakDir, trend4wk, lookback, oiTrend, oiNow, priceChangePct, divergenceCount, weeksTracked: weeks.length };
}

function extremityLabel(pct) {
  if (pct >= 0.85) return { text: "near the HIGH end", tone: "pos" };
  if (pct <= 0.15) return { text: "near the LOW end", tone: "neg" };
  if (pct >= 0.6) return { text: "leaning toward the high end", tone: "pos" };
  if (pct <= 0.4) return { text: "leaning toward the low end", tone: "neg" };
  return { text: "roughly mid-range", tone: "" };
}


function renderIndex(data) {
  const root = document.getElementById("categories");
  if (!data || !data.assets || !data.assets.length) {
    document.getElementById("empty").style.display = "block";
    return;
  }
  const order = ["Metals", "Equity Indices", "FX Majors", "Other"];
  const byCat = {};
  for (const a of data.assets) {
    (byCat[a.category] = byCat[a.category] || []).push(a);
  }
  root.innerHTML = "";
  for (const cat of order) {
    const items = byCat[cat];
    if (!items || !items.length) continue;
    const section = document.createElement("div");
    section.className = "category";
    section.innerHTML = `
      <div class="category-head">
        <h2>${cat}</h2>
        <div class="rule"></div>
        <div class="count">${items.length}</div>
      </div>
      <div class="grid"></div>
    `;
    const grid = section.querySelector(".grid");
    for (const a of items) {
      grid.appendChild(assetCard(a));
    }
    root.appendChild(section);
  }
}

function assetCard(asset) {
  const weeks = asset.weeks;
  const latest = weeks[weeks.length - 1];
  const specSeries = weeks.map(w => w.specNet);
  const dir = latest.specDir || "FLAT";
  const badgeClass = dir === "UP" ? "up" : dir === "DOWN" ? "down" : "flat";
  const badgeSign = latest.specNetChg > 0 ? "+" : "";
  const sparkColor = dir === "DOWN" ? "--red" : dir === "UP" ? "--green" : "--amber";
  const ins = computeInsights(asset);
  const ext = extremityLabel(ins.pct);

  const el = document.createElement("a");
  el.className = "card";
  el.href = `asset.html?symbol=${encodeURIComponent(asset.symbol)}`;
  el.innerHTML = `
    ${latest.divergence === "DIVERGENCE" ? `<div class="card-divflag">divergence</div>` : ""}
    <div class="card-top">
      <div>
        <div class="card-symbol">${asset.displaySymbol}</div>
        <div class="card-name">${asset.name}</div>
      </div>
      <div class="badge ${badgeClass}">${latest.specNetChg == null ? "—" : badgeSign + fmtInt(latest.specNetChg)}</div>
    </div>
    <div class="card-spark">${sparklineSVG(specSeries, 240, 40, sparkColor)}</div>
    <div class="card-stats">
      <div>${asset.specLabel} net<br><span class="val ${dirClass(latest.specNet)}">${fmtSigned(latest.specNet)}</span></div>
      <div style="text-align:right">Total OI<br><span class="val">${fmtInt(latest.totalOI)}</span></div>
    </div>
    <div class="card-range">
      <div class="card-range-label"><span>${ins.weeksTracked}-wk range</span><span class="${ext.tone}">${ext.text}</span></div>
      ${rangeGaugeSVG(ins.min, ins.max, ins.latest, 240, 20)}
    </div>
  `;
  return el;
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function renderDetail() {
  const data = await loadData();
  const symbol = getParam("symbol");
  const asset = data.assets.find(a => a.symbol === symbol);
  const root = document.getElementById("detail-root");
  if (!asset) {
    root.innerHTML = `<div class="empty-note">Pair "${symbol || ""}" not found. <a href="index.html" style="color:var(--amber)">Back to all pairs</a></div>`;
    return;
  }
  document.title = `${asset.displaySymbol} — COT Desk`;
  const weeks = asset.weeks;
  const latest = weeks[weeks.length - 1];

  document.getElementById("detail-root").innerHTML = detailTemplate(asset, latest);

  drawChart(asset, weeks);
  drawChangeChart(weeks);
  drawOIChart(weeks);
  drawPctChart(weeks);
  renderTable(asset, weeks);
}

function detailTemplate(asset, latest) {
  const netClass = dirClass(latest.specNet);
  const chgClass = dirClass(latest.specNetChg);
  const hedgeClass = dirClass(latest.hedgeNet);
  const divBadge = latest.divergence === "DIVERGENCE"
    ? `<span class="tag divergence">DIVERGENCE</span>`
    : latest.divergence === "CONFIRMED"
      ? `<span class="tag confirmed">CONFIRMED</span>`
      : `<span class="tag na">n/a</span>`;

  const ins = computeInsights(asset);
  const ext = extremityLabel(ins.pct);
  const narrative = buildNarrative(asset, latest, ins, ext);

  return `
    <a class="back-link" href="index.html">&larr; all pairs</a>
    <div class="detail-head">
      <div class="detail-title">
        <div class="detail-title-sym">${asset.symbol} · CFTC ${asset.format === "legacy" ? "Legacy" : "Financial Futures"} report</div>
        <h1>${asset.name}</h1>
        <div class="cat">${asset.category} &middot; latest report ${latest.date} &middot; ${ins.weeksTracked} weeks tracked</div>
      </div>
      <div class="readouts">
        <div class="readout">
          <div class="readout-label">${asset.specLabel} Net</div>
          <div class="readout-value ${netClass}">${fmtSigned(latest.specNet)}</div>
          <div class="readout-sub ${chgClass}">${latest.specNetChg == null ? "first week" : fmtSigned(latest.specNetChg) + " wk"}</div>
        </div>
        <div class="readout">
          <div class="readout-label">${asset.hedgeLabel} Net</div>
          <div class="readout-value ${hedgeClass}">${fmtSigned(latest.hedgeNet)}</div>
          <div class="readout-sub">${fmtPct(latest.specNetPctOI)} of OI (spec)</div>
        </div>
        <div class="readout">
          <div class="readout-label">Total OI</div>
          <div class="readout-value">${fmtCompact2(latest.totalOI)}</div>
          <div class="readout-sub ${dirClass(latest.oiChg)}">${latest.oiChg == null ? "—" : fmtSigned(latest.oiChg) + " wk"}</div>
        </div>
        ${asset.hasPriceData ? `
        <div class="readout">
          <div class="readout-label">Price</div>
          <div class="readout-value">${fmtPrice(latest.price)}</div>
          <div class="readout-sub ${dirClass(latest.priceChg)}">${latest.priceChg == null ? "—" : fmtSigned2(latest.priceChg) + " wk"}</div>
        </div>` : ""}
        <div class="readout">
          <div class="readout-label">Signal</div>
          <div class="readout-value" style="font-size:16px; padding-top:6px">${divBadge}</div>
          <div class="readout-sub">${asset.hasPriceData ? "price vs. positioning" : "positioning only"}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Positioning over time</h3>
        <div class="legend">
          <span><span class="sw" style="background:var(--amber)"></span>${asset.specLabel} net</span>
          <span><span class="sw" style="background:#5c6773"></span>${asset.hedgeLabel} net</span>
          ${asset.hasPriceData ? `<span><span class="sw" style="background:var(--green)"></span>price</span>` : ""}
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chart"></canvas></div>
    </div>

    <div class="grid2">
      <div class="panel">
        <div class="panel-head"><h3>Where positioning sits vs. its range</h3></div>
        <div class="gauge-big">
          ${rangeGaugeSVG(ins.min, ins.max, ins.latest, 100, 40)}
        </div>
        <div class="gauge-labels">
          <span>${fmtCompact2(ins.min)} <span class="mono-faint">low (${ins.weeksTracked}wk)</span></span>
          <span>${fmtCompact2(ins.max)} <span class="mono-faint">high (${ins.weeksTracked}wk)</span></span>
        </div>
        <div class="stat-line ${ext.tone}">Currently ${ext.text} of its ${ins.weeksTracked}-week range (${(ins.pct * 100).toFixed(0)}th percentile).</div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Weekly momentum</h3></div>
        <div class="chart-wrap small"><canvas id="chart-chg"></canvas></div>
        <div class="stat-line">${ins.streak >= 2 ? `${ins.streak} straight weeks moving ${ins.streakDir === "UP" ? "higher" : "lower"}.` : "No sustained streak — positioning has been choppy."}</div>
      </div>
    </div>

    <div class="grid2">
      <div class="panel">
        <div class="panel-head"><h3>Open interest trend</h3></div>
        <div class="chart-wrap small"><canvas id="chart-oi"></canvas></div>
        <div class="stat-line">${ins.oiTrend == null ? "—" : (ins.oiTrend > 0 ? `OI has grown ${fmtInt(ins.oiTrend)} contracts` : `OI has shrunk ${fmtInt(Math.abs(ins.oiTrend))} contracts`) + ` over the last ${ins.lookback} weeks — ${ins.oiTrend > 0 ? "new money entering the market" : "positions unwinding / expiring"}.`}</div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>Positioning as % of open interest</h3></div>
        <div class="chart-wrap small"><canvas id="chart-pct"></canvas></div>
        <div class="stat-line">Speculative net is currently <b>${fmtPct(latest.specNetPctOI)}</b> of total open interest.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>What's going on with ${asset.name}</h3></div>
      <div class="explainer">${narrative}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Weekly data</h3></div>
      <div class="table-scroll"><table class="data" id="data-table"></table></div>
    </div>
  `;
}

function buildNarrative(asset, latest, ins, ext) {
  const specDirWord = latest.specNet >= 0 ? "net long" : "net short";
  const p1 = `<p><b>${asset.specLabel}</b> — the trend-following / speculative crowd — is currently <b>${specDirWord}</b> by <b>${fmtInt(Math.abs(latest.specNet))}</b> contracts, which sits ${ext.text.toLowerCase()} of its range over the past ${ins.weeksTracked} weeks (${(ins.pct * 100).toFixed(0)}th percentile). ${ins.pct >= 0.85 ? "That's a crowded long — a lot of speculative money is already positioned in this direction, which raises the risk of a sharp unwind if sentiment turns." : ins.pct <= 0.15 ? "That's a crowded short — a lot of speculative money is already positioned against this market, which raises the risk of a short squeeze if sentiment turns." : "That's a fairly balanced positioning level, not stretched to an extreme in either direction."}</p>`;

  const trendWord = ins.trend4wk == null ? null : (ins.trend4wk > 0 ? "increased" : ins.trend4wk < 0 ? "decreased" : "held steady");
  const p2 = trendWord
    ? `<p>Over the last ${ins.lookback} weeks, ${asset.specLabel.toLowerCase()} net positioning has <b>${trendWord}</b> by ${fmtInt(Math.abs(ins.trend4wk))} contracts${ins.streak >= 2 ? `, part of a ${ins.streak}-week run of ${ins.streakDir === "UP" ? "additions" : "reductions"}` : ""}.</p>`
    : "";

  const divWord = latest.divergence === "DIVERGENCE"
    ? `<p><b>This week flagged a divergence</b> — price moved ${latest.priceDir === "UP" ? "up" : "down"} while ${asset.specLabel.toLowerCase()} net positioning moved the opposite way. That mismatch is worth watching: either the move is running out of speculative fuel, or positioning is about to catch up to price.</p>`
    : latest.divergence === "CONFIRMED"
      ? `<p>This week's price move was <b>confirmed</b> by positioning — price and ${asset.specLabel.toLowerCase()} net direction agreed, suggesting the move has genuine conviction behind it rather than being overextended.</p>`
      : "";

  const divCountWord = ins.divergenceCount > 0
    ? `<p>Across the last ${ins.weeksTracked} weeks, price and positioning have diverged <b>${ins.divergenceCount}</b> time${ins.divergenceCount === 1 ? "" : "s"} — ${ins.divergenceCount >= 4 ? "a choppier-than-usual stretch where positioning has repeatedly lagged or fought price." : "a relatively normal amount of back-and-forth."}</p>`
    : "";

  const priceWord = asset.hasPriceData && ins.priceChangePct != null
    ? `<p>Price is ${ins.priceChangePct >= 0 ? "up" : "down"} <b>${Math.abs(ins.priceChangePct * 100).toFixed(1)}%</b> over the tracked window.</p>`
    : "";

  const oiWord = ins.oiTrend != null
    ? `<p><b>Open interest</b> has ${ins.oiTrend > 0 ? "grown" : "shrunk"} by ${fmtInt(Math.abs(ins.oiTrend))} contracts over the last ${ins.lookback} weeks — ${ins.oiTrend > 0 ? "fresh capital is entering this market alongside the current move" : "positions are being unwound, which can mean conviction is fading"}.</p>`
    : "";

  return p1 + p2 + divWord + divCountWord + priceWord + oiWord +
    `<p class="mono-faint" style="margin-top:14px">COT reflects Tuesday's positions, released the following Friday — use this as a weekly bias filter, not a trade trigger.</p>`;
}

function drawChart(asset, weeks) {
  const ctx = document.getElementById("chart").getContext("2d");
  const labels = weeks.map(w => w.date.slice(5));
  const specSeries = weeks.map(w => w.specNet);
  const hedgeSeries = weeks.map(w => w.hedgeNet);
  const priceSeries = asset.hasPriceData ? weeks.map(w => w.price) : null;

  const datasets = [
    {
      label: `${asset.specLabel} Net`,
      data: specSeries,
      borderColor: "#d9a441",
      backgroundColor: "rgba(217,164,65,0.08)",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
      fill: true,
      yAxisID: "y",
    },
    {
      label: `${asset.hedgeLabel} Net`,
      data: hedgeSeries,
      borderColor: "#5c6773",
      borderWidth: 1.5,
      borderDash: [3, 3],
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
      fill: false,
      yAxisID: "y",
    },
  ];
  if (priceSeries) {
    datasets.push({
      label: "Price",
      data: priceSeries,
      borderColor: "#33c481",
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.15,
      fill: false,
      yAxisID: "y1",
    });
  }

  const scales = {
    x: {
      grid: { color: "#1a1d24" },
      ticks: { color: "#5c626d", font: { family: "IBM Plex Mono", size: 10 }, maxRotation: 0 },
    },
    y: {
      position: "left",
      grid: { color: "#1a1d24" },
      ticks: { color: "#5c626d", font: { family: "IBM Plex Mono", size: 10 }, callback: v => fmtCompact(v) },
      title: { display: true, text: "Net contracts", color: "#5c626d", font: { size: 10, family: "IBM Plex Mono" } },
    },
  };
  if (priceSeries) {
    scales.y1 = {
      position: "right",
      grid: { drawOnChartArea: false },
      ticks: { color: "#33c481", font: { family: "IBM Plex Mono", size: 10 } },
    };
  }

  new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#12151b",
          borderColor: "#23272f",
          borderWidth: 1,
          titleColor: "#e7e9ec",
          bodyColor: "#9096a1",
          titleFont: { family: "IBM Plex Mono", size: 11 },
          bodyFont: { family: "IBM Plex Mono", size: 11 },
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? "—" : ctx.parsed.y.toLocaleString("en-US")}`,
          },
        },
      },
      scales,
    },
  });
}

function fmtCompact(v) {
  const abs = Math.abs(v);
  if (abs >= 1000) return (v / 1000).toFixed(0) + "k";
  return v;
}

const baseGridColor = "#1a1d24";
const baseTickColor = "#5c626d";
const baseTickFont = { family: "IBM Plex Mono", size: 10 };
const baseTooltip = {
  backgroundColor: "#12151b",
  borderColor: "#23272f",
  borderWidth: 1,
  titleColor: "#e7e9ec",
  bodyColor: "#9096a1",
  titleFont: { family: "IBM Plex Mono", size: 11 },
  bodyFont: { family: "IBM Plex Mono", size: 11 },
};

function drawChangeChart(weeks) {
  const canvas = document.getElementById("chart-chg");
  if (!canvas) return;
  const labels = weeks.map(w => w.date.slice(5));
  const values = weeks.map(w => w.specNetChg);
  const colors = values.map(v => (v == null ? "#3a3f48" : v >= 0 ? "#33c481" : "#e5484d"));
  new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 2, barPercentage: 0.7 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...baseTooltip, callbacks: { label: c => `net chg: ${c.parsed.y == null ? "—" : fmtSigned(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: baseGridColor }, ticks: { color: baseTickColor, font: baseTickFont, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: baseGridColor }, ticks: { color: baseTickColor, font: baseTickFont, callback: v => fmtCompact(v) } },
      },
    },
  });
}

function drawOIChart(weeks) {
  const canvas = document.getElementById("chart-oi");
  if (!canvas) return;
  const labels = weeks.map(w => w.date.slice(5));
  const values = weeks.map(w => w.totalOI);
  new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#9096a1",
        backgroundColor: "rgba(144,150,161,0.10)",
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.15,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...baseTooltip, callbacks: { label: c => `OI: ${fmtInt(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: baseGridColor }, ticks: { color: baseTickColor, font: baseTickFont, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: baseGridColor }, ticks: { color: baseTickColor, font: baseTickFont, callback: v => fmtCompact(v) } },
      },
    },
  });
}

function drawPctChart(weeks) {
  const canvas = document.getElementById("chart-pct");
  if (!canvas) return;
  const labels = weeks.map(w => w.date.slice(5));
  const values = weeks.map(w => (w.specNetPctOI == null ? null : w.specNetPctOI * 100));
  new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#d9a441",
        backgroundColor: "rgba(217,164,65,0.10)",
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 3,
        tension: 0.15,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...baseTooltip, callbacks: { label: c => `${c.parsed.y == null ? "—" : c.parsed.y.toFixed(1)}% of OI` } },
      },
      scales: {
        x: { grid: { color: baseGridColor }, ticks: { color: baseTickColor, font: baseTickFont, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
        y: { grid: { color: baseGridColor }, ticks: { color: baseTickColor, font: baseTickFont, callback: v => v.toFixed(0) + "%" } },
      },
    },
  });
}

function renderTable(asset, weeks) {
  const table = document.getElementById("data-table");
  const rows = weeks.slice().reverse();
  const priceCol = asset.hasPriceData ? `<th>Price</th>` : "";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Total OI</th>
        <th>${asset.specLabel} Long</th>
        <th>${asset.specLabel} Short</th>
        <th>${asset.specLabel} Net</th>
        <th>Net Chg</th>
        <th>${asset.hedgeLabel} Net</th>
        ${priceCol}
        <th>Signal</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(w => `
        <tr>
          <td>${w.date}</td>
          <td>${fmtInt(w.totalOI)}</td>
          <td>${fmtInt(w.specLong)}</td>
          <td>${fmtInt(w.specShort)}</td>
          <td class="${dirClass(w.specNet)}">${fmtSigned(w.specNet)}</td>
          <td class="${dirClass(w.specNetChg)}">${w.specNetChg == null ? "—" : fmtSigned(w.specNetChg)}</td>
          <td class="${dirClass(w.hedgeNet)}">${fmtSigned(w.hedgeNet)}</td>
          ${asset.hasPriceData ? `<td>${w.price == null ? "—" : w.price.toLocaleString("en-US")}</td>` : ""}
          <td>${w.divergence === "DIVERGENCE" ? '<span class="tag divergence">DIVERGENCE</span>' : w.divergence === "CONFIRMED" ? '<span class="tag confirmed">confirmed</span>' : '<span class="tag na">—</span>'}</td>
        </tr>
      `).join("")}
    </tbody>
  `;
}
