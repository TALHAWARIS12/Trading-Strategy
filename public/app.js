/**
 * Antigravity Trading Engine Dashboard Orchestrator
 * v2.0 — with AI Trade Reasoning Center
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global dashboard state
  const state = {
    isBotRunning: true,
    pollingInterval: null,
    apiBase: '/api',
    currentTrades: [],
    currentPositions: [],
    selectedTradeId: null,
    rawAiVisible: false,
    aiLoading: false,
    aiCache: {},
  };

  // Cache DOM elements
  const el = {
    wsStatusPill: document.getElementById('ws-status-pill'),
    wsStatusDot: document.getElementById('ws-status-dot'),
    wsStatusText: document.getElementById('ws-status-text'),
    healthStatusPill: document.getElementById('health-status-pill'),
    healthStatusText: document.getElementById('health-status-text'),
    compactStatus: document.getElementById('compact-status'),
    compactStatusDot: document.querySelector('.sidebar-footer .pulse-dot'),
    envMode: document.getElementById('env-mode'),

    metricBalance: document.getElementById('metric-balance'),
    metricPnLPercent: document.getElementById('metric-pnl-percent'),
    metricRealizedPnL: document.getElementById('metric-realized-pnl'),
    metricUnrealizedPnL: document.getElementById('metric-unrealized-pnl'),
    metricWinRate: document.getElementById('metric-win-rate'),
    metricTotalTrades: document.getElementById('metric-total-trades'),

    metricDrawdown: document.getElementById('metric-drawdown'),
    metricSharpe: document.getElementById('metric-sharpe'),
    metricProfitFactor: document.getElementById('metric-profit-factor'),
    metricOpenCount: document.getElementById('metric-open-count'),

    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnReset: document.getElementById('btn-reset'),
    resetBalanceInput: document.getElementById('reset-balance-input'),

    positionsTableBody: document.getElementById('positions-table-body'),
    positionsCountBadge: document.getElementById('positions-count-badge'),
    tradesTableBody: document.getElementById('trades-table-body'),
    tradesCountBadge: document.getElementById('trades-count-badge'),
    terminalBody: document.getElementById('terminal-body'),
    terminalLinesBadge: document.getElementById('terminal-lines-badge'),
    btnClearTerminal: document.getElementById('btn-clear-terminal'),
    terminalRefreshIcon: document.getElementById('terminal-refresh-icon'),

    // AI Reasoning Center
    aiTradeSelector: document.getElementById('ai-trade-selector'),
    aiStatusBadge: document.getElementById('ai-reasoning-status-badge'),
    aiLoader: document.getElementById('ai-loader'),
    aiEmptyState: document.getElementById('ai-empty-state'),
    aiContentContainer: document.getElementById('ai-content-container'),
    aiTradePair: document.getElementById('ai-trade-pair'),
    aiTradeSide: document.getElementById('ai-trade-side'),
    aiTradeIdLabel: document.getElementById('ai-trade-id-label'),
    aiTradeEntryPrice: document.getElementById('ai-trade-entry-price'),
    aiTradeExitPrice: document.getElementById('ai-trade-exit-price'),
    aiTradePnl: document.getElementById('ai-trade-pnl'),
    aiSectionSetup: document.getElementById('ai-section-setup'),
    aiSectionRisk: document.getElementById('ai-section-risk'),
    aiSectionOutcome: document.getElementById('ai-section-outcome'),
    btnShowRawAi: document.getElementById('btn-show-raw-ai'),
    aiRawResponseContainer: document.getElementById('ai-raw-response-container'),
  };

  // Initialize Lucide icons
  lucide.createIcons();

  // ─────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────

  function formatUSD(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  }

  function formatPercent(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00%';
    const prefix = num > 0 ? '+' : '';
    return `${prefix}${num.toFixed(2)}%`;
  }

  /**
   * Converts a Markdown string into styled HTML for .ai-text-content containers.
   * Handles bold, italic, bullets, numbered lists, code, blockquotes, and paragraphs.
   */
  function markdownToHtml(md) {
    if (!md) return '';
    let html = md
      // Escape existing HTML to prevent XSS
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

    // Inline code: `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    const lines = html.split('\n');
    const result = [];
    let inUl = false;
    let inOl = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Blockquote
      if (/^&gt;\s?(.*)$/.test(line)) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (inOl) { result.push('</ol>'); inOl = false; }
        result.push(`<blockquote>${line.replace(/^&gt;\s?/, '')}</blockquote>`);
        continue;
      }

      // Unordered list: - or *
      if (/^[-*]\s+(.+)$/.test(line)) {
        if (inOl) { result.push('</ol>'); inOl = false; }
        if (!inUl) { result.push('<ul>'); inUl = true; }
        result.push(`<li>${line.replace(/^[-*]\s+/, '')}</li>`);
        continue;
      }

      // Ordered list: 1. 2. ...
      if (/^\d+\.\s+(.+)$/.test(line)) {
        if (inUl) { result.push('</ul>'); inUl = false; }
        if (!inOl) { result.push('<ol>'); inOl = true; }
        result.push(`<li>${line.replace(/^\d+\.\s+/, '')}</li>`);
        continue;
      }

      // Close any open lists
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }

      // Headings (strip them since we have section headers already)
      if (/^#{1,3}\s+(.+)$/.test(line)) {
        const headingText = line.replace(/^#{1,3}\s+/, '');
        result.push(`<strong>${headingText}</strong>`);
        continue;
      }

      // Empty line = paragraph break
      if (line.trim() === '') {
        continue;
      }

      // Normal paragraph line
      result.push(`<p>${line}</p>`);
    }

    if (inUl) result.push('</ul>');
    if (inOl) result.push('</ol>');

    return result.join('');
  }

  /**
   * Splits the full AI reasoning text into the three thematic sections.
   * Tries to locate heading markers like "**1.**", "**Trade Setup", "**Risk", "**Outcome"
   * and falls back to splitting by line count if not found.
   */
  function splitReasoningSections(text) {
    // Try to split on numbered sections or known headings
    const setupPattern = /\*{0,2}(?:1\.?\s*[:\-–]?\s*)?(?:Trade\s+)?Setup[^:]*[:—\-]?\*{0,2}/i;
    const riskPattern  = /\*{0,2}(?:2\.?\s*[:\-–]?\s*)?Risk[\s/]Reward[^:]*[:—\-]?\*{0,2}/i;
    const outcomePattern = /\*{0,2}(?:3\.?\s*[:\-–]?\s*)?Outcome[^:]*[:—\-]?\*{0,2}/i;

    const setupIdx   = text.search(setupPattern);
    const riskIdx    = text.search(riskPattern);
    const outcomeIdx = text.search(outcomePattern);

    if (setupIdx !== -1 && riskIdx !== -1 && outcomeIdx !== -1) {
      return {
        setup:   text.slice(setupIdx, riskIdx).replace(setupPattern, '').trim(),
        risk:    text.slice(riskIdx, outcomeIdx).replace(riskPattern, '').trim(),
        outcome: text.slice(outcomeIdx).replace(outcomePattern, '').trim(),
      };
    }

    // Fallback: split by numbered lines "1.", "2.", "3."
    const byNumber = text.split(/(?=\*{0,2}\d+[\.\)]\s)/);
    if (byNumber.length >= 3) {
      return {
        setup:   byNumber[1]?.replace(/^\*{0,2}\d+[\.\)]\s*/, '').trim() || text,
        risk:    byNumber[2]?.replace(/^\*{0,2}\d+[\.\)]\s*/, '').trim() || '',
        outcome: byNumber[3]?.replace(/^\*{0,2}\d+[\.\)]\s*/, '').trim() || '',
      };
    }

    // Last resort: thirds
    const third = Math.floor(text.length / 3);
    return {
      setup:   text.slice(0, third),
      risk:    text.slice(third, third * 2),
      outcome: text.slice(third * 2),
    };
  }

  // ─────────────────────────────────────────────────
  // AI REASONING STATE MANAGEMENT
  // ─────────────────────────────────────────────────

  function setAiState(state) {
    // 'empty' | 'loading' | 'content' | 'error'
    el.aiLoader.style.display = 'none';
    el.aiEmptyState.style.display = 'none';
    el.aiContentContainer.style.display = 'none';

    if (state === 'loading') {
      el.aiLoader.style.display = 'flex';
      el.aiStatusBadge.className = 'badge status-loading';
      el.aiStatusBadge.textContent = 'Generating...';
    } else if (state === 'content') {
      el.aiContentContainer.style.display = 'flex';
      el.aiStatusBadge.className = 'badge status-success';
      el.aiStatusBadge.textContent = 'Analysis Complete';
    } else if (state === 'error') {
      el.aiEmptyState.style.display = 'block';
      el.aiStatusBadge.className = 'badge status-error';
      el.aiStatusBadge.textContent = 'Error';
    } else {
      el.aiEmptyState.style.display = 'block';
      el.aiStatusBadge.className = 'badge';
      el.aiStatusBadge.textContent = 'Ready';
      el.aiStatusBadge.style.background = 'rgba(255,255,255,0.05)';
      el.aiStatusBadge.style.color = 'var(--text-muted)';
      el.aiStatusBadge.style.border = '1px solid var(--border-color)';
    }
    // Re-init icons for any newly rendered lucide icons
    lucide.createIcons();
  }

  /**
   * Core function: fetches AI reasoning for a trade ID and renders it.
   */
  async function loadTradeReasoning(tradeId) {
    if (!tradeId || state.aiLoading) return;

    state.aiLoading = true;
    state.selectedTradeId = tradeId;
    state.rawAiVisible = false;

    // Update trade selector to match
    if (el.aiTradeSelector) {
      el.aiTradeSelector.value = tradeId;
    }

    // Highlight the selected row, remove highlight from others
    document.querySelectorAll('.clickable-row').forEach(row => {
      row.classList.remove('ai-selected');
    });
    const selectedRow = document.querySelector(`.clickable-row[data-trade-id="${tradeId}"]`);
    if (selectedRow) {
      selectedRow.classList.add('ai-selected');
    }

    // Scroll to AI section
    const aiSection = document.getElementById('ai-reasoning-section');
    if (aiSection) {
      aiSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Show loader
    setAiState('loading');

    try {
      // Find trade metadata for header display (search both closed trades and open positions)
      const trade = state.currentTrades.find(t => t.id === tradeId) || state.currentPositions.find(p => p.id === tradeId);

      // Fill trade header meta
      if (trade) {
        el.aiTradePair.textContent = trade.pair || '—';
        const sideClass = (trade.side || '').toLowerCase() === 'long' ? 'side-badge side-long' : 'side-badge side-short';
        el.aiTradeSide.className = sideClass;
        el.aiTradeSide.textContent = (trade.side || '').toUpperCase();
        el.aiTradeIdLabel.textContent = `ID: ${tradeId.substring(0, 8)}...`;
        el.aiTradeEntryPrice.textContent = formatUSD(trade.entryPrice);
        el.aiTradeExitPrice.textContent = trade.exitPrice ? formatUSD(trade.exitPrice) : '(open position)';

        const pnl = parseFloat(trade.pnl);
        const pnlPercent = trade.pnlPercent;
        const pnlClass = pnl > 0 ? 'text-green' : (pnl < 0 ? 'text-red' : '');
        const sign = pnl > 0 ? '+' : '';
        el.aiTradePnl.className = pnlClass;
        el.aiTradePnl.textContent = isNaN(pnl)
          ? '—'
          : `${sign}${formatUSD(pnl)} (${pnlPercent}%)`;
      }

      // Check client-side cache first to avoid redundant expensive API calls
      let fullText = '';
      if (state.aiCache[tradeId]) {
        fullText = state.aiCache[tradeId];
      } else {
        // Fetch reasoning from backend
        const response = await fetch(`${state.apiBase}/trades/${tradeId}/reasoning`);
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Server error ${response.status}`);
        }
        const data = await response.json();
        fullText = data.reasoning || '';
        
        // Cache success responses (do not cache errors)
        if (fullText && !fullText.includes('Failed to generate') && !fullText.includes('"error"')) {
          state.aiCache[tradeId] = fullText;
        }
      }

      // Store raw for toggle
      el.aiRawResponseContainer.textContent = fullText;
      el.aiRawResponseContainer.style.display = 'none';
      if (el.btnShowRawAi) {
        el.btnShowRawAi.innerHTML = '<i data-lucide="text"></i> Show Raw Response';
      }

      // Split into sections
      const sections = splitReasoningSections(fullText);

      // Render
      el.aiSectionSetup.innerHTML   = markdownToHtml(sections.setup)   || '<em>No setup details provided.</em>';
      el.aiSectionRisk.innerHTML    = markdownToHtml(sections.risk)    || '<em>No risk analysis provided.</em>';
      el.aiSectionOutcome.innerHTML = markdownToHtml(sections.outcome) || '<em>No outcome summary provided.</em>';

      setAiState('content');
    } catch (err) {
      console.error('[AI Reasoning] Error:', err);
      // Show error inside the empty-state area
      el.aiEmptyState.innerHTML = `
        <i data-lucide="alert-triangle" style="color: var(--accent-red); width: 40px; height: 40px; margin-bottom: 12px;"></i>
        <p style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">AI Reasoning Failed</p>
        <p style="font-size: 12px; color: var(--text-muted); max-width: 400px; margin: 0 auto;">${err.message}</p>
      `;
      setAiState('error');
    } finally {
      state.aiLoading = false;
      lucide.createIcons();
    }
  }

  // ─────────────────────────────────────────────────
  // DASHBOARD DATA FETCHING
  // ─────────────────────────────────────────────────

  async function fetchPerformance() {
    try {
      const response = await fetch(`${state.apiBase}/performance`);
      if (!response.ok) throw new Error('Failed to fetch performance');
      const metrics = await response.json();

      el.metricBalance.textContent = formatUSD(metrics.totalBalance);
      el.metricRealizedPnL.textContent = formatUSD(metrics.realizedPnL);
      el.metricUnrealizedPnL.textContent = formatUSD(metrics.unrealizedPnL);
      el.metricWinRate.textContent = `${parseFloat(metrics.winRate).toFixed(1)}%`;
      el.metricTotalTrades.textContent = `${metrics.closedTrades + metrics.openPositions} total trades`;

      const pnlChange = parseFloat(metrics.totalPnLPercent);
      el.metricPnLPercent.textContent = formatPercent(pnlChange);
      el.metricPnLPercent.className = 'trend';
      if (pnlChange > 0) {
        el.metricPnLPercent.classList.add('trend-up');
      } else if (pnlChange < 0) {
        el.metricPnLPercent.classList.add('trend-down');
      } else {
        el.metricPnLPercent.classList.add('trend-neutral');
      }

      el.metricDrawdown.textContent = `${parseFloat(metrics.maxDrawdown).toFixed(2)}%`;
      el.metricSharpe.textContent = parseFloat(metrics.sharpeRatio).toFixed(2);
      el.metricProfitFactor.textContent = parseFloat(metrics.profitFactor).toFixed(2);
      el.metricOpenCount.textContent = metrics.openPositions;
      el.positionsCountBadge.textContent = `${metrics.openPositions} Active`;
    } catch (error) {
      console.error('Error fetching performance:', error);
    }
  }

  async function fetchStatus() {
    try {
      const response = await fetch(`${state.apiBase}/status`);
      if (!response.ok) throw new Error('Failed to fetch status');
      const status = await response.json();

      const connectedPairs = Array.isArray(status.connectedPairs) ? status.connectedPairs : [];
      const isWsConnected = connectedPairs.length > 0;

      if (isWsConnected) {
        el.wsStatusPill.className = 'status-pill ws-pill connected';
        el.wsStatusText.textContent = `${connectedPairs.length} Pairs`;
      } else {
        el.wsStatusPill.className = 'status-pill ws-pill';
        el.wsStatusText.textContent = 'Disconnected';
      }

      const isHealthy = status.health === 'HEALTHY';
      el.healthStatusText.textContent = isHealthy ? 'Healthy' : 'Degraded';
      if (isHealthy) {
        el.healthStatusPill.style.color = 'var(--accent-green)';
        el.healthStatusPill.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      } else {
        el.healthStatusPill.style.color = 'var(--accent-red)';
        el.healthStatusPill.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      }

      const isRunning = status.running;
      if (isRunning) {
        el.compactStatus.textContent = 'Running';
        el.compactStatusDot.className = 'pulse-dot status-online';
      } else {
        el.compactStatus.textContent = 'Stopped';
        el.compactStatusDot.className = 'pulse-dot status-offline';
      }
    } catch (error) {
      console.error('Error fetching status:', error);
    }
  }

  async function fetchPositions() {
    try {
      const response = await fetch(`${state.apiBase}/positions`);
      if (!response.ok) throw new Error('Failed to fetch positions');
      const data = await response.json();

      state.currentPositions = data.positions || [];

      if (!data.positions || data.positions.length === 0) {
        el.positionsTableBody.innerHTML = `
          <tr>
            <td colspan="9" class="empty-state">
              <i data-lucide="inbox"></i>
              <p>No active open positions. Watching for strategy breakout triggers...</p>
            </td>
          </tr>
        `;
        lucide.createIcons();
        return;
      }

      let html = '';
      data.positions.forEach(pos => {
        const sideClass = pos.side.toLowerCase() === 'long' ? 'side-long' : 'side-short';
        const pnl = parseFloat(pos.pnl);
        const pnlClass = pnl > 0 ? 'text-green' : (pnl < 0 ? 'text-red' : '');
        const sign = pnl > 0 ? '+' : '';
        const isSelected = state.selectedTradeId === pos.id;

        html += `
          <tr class="clickable-row ${isSelected ? 'ai-selected' : ''}" data-trade-id="${pos.id}" title="Click to analyze this active position with AI">
            <td class="text-bold">
              ${pos.pair}
              <span class="ai-click-hint">⚡ AI</span>
            </td>
            <td><span class="side-badge ${sideClass}">${pos.side}</span></td>
            <td>${parseFloat(pos.qty).toFixed(4)}</td>
            <td>${formatUSD(pos.entryPrice)}</td>
            <td>${formatUSD(pos.currentPrice)}</td>
            <td class="text-red">${formatUSD(pos.stopLoss)}</td>
            <td class="text-green">${formatUSD(pos.takeProfit1)}</td>
            <td class="text-green">${formatUSD(pos.takeProfit2)}</td>
            <td class="${pnlClass} text-bold">${sign}${formatUSD(pnl)} (${pos.pnlPercent}%)</td>
          </tr>
        `;
      });

      el.positionsTableBody.innerHTML = html;

      // Bind click listeners on position rows
      document.querySelectorAll('#positions-table-body .clickable-row').forEach(row => {
        row.addEventListener('click', () => {
          const tradeId = row.getAttribute('data-trade-id');
          if (tradeId) loadTradeReasoning(tradeId);
        });
      });

      lucide.createIcons();
    } catch (error) {
      console.error('Error fetching positions:', error);
    }
  }

  async function fetchTrades() {
    try {
      const response = await fetch(`${state.apiBase}/trades?limit=50`);
      if (!response.ok) throw new Error('Failed to fetch trades');
      const data = await response.json();

      el.tradesCountBadge.textContent = `${data.count} Closed`;
      state.currentTrades = data.trades || [];

      // Update the AI trade selector dropdown
      updateTradeSelector(state.currentTrades);

      if (!data.trades || data.trades.length === 0) {
        el.tradesTableBody.innerHTML = `
          <tr>
            <td colspan="9" class="empty-state">
              <i data-lucide="inbox"></i>
              <p>No historical trades found in trading.db. Run the bot to place trades!</p>
            </td>
          </tr>
        `;
        lucide.createIcons();
        return;
      }

      let html = '';
      data.trades.forEach(trade => {
        const sideClass = trade.side.toLowerCase() === 'long' ? 'side-long' : 'side-short';
        const pnl = parseFloat(trade.pnl);
        const pnlClass = pnl > 0 ? 'text-green' : (pnl < 0 ? 'text-red' : '');
        const sign = pnl > 0 ? '+' : '';
        const exitTimeStr = new Date(trade.exitTime).toLocaleString();
        const isSelected = state.selectedTradeId === trade.id;

        let tagClass = 'tag-open';
        if (trade.exitReason === 'TP1_HIT' || trade.exitReason === 'TP2_HIT') tagClass = 'tag-hit';
        if (trade.exitReason === 'SL_HIT') tagClass = 'tag-sl';

        html += `
          <tr class="clickable-row ${isSelected ? 'ai-selected' : ''}" data-trade-id="${trade.id}" title="Click to analyze this trade with AI">
            <td class="text-muted" style="font-size: 11px;">
              ${trade.id.substring(0, 8)}...
              <span class="ai-click-hint">⚡ AI</span>
            </td>
            <td class="text-bold">${trade.pair}</td>
            <td><span class="side-badge ${sideClass}">${trade.side}</span></td>
            <td>${formatUSD(trade.entryPrice)}</td>
            <td>${parseFloat(trade.entryQty).toFixed(4)}</td>
            <td>${formatUSD(trade.exitPrice)}</td>
            <td style="font-size: 12px; color: var(--text-muted);">${exitTimeStr}</td>
            <td><span class="status-tag ${tagClass}">${trade.exitReason}</span></td>
            <td class="${pnlClass} text-bold">${sign}${formatUSD(pnl)} (${trade.pnlPercent}%)</td>
          </tr>
        `;
      });

      el.tradesTableBody.innerHTML = html;

      // Bind click listeners on each row
      document.querySelectorAll('.clickable-row').forEach(row => {
        row.addEventListener('click', () => {
          const tradeId = row.getAttribute('data-trade-id');
          if (tradeId) loadTradeReasoning(tradeId);
        });
      });

      lucide.createIcons();
    } catch (error) {
      console.error('Error fetching trades:', error);
    }
  }

  function updateTradeSelector(trades) {
    if (!el.aiTradeSelector) return;
    const current = el.aiTradeSelector.value;

    // Build options
    let options = '<option value="">-- Click a trade row or select here --</option>';
    trades.forEach(t => {
      const pnl = parseFloat(t.pnl);
      const sign = pnl > 0 ? '+' : '';
      const pnlStr = isNaN(pnl) ? '' : ` | PnL: ${sign}${pnl.toFixed(2)}`;
      options += `<option value="${t.id}" ${current === t.id ? 'selected' : ''}>${t.pair} ${t.side} @ ${parseFloat(t.entryPrice).toFixed(2)}${pnlStr}</option>`;
    });

    el.aiTradeSelector.innerHTML = options;
    if (current) el.aiTradeSelector.value = current;
  }

  // ─────────────────────────────────────────────────
  // BOT CONTROLS
  // ─────────────────────────────────────────────────

  async function startBot() {
    try {
      const response = await fetch(`${state.apiBase}/start-bot`, { method: 'POST' });
      if (response.ok) {
        state.isBotRunning = true;
        el.compactStatus.textContent = 'Running';
        el.compactStatusDot.className = 'pulse-dot status-online';
        alert('Simulated paper trading bot instructions initialized!');
      }
    } catch (error) {
      console.error('Error starting bot:', error);
    }
  }

  async function stopBot() {
    try {
      const response = await fetch(`${state.apiBase}/stop-bot`, { method: 'POST' });
      if (response.ok) {
        state.isBotRunning = false;
        el.compactStatus.textContent = 'Stopped';
        el.compactStatusDot.className = 'pulse-dot status-offline';
        alert('Simulated paper trading bot stopped.');
      }
    } catch (error) {
      console.error('Error stopping bot:', error);
    }
  }

  async function resetPaperAccount() {
    const val = parseFloat(el.resetBalanceInput.value);
    if (isNaN(val) || val <= 0) {
      alert('Please enter a valid balance amount.');
      return;
    }
    if (!confirm(`Are you sure you want to reset the SQLite ledger and clear all trades? This resets the paper balance back to $${val.toLocaleString()}.`)) {
      return;
    }
    try {
      const response = await fetch(`${state.apiBase}/reset-paper-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: val })
      });
      if (response.ok) {
        alert(`Paper account ledger reset successfully! Fresh balance: ${formatUSD(val)}`);
        // Reset AI section too
        setAiState('empty');
        state.selectedTradeId = null;
        state.currentTrades = [];
        updateDashboard();
      }
    } catch (error) {
      console.error('Error resetting paper account:', error);
    }
  }

  // ─────────────────────────────────────────────────
  // LOGS
  // ─────────────────────────────────────────────────

  let lastLogsStr = '';
  async function fetchLogs() {
    try {
      if (el.terminalRefreshIcon) el.terminalRefreshIcon.classList.add('spinning');
      const response = await fetch(`${state.apiBase}/logs`);
      if (!response.ok) throw new Error('Failed to fetch logs');
      const data = await response.json();
      const logs = data.logs || [];

      const logsStr = JSON.stringify(logs);
      if (logsStr === lastLogsStr) {
        return;
      }
      lastLogsStr = logsStr;

      let html = '';
      logs.forEach(line => {
        let levelClass = 'log-info';
        if (line.includes('warn:')) levelClass = 'log-warn';
        else if (line.includes('error:')) levelClass = 'log-error';
        else if (line.includes('debug:')) levelClass = 'log-debug';
        else if (line.includes('Initializing') || line.includes('started')) levelClass = 'system-msg';

        const safeLine = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        html += `<div class="terminal-line ${levelClass}">${safeLine}</div>`;
      });

      el.terminalBody.innerHTML = html || '<div class="terminal-line system-msg">No logs recorded yet. Running operations...</div>';
      el.terminalLinesBadge.textContent = `${logs.length} Lines`;
      el.terminalBody.scrollTop = el.terminalBody.scrollHeight;
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      if (el.terminalRefreshIcon) {
        setTimeout(() => el.terminalRefreshIcon.classList.remove('spinning'), 300);
      }
    }
  }

  function clearTerminal() {
    el.terminalBody.innerHTML = '<div class="terminal-line system-msg">Terminal buffer cleared. Operations feed will resume...</div>';
    el.terminalLinesBadge.textContent = '0 Lines';
  }

  // ─────────────────────────────────────────────────
  // EVENT LISTENERS
  // ─────────────────────────────────────────────────

  el.btnStart.addEventListener('click', startBot);
  el.btnStop.addEventListener('click', stopBot);
  el.btnReset.addEventListener('click', resetPaperAccount);
  el.btnClearTerminal.addEventListener('click', clearTerminal);

  // Trade selector dropdown change
  if (el.aiTradeSelector) {
    el.aiTradeSelector.addEventListener('change', () => {
      const tradeId = el.aiTradeSelector.value;
      if (tradeId) loadTradeReasoning(tradeId);
    });
  }

  // Raw AI response toggle
  if (el.btnShowRawAi) {
    el.btnShowRawAi.addEventListener('click', () => {
      state.rawAiVisible = !state.rawAiVisible;
      if (el.aiRawResponseContainer) {
        el.aiRawResponseContainer.style.display = state.rawAiVisible ? 'block' : 'none';
      }
      el.btnShowRawAi.innerHTML = state.rawAiVisible
        ? '<i data-lucide="eye-off"></i> Hide Raw Response'
        : '<i data-lucide="text"></i> Show Raw Response';
      lucide.createIcons();
    });
  }

  // Sidebar Navigation Links Smooth-Scrolling and Active State Toggle
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      
      if (href === '#' || href === '#dashboard') {
        e.preventDefault();
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
          item.classList.remove('active');
        });
        const dashNav = document.getElementById('nav-dashboard');
        if (dashNav) dashNav.classList.add('active');
        
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
          mainContent.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        return;
      }

      if (href && href.startsWith('#')) {
        e.preventDefault();
        
        // Remove active class from all nav items
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
          item.classList.remove('active');
        });
        
        // Add active class to clicked item
        link.classList.add('active');
        
        // Smooth scroll to the target section
        const targetId = href.substring(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // ─────────────────────────────────────────────────
  // POLLING LOOP
  // ─────────────────────────────────────────────────

  function updateDashboard() {
    fetchStatus();
    fetchPerformance();
    fetchPositions();
    fetchTrades();
    fetchLogs();
  }

  // Initial load + schedule
  setAiState('empty');
  updateDashboard();
  state.pollingInterval = setInterval(updateDashboard, 2000);
});
