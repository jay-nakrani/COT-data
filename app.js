/**
 * COT QUANT TERMINAL - MAIN APPLICATION LOGIC
 * Dashboard tracking COT data, financial news, and market sentiment.
 */

// Global State
const state = {
  cot: null,
  news: null,
  calendar: null,
  activeTab: 'overview',
  activeCategory: 'all',
  newsFilterAsset: 'all',
  newsFilterSentiment: 'all',
  calFilterImpact: 'all',
  calFilterCountry: 'all',
  searchQuery: '',
  charts: {}, // Registry to keep Chart.js instances for teardown/re-render
};

// ==========================================================================
// 1. DATA FORMATTERS & UTILITIES
// ==========================================================================

function fmtInt(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  return Math.round(n).toLocaleString('en-US');
}

function fmtSigned(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  const val = Math.round(n);
  return (val > 0 ? '+' : '') + val.toLocaleString('en-US');
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  const val = Number(n);
  return (val > 0 ? '+' : '') + val.toFixed(2) + '%';
}

function fmtCompact2(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K';
  return sign + abs.toFixed(0);
}

function fmtPrice(n) {
  if (n === null || n === undefined || isNaN(n) || n === '') return '-';
  const val = Number(n);
  if (val < 10) return val.toFixed(4);
  if (val < 100) return val.toFixed(3);
  return val.toFixed(2);
}

function fmtSigned2(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  const val = Number(n);
  return (val > 0 ? '+' : '') + val.toFixed(2);
}

function dirClass(n) {
  if (n === null || n === undefined || isNaN(n) || n === 0) return 'zero';
  return n > 0 ? 'pos' : 'neg';
}

// Country flag emoji mapping
const COUNTRY_FLAGS = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  JPY: '🇯🇵',
  AUD: '🇦🇺',
  CAD: '🇨🇦',
  CHF: '🇨🇭',
  NZD: '🇳🇿',
  CNY: '🇨🇳',
  DE: '🇩🇪',
  FR: '🇫🇷',
  IT: '🇮🇹',
  ALL: '🌐'
};

function getCountryFlag(countryCode) {
  if (!countryCode) return '🌐';
  const code = countryCode.toUpperCase();
  return COUNTRY_FLAGS[code] || '🌐';
}

// Format relative date / time string
function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Format Calendar Event Time
function formatCalTime(dateStr) {
  if (!dateStr) return '--:--';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
}

// Safely destroy Chart instance
function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

// ==========================================================================
// 2. ANALYTICS & INSIGHTS (Preserved & Enhanced)
// ==========================================================================

function computeInsights(asset) {
  if (!asset || !asset.weeks || asset.weeks.length === 0) {
    return { minNet: 0, maxNet: 0, rangePct: 50, streak: 0, streakDir: 'none', netChg4w: 0, priceChg4w: 0, divergence: false };
  }

  const latest = asset.weeks[0];
  const weeks52 = asset.weeks.slice(0, 52);

  let minNet = Infinity;
  let maxNet = -Infinity;

  weeks52.forEach(w => {
    if (w.specNet < minNet) minNet = w.specNet;
    if (w.specNet > maxNet) maxNet = w.specNet;
  });

  const rangeSpan = maxNet - minNet;
  const rangePct = rangeSpan === 0 ? 50 : Math.min(100, Math.max(0, ((latest.specNet - minNet) / rangeSpan) * 100));

  // Calculate streak of specNetChg
  let streak = 0;
  let streakDir = 'none';

  if (asset.weeks.length > 0) {
    const firstChg = asset.weeks[0].specNetChg;
    streakDir = firstChg >= 0 ? 'pos' : 'neg';

    for (let i = 0; i < asset.weeks.length; i++) {
      const chg = asset.weeks[i].specNetChg;
      if ((streakDir === 'pos' && chg >= 0) || (streakDir === 'neg' && chg < 0)) {
        streak++;
      } else {
        break;
      }
    }
  }

  // 4-week net change & price change
  const w4 = asset.weeks[Math.min(4, asset.weeks.length - 1)];
  const netChg4w = latest.specNet - w4.specNet;
  const priceChg4w = (latest.price && w4.price) ? (latest.price - w4.price) : 0;

  // Divergence check
  const divergence = latest.divergence || (netChg4w * priceChg4w < 0 && Math.abs(netChg4w) > 5000);

  return {
    minNet,
    maxNet,
    rangePct,
    streak,
    streakDir,
    netChg4w,
    priceChg4w,
    divergence
  };
}

function extremityLabel(pct) {
  if (pct >= 90) return 'Extreme Bullish (>90%)';
  if (pct >= 70) return 'Bullish (70-90%)';
  if (pct >= 30) return 'Neutral (30-70%)';
  if (pct >= 10) return 'Bearish (10-30%)';
  return 'Extreme Bearish (<10%)';
}

function buildNarrative(asset, latest, ins, ext) {
  if (!asset || !latest) return 'No data available for this asset.';

  const sLabel = asset.specLabel || 'Speculators';
  const hLabel = asset.hedgeLabel || 'Commercial Hedgers';

  let narrative = `As of <strong>${latest.date}</strong>, ${sLabel} net positioning in <strong>${asset.name} (${asset.displaySymbol})</strong> stands at <strong>${fmtSigned(latest.specNet)}</strong> contracts (${fmtPct(latest.specNetPctOI)} of total Open Interest). `;

  narrative += `This places current speculative positioning in the <strong>${ext}</strong> zone, at the <strong>${ins.rangePct.toFixed(1)}th percentile</strong> of its 52-week range. `;

  if (ins.streak > 1) {
    narrative += `Positioning has shifted by <strong>${fmtSigned(latest.specNetChg)}</strong> contracts this week, extending a <strong>${ins.streak}-week ${ins.streakDir === 'pos' ? 'accumulation' : 'liquidation'} streak</strong>. `;
  } else {
    narrative += `Speculators adjusted positions by <strong>${fmtSigned(latest.specNetChg)}</strong> contracts this week. `;
  }

  narrative += `${hLabel} hold a net position of <strong>${fmtSigned(latest.hedgeNet)}</strong> contracts (${fmtSigned(latest.hedgeNetChg)} change). Total market Open Interest stands at <strong>${fmtInt(latest.totalOI)}</strong> contracts. `;

  if (ins.divergence) {
    narrative += `<br><br><span class="badge badge-divergence">⚠️ DIVERGENCE ALERT</span> <em>Speculative positioning trend and underlying price action are exhibiting divergence over recent weeks, suggesting potential market turning points or positioning squeezes.</em>`;
  }

  return narrative;
}

// Horizontal range gauge renderer
function rangeGaugeSVG(pct) {
  const clampedPct = Math.min(100, Math.max(0, pct || 0));
  return `
    <div class="gauge-bar-wrapper">
      <div class="gauge-header">
        <span>52W Low</span>
        <span class="num">${clampedPct.toFixed(0)}%</span>
        <span>52W High</span>
      </div>
      <div class="gauge-track">
        <div class="gauge-fill" style="width: 100%;"></div>
        <div class="gauge-pin" style="left: ${clampedPct}%;"></div>
      </div>
    </div>
  `;
}

// ==========================================================================
// 3. CHART.JS RENDERERS
// ==========================================================================

// Sparkline chart for overview asset cards
function drawSparklineChart(canvasId, weeks) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const slice = weeks.slice(0, 16).reverse(); // last 16 weeks
  const labels = slice.map(w => w.date);
  const data = slice.map(w => w.specNet);

  const isPos = (data[data.length - 1] - data[0]) >= 0;
  const strokeColor = isPos ? '#22c55e' : '#ef4444';
  const fillColor = isPos ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)';

  const ctx = canvas.getContext('2d');
  state.charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        borderColor: strokeColor,
        borderWidth: 2,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (context) => `Spec Net: ${fmtSigned(context.raw)}`
          }
        }
      },
      scales: {
        x: { display: false },
        y: { display: false }
      }
    }
  });
}

// Sentiment Semicircular Gauge Chart
function drawGaugeChart(canvasId, longPct, shortPct) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  state.charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Long %', 'Short %'],
      datasets: [{
        data: [longPct, shortPct],
        backgroundColor: ['#22c55e', '#ef4444'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      rotation: -90,
      circumference: 180,
      cutout: '75%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.raw.toFixed(1)}%`
          }
        }
      }
    }
  });
}

// Detail Page Chart 1: Main Positioning vs Price
function drawChart(asset) {
  const canvasId = 'chart-main-canvas';
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const weeks = asset.weeks.slice(0, 52).reverse();
  const labels = weeks.map(w => w.date);
  const specNet = weeks.map(w => w.specNet);
  const hedgeNet = weeks.map(w => w.hedgeNet);
  const prices = weeks.map(w => w.price || null);

  const datasets = [
    {
      label: asset.specLabel || 'Speculators Net',
      data: specNet,
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderWidth: 2,
      yAxisID: 'yNet',
      tension: 0.2
    },
    {
      label: asset.hedgeLabel || 'Hedgers Net',
      data: hedgeNet,
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderWidth: 2,
      yAxisID: 'yNet',
      tension: 0.2
    }
  ];

  if (asset.hasPriceData) {
    datasets.push({
      label: 'Price',
      data: prices,
      borderColor: '#3b82f6',
      borderWidth: 2,
      borderDash: [4, 4],
      yAxisID: 'yPrice',
      tension: 0.1,
      pointRadius: 0
    });
  }

  const ctx = canvas.getContext('2d');
  state.charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#f1f5f9', font: { family: 'JetBrains Mono', size: 12 } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        yNet: {
          type: 'linear',
          position: 'left',
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        yPrice: {
          type: 'linear',
          position: 'right',
          display: asset.hasPriceData,
          ticks: { color: '#60a5fa', font: { family: 'JetBrains Mono', size: 10 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// Detail Page Chart 2: Weekly Position Changes
function drawChangeChart(asset) {
  const canvasId = 'chart-changes-canvas';
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const weeks = asset.weeks.slice(0, 26).reverse();
  const labels = weeks.map(w => w.date);
  const specChg = weeks.map(w => w.specNetChg);

  const bgColors = specChg.map(c => c >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)');

  const ctx = canvas.getContext('2d');
  state.charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Weekly Spec Net Change',
        data: specChg,
        backgroundColor: bgColors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#f1f5f9', font: { family: 'JetBrains Mono', size: 11 } } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// Detail Page Chart 3: Total Open Interest
function drawOIChart(asset) {
  const canvasId = 'chart-oi-canvas';
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const weeks = asset.weeks.slice(0, 52).reverse();
  const labels = weeks.map(w => w.date);
  const oi = weeks.map(w => w.totalOI);

  const ctx = canvas.getContext('2d');
  state.charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Open Interest',
        data: oi,
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        fill: true,
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#f1f5f9', font: { family: 'JetBrains Mono', size: 11 } } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

// Detail Page Chart 4: Spec Net % OI
function drawPctChart(asset) {
  const canvasId = 'chart-pct-canvas';
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const weeks = asset.weeks.slice(0, 52).reverse();
  const labels = weeks.map(w => w.date);
  const pct = weeks.map(w => w.specNetPctOI);

  const ctx = canvas.getContext('2d');
  state.charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Spec Net % of OI',
        data: pct,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        fill: true,
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#f1f5f9', font: { family: 'JetBrains Mono', size: 11 } } }
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          ticks: {
            color: '#94a3b8',
            font: { family: 'JetBrains Mono', size: 10 },
            callback: (v) => v + '%'
          },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

// ==========================================================================
// 4. OVERVIEW TAB & ASSET CARDS
// ==========================================================================

function assetCard(asset) {
  if (!asset || !asset.weeks || asset.weeks.length === 0) return '';

  const latest = asset.weeks[0];
  const ins = computeInsights(asset);
  const ext = extremityLabel(ins.rangePct);
  const sparkId = `spark-${asset.symbol.toLowerCase()}`;

  const priceFormatted = latest.price ? fmtPrice(latest.price) : '--';
  const priceChgClass = dirClass(latest.priceChg);
  const priceChgFormatted = latest.priceChg ? fmtSigned2(latest.priceChg) : '';

  const specChgClass = dirClass(latest.specNetChg);

  return `
    <a href="asset.html?symbol=${asset.symbol}" class="asset-card">
      <div class="card-top">
        <div class="asset-identity">
          <div class="symbol-badge">
            <span>${asset.displaySymbol}</span>
            <span class="asset-display-symbol">(${asset.symbol})</span>
          </div>
          <div class="asset-name">${asset.name}</div>
        </div>
        <div class="category-tag">${asset.category}</div>
      </div>

      <div class="price-row">
        <div>
          <span class="price-val num">$${priceFormatted}</span>
        </div>
        ${priceChgFormatted ? `<span class="price-chg num ${priceChgClass}">${priceChgFormatted}</span>` : ''}
      </div>

      <div class="card-metrics">
        <div class="metric-item">
          <span class="metric-title">${asset.specLabel || 'Speculators Net'}</span>
          <span class="metric-val num ${dirClass(latest.specNet)}">${fmtSigned(latest.specNet)}</span>
          <span class="metric-sub num ${specChgClass}">${fmtSigned(latest.specNetChg)} 1W</span>
        </div>
        <div class="metric-item">
          <span class="metric-title">% Open Interest</span>
          <span class="metric-val num ${dirClass(latest.specNetPctOI)}">${fmtPct(latest.specNetPctOI)}</span>
          <span class="metric-sub">${ins.streak}W ${ins.streakDir === 'pos' ? '⬆' : '⬇'} streak</span>
        </div>
      </div>

      <div class="sparkline-container">
        <canvas id="${sparkId}"></canvas>
      </div>

      ${rangeGaugeSVG(ins.rangePct)}

      <div class="card-footer">
        <span>${ext.split(' ')[0]}</span>
        ${ins.divergence ? `<span class="badge badge-divergence">⚠️ DIVERGENCE</span>` : ''}
        <span class="card-action">Deep Dive →</span>
      </div>
    </a>
  `;
}

function renderIndex(data) {
  const container = document.getElementById('asset-grid');
  if (!container) return;

  if (!data || !data.assets || data.assets.length === 0) {
    container.innerHTML = '<div class="narrative-box">No asset data available.</div>';
    return;
  }

  // Filter assets by category & search
  let filtered = data.assets.filter(a => {
    const matchesCat = state.activeCategory === 'all' || a.category.toLowerCase().replace(/\s+/g, '') === state.activeCategory;
    const q = state.searchQuery.toLowerCase();
    const matchesSearch = !q || a.symbol.toLowerCase().includes(q) || a.displaySymbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="narrative-box" style="grid-column: 1/-1;">No assets match your current filter query.</div>';
    return;
  }

  container.innerHTML = filtered.map(a => assetCard(a)).join('');

  // Draw sparkline charts post-DOM insert
  filtered.forEach(a => {
    const sparkId = `spark-${a.symbol.toLowerCase()}`;
    drawSparklineChart(sparkId, a.weeks);
  });

  // Update KPI Bar
  updateOverviewKPIs(data.assets);
}

function updateOverviewKPIs(assets) {
  let totalBullish = 0;
  let totalBearish = 0;
  let divergenceCount = 0;

  assets.forEach(a => {
    const ins = computeInsights(a);
    if (ins.rangePct >= 50) totalBullish++;
    else totalBearish++;
    if (ins.divergence) divergenceCount++;
  });

  const kpiAssets = document.getElementById('kpi-total-assets');
  if (kpiAssets) kpiAssets.textContent = assets.length;

  const kpiBullish = document.getElementById('kpi-bullish-ratio');
  if (kpiBullish) kpiBullish.textContent = `${totalBullish} / ${assets.length}`;

  const kpiDiv = document.getElementById('kpi-divergences');
  if (kpiDiv) kpiDiv.textContent = divergenceCount;
}

// ==========================================================================
// 5. NEWS TAB RENDERER
// ==========================================================================

function renderNews() {
  const container = document.getElementById('news-feed');
  if (!container) return;

  if (!state.news || !state.news.news || state.news.news.length === 0) {
    container.innerHTML = '<div class="narrative-box">No financial news items loaded.</div>';
    return;
  }

  let items = state.news.news;

  // Filter by asset
  if (state.newsFilterAsset !== 'all') {
    items = items.filter(item => {
      if (!item.analysis || !item.analysis.assets) return false;
      return item.analysis.assets.some(a => a.symbol.toUpperCase() === state.newsFilterAsset.toUpperCase());
    });
  }

  // Filter by sentiment
  if (state.newsFilterSentiment !== 'all') {
    items = items.filter(item => {
      const overall = (item.analysis && item.analysis.overall) || 'neutral';
      return overall.toLowerCase() === state.newsFilterSentiment.toLowerCase();
    });
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    items = items.filter(item => item.title.toLowerCase().includes(q) || (item.description && item.description.toLowerCase().includes(q)));
  }

  // Update News count badge
  const countBadge = document.getElementById('news-count');
  if (countBadge) countBadge.textContent = items.length;

  if (items.length === 0) {
    container.innerHTML = '<div class="narrative-box">No news stories match your selected filter criteria.</div>';
    return;
  }

  container.innerHTML = items.map(item => {
    const overall = (item.analysis && item.analysis.overall) || 'neutral';
    const overallClass = `badge-${overall}`;

    // Generate AI asset analysis badges
    let assetBadges = '';
    if (item.analysis && item.analysis.assets && item.analysis.assets.length > 0) {
      assetBadges = item.analysis.assets.map(a => {
        const dir = (a.direction || 'neutral').toLowerCase();
        const conf = a.confidence ? `${a.confidence}%` : '';
        const badgeClass = dir === 'bullish' ? 'badge-bullish' : (dir === 'bearish' ? 'badge-bearish' : 'badge-neutral');
        return `<span class="badge ${badgeClass}">${a.symbol}: ${dir.toUpperCase()} ${conf}</span>`;
      }).join(' ');
    }

    const categories = (item.categories || []).map(c => `<span class="category-tag">${c}</span>`).join(' ');

    return `
      <div class="news-card">
        <div class="news-header">
          <div class="news-meta">
            <span class="news-source">FinancialJuice</span>
            <span>•</span>
            <span class="news-time">${formatTimeAgo(item.pubDate)}</span>
          </div>
          <div class="news-categories">${categories}</div>
        </div>

        <h3 class="news-title">
          <a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>
        </h3>

        ${item.description ? `<p class="news-description">${item.description}</p>` : ''}

        <div class="ai-analysis-box">
          <div class="ai-box-title">🤖 AI QUANT ANALYSIS</div>
          <div class="ai-badges-row">
            <span class="badge ${overallClass}">OVERALL: ${overall.toUpperCase()}</span>
            ${assetBadges}
          </div>
          ${item.analysis && item.analysis.summary ? `<div class="ai-summary">"${item.analysis.summary}"</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Populate news asset filter dropdown
function populateNewsAssetFilter() {
  const select = document.getElementById('news-asset-filter');
  if (!select || !state.cot || !state.cot.assets) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="all">All Assets</option>' + state.cot.assets.map(a => `<option value="${a.symbol}">${a.displaySymbol} (${a.name})</option>`).join('');
  select.value = currentVal || 'all';
}

// ==========================================================================
// 6. CALENDAR TAB RENDERER
// ==========================================================================

function renderCalendar() {
  const container = document.getElementById('calendar-feed');
  if (!container) return;

  if (!state.calendar || !state.calendar.events || state.calendar.events.length === 0) {
    container.innerHTML = '<div class="narrative-box">No economic calendar events available.</div>';
    return;
  }

  let events = [...state.calendar.events];

  // Filter impact
  if (state.calFilterImpact !== 'all') {
    events = events.filter(e => (e.impact || '').toLowerCase() === state.calFilterImpact.toLowerCase());
  }

  // Filter country
  if (state.calFilterCountry !== 'all') {
    events = events.filter(e => (e.country || '').toUpperCase() === state.calFilterCountry.toUpperCase());
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    events = events.filter(e => e.title.toLowerCase().includes(q) || (e.country && e.country.toLowerCase().includes(q)));
  }

  // Update calendar count badge
  const calBadge = document.getElementById('cal-count');
  if (calBadge) calBadge.textContent = events.length;

  if (events.length === 0) {
    container.innerHTML = '<div class="narrative-box">No calendar events match your current filter parameters.</div>';
    return;
  }

  // Sort by date
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  container.innerHTML = events.map(e => {
    const impactLower = (e.impact || 'low').toLowerCase();
    const impactClass = `cal-impact-${impactLower}`;

    return `
      <div class="calendar-card">
        <div class="cal-time">${formatCalTime(e.date)}</div>

        <div class="cal-country">
          <span class="flag-icon">${getCountryFlag(e.country)}</span>
          <span>${e.country || 'USD'}</span>
        </div>

        <div class="cal-title">${e.title}</div>

        <div>
          <span class="badge ${impactClass}">${e.impact || 'Low'} Impact</span>
        </div>

        <div class="cal-data">
          <div class="cal-val">
            <span class="cal-val-lbl">Forecast</span>
            <span class="cal-val-num">${e.forecast || '-'}</span>
          </div>
          <div class="cal-val">
            <span class="cal-val-lbl">Previous</span>
            <span class="cal-val-num">${e.previous || '-'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Populate calendar country filter dropdown
function populateCalCountryFilter() {
  const select = document.getElementById('cal-country-filter');
  if (!select || !state.calendar || !state.calendar.events) return;

  const countries = Array.from(new Set(state.calendar.events.map(e => e.country).filter(Boolean)));
  select.innerHTML = '<option value="all">All Countries</option>' + countries.map(c => `<option value="${c}">${getCountryFlag(c)} ${c}</option>`).join('');
}

// ==========================================================================
// 7. SENTIMENT TAB RENDERER
// ==========================================================================

function renderSentiment() {
  const container = document.getElementById('sentiment-grid');
  if (!container) return;

  if (!state.cot || !state.cot.assets || state.cot.assets.length === 0) {
    container.innerHTML = '<div class="narrative-box">No COT sentiment data available.</div>';
    return;
  }

  let assets = state.cot.assets;

  // Filter category
  if (state.activeCategory !== 'all') {
    assets = assets.filter(a => a.category.toLowerCase().replace(/\s+/g, '') === state.activeCategory);
  }

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    assets = assets.filter(a => a.symbol.toLowerCase().includes(q) || a.displaySymbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }

  if (assets.length === 0) {
    container.innerHTML = '<div class="narrative-box">No assets match your search.</div>';
    return;
  }

  container.innerHTML = assets.map(a => {
    const latest = a.weeks[0];
    const specTotal = (latest.specLong + latest.specShort) || 1;
    const specLongPct = (latest.specLong / specTotal) * 100;
    const specShortPct = (latest.specShort / specTotal) * 100;

    const ins = computeInsights(a);
    const ext = extremityLabel(ins.rangePct);
    const gaugeId = `gauge-${a.symbol.toLowerCase()}`;

    return `
      <div class="sentiment-card">
        <div class="sentiment-card-header">
          <div>
            <div class="symbol-badge">${a.displaySymbol} <span class="asset-display-symbol">(${a.symbol})</span></div>
            <div class="asset-name">${a.name}</div>
          </div>
          <span class="category-tag">${a.category}</span>
        </div>

        <div class="gauge-container">
          <canvas id="${gaugeId}"></canvas>
          <div class="gauge-center-text">
            <div class="gauge-center-val ${dirClass(latest.specNet)}">${ins.rangePct.toFixed(0)}%</div>
            <div class="gauge-center-lbl">Percentile</div>
          </div>
        </div>

        <div style="text-align: center;">
          <span class="badge ${ins.rangePct >= 70 ? 'badge-bullish' : (ins.rangePct <= 30 ? 'badge-bearish' : 'badge-neutral')}">
            ${ext}
          </span>
        </div>

        <div class="positioning-breakdown">
          <div class="pos-bar-row">
            <div class="pos-bar-labels">
              <span class="pos">${a.specLabel || 'Speculators'}: Long ${specLongPct.toFixed(1)}%</span>
              <span class="neg">Short ${specShortPct.toFixed(1)}%</span>
            </div>
            <div class="pos-bar-track">
              <div class="pos-bar-long" style="width: ${specLongPct}%;"></div>
              <div class="pos-bar-short" style="width: ${specShortPct}%;"></div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-top: 4px;" class="num">
            <span>Net: ${fmtSigned(latest.specNet)}</span>
            <span>OI: ${fmtInt(latest.totalOI)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Render Gauge charts post DOM insert
  assets.forEach(a => {
    const latest = a.weeks[0];
    const specTotal = (latest.specLong + latest.specShort) || 1;
    const specLongPct = (latest.specLong / specTotal) * 100;
    const specShortPct = (latest.specShort / specTotal) * 100;
    const gaugeId = `gauge-${a.symbol.toLowerCase()}`;
    drawGaugeChart(gaugeId, specLongPct, specShortPct);
  });
}

// ==========================================================================
// 8. ASSET DETAIL PAGE (asset.html) RENDERER
// ==========================================================================

function renderDetail() {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get('symbol') || 'GC';

  if (!state.cot || !state.cot.assets) return;

  const asset = state.cot.assets.find(a => a.symbol.toUpperCase() === symbol.toUpperCase()) || state.cot.assets[0];
  if (!asset) return;

  const latest = asset.weeks[0];
  const ins = computeInsights(asset);
  const ext = extremityLabel(ins.rangePct);

  // Update title
  document.title = `${asset.displaySymbol} (${asset.name}) | COT Detail Quant Desk`;

  const container = document.getElementById('detail-app');
  if (!container) return;

  container.innerHTML = detailTemplate(asset, latest, ins, ext);

  // Draw Detail Charts
  drawChart(asset);
  drawChangeChart(asset);
  drawOIChart(asset);
  drawPctChart(asset);

  // Render Historical Table
  renderTable(asset, asset.weeks);

  // Render related news/events for this asset
  renderAssetRelatedNews(asset.symbol);
}

function detailTemplate(asset, latest, ins, ext) {
  return `
    <div class="detail-header">
      <div class="detail-nav">
        <a href="index.html" class="back-btn">← Dashboard</a>
      </div>

      <div class="detail-title-row">
        <div class="detail-title-main">
          <span class="detail-symbol">${asset.displaySymbol}</span>
          <span class="detail-name">${asset.name}</span>
          <span class="category-tag">${asset.category}</span>
        </div>

        <div style="display: flex; gap: 8px;">
          <span class="badge badge-info">${asset.format.toUpperCase()} REPORT</span>
          ${ins.divergence ? '<span class="badge badge-divergence">⚠️ DIVERGENCE DETECTED</span>' : ''}
        </div>
      </div>
    </div>

    <div class="detail-kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">Latest Price</span>
        <span class="kpi-value num">$${latest.price ? fmtPrice(latest.price) : '--'}</span>
        <span class="kpi-sub num ${dirClass(latest.priceChg)}">${latest.priceChg ? fmtSigned2(latest.priceChg) : ''} 1W</span>
      </div>

      <div class="kpi-card">
        <span class="kpi-label">${asset.specLabel || 'Speculator'} Net</span>
        <span class="kpi-value num ${dirClass(latest.specNet)}">${fmtSigned(latest.specNet)}</span>
        <span class="kpi-sub num ${dirClass(latest.specNetChg)}">${fmtSigned(latest.specNetChg)} 1W</span>
      </div>

      <div class="kpi-card">
        <span class="kpi-label">% Open Interest</span>
        <span class="kpi-value num ${dirClass(latest.specNetPctOI)}">${fmtPct(latest.specNetPctOI)}</span>
        <span class="kpi-sub">${ins.streak}W ${ins.streakDir === 'pos' ? '⬆' : '⬇'} streak</span>
      </div>

      <div class="kpi-card">
        <span class="kpi-label">${asset.hedgeLabel || 'Hedger'} Net</span>
        <span class="kpi-value num ${dirClass(latest.hedgeNet)}">${fmtSigned(latest.hedgeNet)}</span>
        <span class="kpi-sub num ${dirClass(latest.hedgeNetChg)}">${fmtSigned(latest.hedgeNetChg)} 1W</span>
      </div>
    </div>

    <div class="narrative-box">
      <div class="narrative-title">QUANT INSIGHTS & NARRATIVE</div>
      <div class="narrative-text">${buildNarrative(asset, latest, ins, ext)}</div>
    </div>

    <div class="detail-chart-grid">
      <div class="chart-card">
        <div class="chart-card-header">
          <span class="chart-card-title">Speculator Net vs Hedger Net vs Price</span>
          <span class="badge badge-info">52 WEEKS</span>
        </div>
        <div class="chart-canvas-container">
          <canvas id="chart-main-canvas"></canvas>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Weekly Net Position Changes</span>
          </div>
          <div class="chart-canvas-container" style="height: 260px;">
            <canvas id="chart-changes-canvas"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Total Open Interest Trend</span>
          </div>
          <div class="chart-canvas-container" style="height: 260px;">
            <canvas id="chart-oi-canvas"></canvas>
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-header">
            <span class="chart-card-title">Speculator Net % of Open Interest</span>
          </div>
          <div class="chart-canvas-container" style="height: 260px;">
            <canvas id="chart-pct-canvas"></canvas>
          </div>
        </div>
      </div>
    </div>

    <!-- Related News -->
    <div style="margin-bottom: 32px;">
      <h2 style="font-size: 1.1rem; margin-bottom: 16px;">Asset Related Intelligence</h2>
      <div id="asset-related-news" class="news-feed"></div>
    </div>

    <!-- Historical Data Table -->
    <div class="chart-card">
      <div class="chart-card-header" style="margin-bottom: 12px;">
        <span class="chart-card-title">Historical Weekly COT Data Table</span>
      </div>
      <div class="table-wrapper">
        <table class="quant-table" id="detail-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Price</th>
              <th>Price Chg</th>
              <th>Spec Long</th>
              <th>Spec Short</th>
              <th>Spec Net</th>
              <th>Spec % OI</th>
              <th>Spec Chg</th>
              <th>Hedge Net</th>
              <th>Hedge Chg</th>
              <th>Total OI</th>
            </tr>
          </thead>
          <tbody id="detail-table-body"></tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTable(asset, weeks) {
  const tbody = document.getElementById('detail-table-body');
  if (!tbody) return;

  tbody.innerHTML = weeks.map(w => `
    <tr>
      <td>${w.date}</td>
      <td class="num">${w.price ? '$' + fmtPrice(w.price) : '-'}</td>
      <td class="num ${dirClass(w.priceChg)}">${w.priceChg ? fmtSigned2(w.priceChg) : '-'}</td>
      <td class="num">${fmtInt(w.specLong)}</td>
      <td class="num">${fmtInt(w.specShort)}</td>
      <td class="num ${dirClass(w.specNet)}">${fmtSigned(w.specNet)}</td>
      <td class="num ${dirClass(w.specNetPctOI)}">${fmtPct(w.specNetPctOI)}</td>
      <td class="num ${dirClass(w.specNetChg)}">${fmtSigned(w.specNetChg)}</td>
      <td class="num ${dirClass(w.hedgeNet)}">${fmtSigned(w.hedgeNet)}</td>
      <td class="num ${dirClass(w.hedgeNetChg)}">${fmtSigned(w.hedgeNetChg)}</td>
      <td class="num">${fmtInt(w.totalOI)}</td>
    </tr>
  `).join('');
}

function renderAssetRelatedNews(symbol) {
  const container = document.getElementById('asset-related-news');
  if (!container || !state.news || !state.news.news) return;

  const items = state.news.news.filter(n => {
    return n.analysis && n.analysis.assets && n.analysis.assets.some(a => a.symbol.toUpperCase() === symbol.toUpperCase());
  });

  if (items.length === 0) {
    container.innerHTML = '<div class="narrative-box">No specific recent news items tagged for this asset.</div>';
    return;
  }

  container.innerHTML = items.slice(0, 3).map(item => `
    <div class="news-card">
      <div class="news-header">
        <div class="news-meta">
          <span class="news-source">FinancialJuice</span> • <span>${formatTimeAgo(item.pubDate)}</span>
        </div>
      </div>
      <h3 class="news-title"><a href="${item.link}" target="_blank">${item.title}</a></h3>
      <p class="news-description">${item.description || ''}</p>
    </div>
  `).join('');
}

// ==========================================================================
// 9. APP INITIALIZATION & EVENT LISTENERS
// ==========================================================================

async function loadData() {
  try {
    const [cotRes, newsRes, calRes] = await Promise.allSettled([
      fetch('data/cot.json').then(r => r.json()),
      fetch('data/news.json').then(r => r.json()),
      fetch('data/calendar.json').then(r => r.json())
    ]);

    if (cotRes.status === 'fulfilled') state.cot = cotRes.value;
    if (newsRes.status === 'fulfilled') state.news = newsRes.value;
    if (calRes.status === 'fulfilled') state.calendar = calRes.value;

    // Update Header Status
    const statusDot = document.querySelector('.brand-dot');
    if (statusDot) statusDot.style.backgroundColor = '#22c55e';

    const lastUpdated = document.getElementById('last-updated-time');
    if (lastUpdated && state.cot && state.cot.generated) {
      lastUpdated.textContent = 'UPDATED: ' + new Date(state.cot.generated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' UTC';
    }

    // Is Detail Page or Dashboard Page?
    if (document.getElementById('detail-app')) {
      renderDetail();
    } else {
      populateNewsAssetFilter();
      populateCalCountryFilter();
      renderActiveTab();
    }
  } catch (err) {
    console.error('Error loading terminal JSON data:', err);
  }
}

function renderActiveTab() {
  // Hide all tab panes
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));

  // Highlight button
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });

  const activePane = document.getElementById(`tab-${state.activeTab}`);
  if (activePane) activePane.classList.add('active');

  // Render content
  if (state.activeTab === 'overview') {
    renderIndex(state.cot);
  } else if (state.activeTab === 'news') {
    renderNews();
  } else if (state.activeTab === 'calendar') {
    renderCalendar();
  } else if (state.activeTab === 'sentiment') {
    renderSentiment();
  }
}

function setupEventListeners() {
  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      state.activeTab = btn.dataset.tab;
      renderActiveTab();
    });
  });

  // Global Search Input
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      renderActiveTab();
    });
  }

  // Category Filter Pills
  document.querySelectorAll('.category-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.category-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeCategory = pill.dataset.category;
      renderActiveTab();
    });
  });

  // News Asset Filter
  const newsAssetSelect = document.getElementById('news-asset-filter');
  if (newsAssetSelect) {
    newsAssetSelect.addEventListener('change', (e) => {
      state.newsFilterAsset = e.target.value;
      renderNews();
    });
  }

  // News Sentiment Filter Pills
  document.querySelectorAll('.news-sentiment-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.news-sentiment-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.newsFilterSentiment = pill.dataset.sentiment;
      renderNews();
    });
  });

  // Calendar Impact Filter Pills
  document.querySelectorAll('.cal-impact-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cal-impact-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.calFilterImpact = pill.dataset.impact;
      renderCalendar();
    });
  });

  // Calendar Country Select
  const calCountrySelect = document.getElementById('cal-country-filter');
  if (calCountrySelect) {
    calCountrySelect.addEventListener('change', (e) => {
      state.calFilterCountry = e.target.value;
      renderCalendar();
    });
  }
}

// Global Category filter handler
function setCategoryFilter(category, element) {
  state.activeCategory = category;
  document.querySelectorAll('.category-pill').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');
  renderActiveTab();
}

// Realtime UTC clock
function startClock() {
  const clockEl = document.getElementById('utc-clock');
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toUTCString().replace('GMT', 'UTC');
  };
  update();
  setInterval(update, 1000);
}

// DOM Loaded Entrypoint
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  setupEventListeners();
  loadData();
});
