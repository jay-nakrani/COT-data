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

// ---------------------------------------------------------------------------
// Index page
// ---------------------------------------------------------------------------

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

  return `
    <a class="back-link" href="index.html">&larr; all pairs</a>
    <div class="detail-head">
      <div class="detail-title">
        <div class="detail-title-sym">${asset.symbol} · CFTC ${asset.format === "legacy" ? "Legacy" : "Financial Futures"} report</div>
        <h1>${asset.name}</h1>
        <div class="cat">${asset.category} &middot; latest report ${latest.date}</div>
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
          <div class="readout-label">Signal</div>
          <div class="readout-value" style="font-size:16px; padding-top:6px">${divBadge}</div>
          <div class="readout-sub">${asset.hasPriceData ? "price vs. positioning" : "positioning only — add price"}</div>
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

    <div class="panel">
      <div class="panel-head"><h3>What this means</h3></div>
      <div class="explainer">
        <p><b>${asset.specLabel}</b> is the trend-following / speculative crowd. When their net long grows while price rises, the move has real conviction. When price rises but this line is falling, that is a <b>divergence</b> — a higher-probability zone for reversal or a sharper continuation once it resolves.</p>
        <p><b>${asset.hedgeLabel}</b> is the other side of that trade — commercial hedgers or dealer/intermediary flow. Sharp swings here often mirror large client positioning on the other side of the market.</p>
        <p>COT reflects Tuesday's positions, released the following Friday. Treat this as a weekly bias filter, not a trade trigger.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Weekly data</h3></div>
      <div class="table-scroll"><table class="data" id="data-table"></table></div>
    </div>
  `;
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
