(function () {
  'use strict';

  // ---------- Price provider ----------
  // Phase 1: returns the snapshot stored in securities.js.
  // Phase 2: replace getQuote with a call to a Supabase Edge Function that holds the
  // price-feed key server-side. The rest of the app only uses this interface.
  // Live: U.S. quotes from Finnhub through the Supabase "quotes" function (key stays server-side).
  // CDRs: estimated from the live U.S. price × CIBC's daily CDR ratio and FX forward.
  // Interlisted Canadian shares (usListing): estimated from the live U.S. price × the live USD→CAD rate.
  // Everything else falls back to the starting price in securities.js.
  const Live = { quotes: {}, cdr: {}, at: null, ok: false, error: null };
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '');
  const PriceProvider = {
    getQuote(sec) {
      if (sec.currency === 'USD') {
        const q = Live.quotes[sec.ticker];
        if (q && q.price > 0) {
          return { price: q.price, change: q.change, changePct: q.changePct, source: `Finnhub, ${fmtTime(q.time)}`, status: 'Live' };
        }
      }
      if (sec.cdr && sec.cdr.ratio && sec.cdr.fxForward) {
        const q = Live.quotes[sec.cdr.underlyingTicker];
        if (q && q.price > 0) {
          const k = sec.cdr.ratio * sec.cdr.fxForward;
          const est = Math.round(q.price * k * 100) / 100;
          const prev = q.prevClose > 0 ? q.prevClose * k : null;
          return {
            price: est,
            change: prev != null ? Math.round((est - prev) * 100) / 100 : null,
            changePct: q.changePct,
            source: `Estimated from ${sec.cdr.underlyingTicker} US$${q.price.toFixed(2)} (Finnhub, ${fmtTime(q.time)})`,
            status: 'Estimate'
          };
        }
      }
      if (sec.usListing && sec.currency === 'CAD') {
        const q = Live.quotes[sec.usListing.ticker];
        const fx = fxBest();
        if (q && q.price > 0 && fx) {
          const dp = q.price * fx < 1 ? 4 : 2;
          const rnd = (v) => Math.round(v * 10 ** dp) / 10 ** dp;
          const est = rnd(q.price * fx);
          const prev = q.prevClose > 0 ? q.prevClose * fx : null;
          return {
            price: est,
            change: prev != null ? rnd(est - prev) : null,
            changePct: q.changePct,
            source: `Estimated from ${sec.usListing.ticker} US$${q.price.toFixed(2)} on ${sec.usListing.exchange} × ${FX.live ? 'live' : 'Bank of Canada'} rate ${fx.toFixed(4)} (Finnhub, ${fmtTime(q.time)})`,
            status: 'Estimate'
          };
        }
      }
      if (sec.last == null) return null;
      return { price: sec.last, change: sec.change, changePct: sec.changePct, source: window.SNAPSHOT_LABEL, status: 'Not live' };
    }
  };

  async function loadQuotes() {
    const url = (window.APP_CONFIG || {}).quotesUrl;
    if (!url) return;
    const list = window.SECURITIES;
    const syms = [...new Set([
      ...list.filter((s) => s.currency === 'USD').map((s) => s.ticker),
      ...list.filter((s) => s.cdr).map((s) => s.cdr.underlyingTicker),
      ...list.filter((s) => s.usListing).map((s) => s.usListing.ticker)
    ])];
    const cdrs = list.filter((s) => s.cdr).map((s) => s.ticker);
    try {
      const key = (window.APP_CONFIG || {}).supabaseAnonKey;
      const res = await fetch(`${url}?symbols=${syms.join(',')}&cdr=${cdrs.join(',')}`, {
        cache: 'no-store',
        headers: key ? { Authorization: `Bearer ${key}`, apikey: key } : {}
      });
      const body = await res.json();
      Live.quotes = body.quotes || {};
      Live.cdr = body.cdr || {};
      Live.at = body.fetchedAt ? new Date(body.fetchedAt) : new Date();
      Live.ok = res.ok && !body.error;
      Live.error = body.error || null;
    } catch (e) {
      Live.ok = false;
      Live.error = 'Price service unavailable';
    }
    for (const s of list) {
      if (!s.cdr) continue;
      const c = Live.cdr[s.ticker];
      if (c && c.ratio && c.fxForward) {
        s.cdr.ratio = c.ratio;
        s.cdr.fxForward = c.fxForward;
        s.cdr.asOf = new Date(c.updated).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      const uq = Live.quotes[s.cdr.underlyingTicker];
      if (uq && uq.price > 0 && state.sec !== s) s.cdr.underlyingLast = uq.price;
    }
    refreshSelectedPrice();
    render();
    if (!$('sec-pop').hidden) openPop();
  }

  // Update the selected security's price unless the user has typed or chosen their own.
  function refreshSelectedPrice() {
    const sec = state.sec;
    if (!sec) return;
    const q = PriceProvider.getQuote(sec);
    if (!q) return;
    state.refPrice = q.price;
    if (state.priceStatus === 'Manual' || state.priceStatus === 'Estimate (manual)') return;
    state.price = q.price;
    state.priceSource = q.source;
    state.priceStatus = q.status;
    setVal('price', q.price.toFixed(q.price < 1 ? 4 : 2));
  }

  // ---------- Exchange rate (free, no key) ----------
  // Live: Coinbase public exchange-rate endpoint (updates about every minute).
  // Reference and fallback: Bank of Canada daily average (Valet API, published once per business day).
  const FX = { live: null, liveTime: null, boc: null, bocDate: null, manual: false, error: false };
  async function loadFx() {
    const [live, boc] = await Promise.allSettled([
      fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', { cache: 'no-store' }).then((r) => r.json()),
      fetch('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1').then((r) => r.json())
    ]);
    if (live.status === 'fulfilled') {
      const v = parseFloat(live.value?.data?.rates?.CAD);
      if (v > 0) { FX.live = v; FX.liveTime = new Date(); }
    }
    if (boc.status === 'fulfilled') {
      const o = boc.value?.observations?.[0];
      const v = parseFloat(o?.FXUSDCAD?.v);
      if (v > 0) { FX.boc = v; FX.bocDate = o.d; }
    }
    FX.error = !FX.live && !FX.boc;
    if (!FX.manual) applyFx();
    refreshSelectedPrice();
    render();
    if (!$('sec-pop').hidden) openPop();
  }
  function fxBest() { return FX.live ?? FX.boc; }
  function applyFx() {
    const v = fxBest();
    if (v) { state.fxMid = Math.round(v * 10000) / 10000; setVal('fxmid', state.fxMid.toFixed(4)); }
  }
  function fxSourceHtml() {
    const t = FX.liveTime ? FX.liveTime.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '';
    const live = FX.live ? `Live: ${FX.live.toFixed(4)} (<a href="https://www.coinbase.com/converter/usd/cad" target="_blank" rel="noopener">Coinbase</a>, ${t})` : 'Live rate unavailable';
    const boc = FX.boc ? `Bank of Canada daily: ${FX.boc.toFixed(4)} (<a href="https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/" target="_blank" rel="noopener">${esc(new Date(FX.bocDate + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }))}</a>)` : '';
    const lead = FX.manual ? 'Using your rate. ' : FX.live ? 'Using the live rate. ' : FX.boc ? 'Using the Bank of Canada rate. ' : '';
    if (FX.error && !FX.manual) return 'Could not load a rate. Enter one manually.';
    return lead + [live, boc].filter(Boolean).join(' · ');
  }

  // ---------- Defaults ----------
  const DEFAULTS = {
    commission: 6.95,
    taxByCurrency: { CAD: 13, USD: 0 },
    spreadPct: 2.25,
    cash: 401.14,
    qty: 11
  };

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const prefix = (ccy) => (ccy === 'CAD' ? 'CA$' : 'US$');
  const group = (x, min, max) => x.toLocaleString('en-CA', { minimumFractionDigits: min, maximumFractionDigits: max });

  function money(x, ccy) {
    const s = group(Math.abs(x), 2, 2);
    return (x < 0 ? '−' : '') + prefix(ccy) + s;
  }
  function price(x, ccy) {
    const dec = Math.abs(x) < 1 ? 4 : 2;
    return prefix(ccy) + group(x, 2, dec);
  }
  function units(q) {
    return group(q, 0, 4);
  }
  function signedMoney(x, ccy) {
    const cls = x > 0 ? 'gain' : x < 0 ? 'loss' : 'flat';
    const arrow = x > 0 ? '▲ +' : x < 0 ? '▼ −' : '';
    return `<span class="pill ${cls}">${arrow}${prefix(ccy)}${group(Math.abs(x), 2, 2)}</span>`;
  }
  function signedPct(p) {
    const cls = p > 0 ? 'gain' : p < 0 ? 'loss' : 'flat';
    const sign = p > 0 ? '+' : p < 0 ? '−' : '';
    return `<span class="${cls}">${sign}${group(Math.abs(p), 2, 2)}%</span>`;
  }
  function changeHtml(sec) {
    sec = sec || {};
    if (sec.change == null) return '<span class="flat">No change data</span>';
    if (sec.change === 0) return '<span class="flat">Unchanged</span>';
    const up = sec.change > 0;
    const cls = up ? 'gain' : 'loss';
    const s = up ? '+' : '−';
    return `<span class="${cls}">${up ? '▲' : '▼'} ${s}${group(Math.abs(sec.change), 2, 4)} (${s}${group(Math.abs(sec.changePct), 2, 2)}%)</span>`;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function rows(items) {
    return items.map(([k, v, opts = {}]) =>
      `<dt class="${[opts.total ? 'total' : '', opts.neg ? 'neg' : ''].join(' ')}">${k}</dt><dd class="${[opts.total ? 'total' : '', opts.text ? 'text' : '', opts.neg ? 'neg' : ''].join(' ')}">${v}</dd>`
    ).join('');
  }
  function nowLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function floorUnits(x, fractional) {
    if (!(x > 0)) return 0;
    return fractional ? Math.floor(x * 10000 + 1e-6) / 10000 : Math.floor(x + 1e-9);
  }
  function ceilUnits(x, fractional) {
    if (!(x > 0)) return 0;
    return fractional ? Math.ceil(x * 10000 - 1e-6) / 10000 : Math.ceil(x - 1e-9);
  }

  // ---------- State ----------
  const state = {
    sec: null,
    side: 'buy',
    price: null,
    refPrice: null,
    priceSource: '',
    priceStatus: '',
    cash: null,
    cashCcy: 'CAD',
    qty: null,
    qtyAuto: true,
    fractional: false,
    commission: DEFAULTS.commission,
    taxPct: 13,
    fxMid: null,
    spreadPct: DEFAULTS.spreadPct,
    avgCost: null,
    targetMode: 'price',
    targetPrice: null,
    targetPct: 10,
    uprice: null
  };

  // ---------- Security selection ----------
  function setSecurity(sec) {
    state.sec = sec;
    const q = PriceProvider.getQuote(sec);
    state.price = q ? q.price : null;
    state.refPrice = state.price;
    state.priceSource = q ? q.source : (sec.note || 'No price available');
    state.priceStatus = q ? q.status : '';
    state.taxPct = DEFAULTS.taxByCurrency[sec.currency];
    state.avgCost = null;
    state.qtyAuto = true;
    state.targetMode = 'price';
    state.targetPrice = state.price ? r2(state.price * 1.1) : null;
    state.uprice = sec.cdr ? sec.cdr.underlyingLast : null;

    setVal('price', state.price == null ? null : state.price.toFixed(state.price < 1 ? 4 : 2));
    setVal('taxpct', state.taxPct);
    setVal('avgcost', null);
    setVal('tprice', state.targetPrice);
    setVal('uprice', state.uprice);
    render();
  }

  function setVal(id, v) {
    const el = $(id);
    if (document.activeElement === el) return;
    el.value = v == null ? '' : String(v);
  }

  // ---------- Calculation ----------
  function compute() {
    const s = state;
    const sec = s.sec;
    const ccy = sec ? sec.currency : s.cashCcy;
    const P = s.price;
    const C = s.commission ?? 0;
    const tax = r2(C * (s.taxPct ?? 0) / 100);
    const fee = r2(C + tax);
    const cashCcy = s.cashCcy;
    const convert = !!sec && cashCcy !== ccy;
    const mid = s.fxMid || 0;
    const sp = (s.spreadPct || 0) / 100;
    // Effective USD→CAD rate after the spread. Buying USD costs more CAD (mid × (1 + spread));
    // selling USD returns less CAD (mid × (1 − spread)).
    const sellingUsd = (s.side === 'buy' && ccy === 'CAD') || (s.side === 'sell' && ccy === 'USD');
    const effRate = sellingUsd ? mid * (1 - sp) : mid * (1 + sp);
    // f = units of cash currency per unit of trade currency
    const f = !convert || effRate <= 0 ? 1 : (ccy === 'USD' ? effRate : 1 / effRate);
    const reason = !sec ? 'sec' : !(P > 0) ? 'price' : (convert && !(effRate > 0)) ? 'rate' : null;
    const out = { ccy, cashCcy, convert, tax, fee, effRate, sellingUsd, f, valid: !reason, reason, hasCash: s.cash > 0, hasQty: s.qty > 0 };
    if (!out.valid) return out;

    const Q = s.qty ?? 0;
    const cash = s.cash ?? 0;

    if (s.side === 'buy') {
      const toCash = (x) => (convert ? r2(x * f) : x);
      const cashTrade = convert ? cash / f : cash;
      let maxU = floorUnits((cashTrade - fee) / P, s.fractional);
      const step = s.fractional ? 0.0001 : 1;
      while (maxU > 0 && toCash(r2(r2(maxU * P) + fee)) > cash) maxU = Math.max(0, r2(maxU - step) || 0);
      const aCost = r2(maxU * P);
      const aTotal = r2(aCost + fee);
      out.a = { units: maxU, cost: aCost, total: aTotal, totalCash: toCash(aTotal), left: r2(cash - (maxU > 0 ? toCash(aTotal) : 0)), cash, cashTrade, coversFee: cashTrade > fee };

      const bCost = r2(Q * P);
      const bTotal = r2(bCost + fee);
      out.b = { qty: Q, cost: bCost, total: bTotal, totalCash: toCash(bTotal), diff: r2(cash - toCash(bTotal)) };

      // Target price / projected gain
      if (Q > 0) {
        const buyTotal = bTotal;
        const be = Math.ceil(((buyTotal + fee) / Q) * 100 - 1e-6) / 100;
        let T = s.targetPrice;
        if (s.targetMode === 'pct' && s.targetPct != null) {
          T = Math.ceil(((buyTotal * (1 + s.targetPct / 100) + fee) / Q) * 100 - 1e-6) / 100;
        }
        if (T != null && T >= 0) {
          const proceeds = r2(r2(Q * T) - fee);
          const gain = r2(proceeds - buyTotal);
          const pct = buyTotal > 0 ? (gain / buyTotal) * 100 : 0;
          out.t = { T, be, buyTotal, proceeds, gain, pct, Q };
        } else {
          out.t = { T: null, be, buyTotal, Q };
        }
      }
    } else {
      const toCash = (x) => (convert ? r2(x * f) : x);
      const needTrade = convert ? cash / f : cash;
      let u = cash > 0 ? ceilUnits((needTrade + fee) / P, s.fractional) : 0;
      const step = s.fractional ? 0.0001 : 1;
      let guard = 0;
      while (u > 0 && toCash(r2(r2(u * P) - fee)) < cash && guard++ < 50) u = r2(u + step);
      const aGross = r2(u * P);
      const aNet = r2(aGross - fee);
      out.a = { units: u, gross: aGross, net: aNet, netCash: toCash(aNet), cash };

      const gross = r2(Q * P);
      const net = r2(gross - fee);
      out.b = { qty: Q, gross, net, netCash: toCash(net) };
      if (s.avgCost != null && s.avgCost > 0 && Q > 0) {
        const basis = r2(s.avgCost * Q);
        const gain = r2(net - basis);
        out.b.basis = basis;
        out.b.gain = gain;
        out.b.pct = (gain / basis) * 100;
      }
    }
    return out;
  }

  // ---------- Render ----------
  function render() {
    const s = state;
    const sec = s.sec;
    const isBuy = s.side === 'buy';
    let r = compute();
    // Quantity follows the maximum until the user sets it themselves.
    if (isBuy && s.qtyAuto && r.valid) {
      const m = r.hasCash ? r.a.units : 0;
      if (s.qty !== m) { s.qty = m; $('qty').value = String(m); r = compute(); }
    }
    const ccy = r.ccy;

    // Selected security strip
    if (sec) {
      $('s-symbol').textContent = sec.symbol;
      $('s-name').textContent = sec.name;
      $('s-name').href = sec.website;
      $('s-name').hidden = false;
      $('s-meta').textContent = `${sec.type} · ${sec.exchange} · ${ccy}`;
      const lq = PriceProvider.getQuote(sec);
      $('s-last').textContent = lq ? price(lq.price, ccy) : '—';
      $('s-chg').innerHTML = lq ? changeHtml(lq) : '';
      $('s-source').innerHTML = lq ? `<span class="badge${lq.status === 'Live' ? ' live' : ''}">${esc(lq.status)}</span>` : esc(sec.note || '');
    } else {
      $('s-symbol').textContent = 'No security selected';
      $('s-name').hidden = true;
      $('s-meta').innerHTML = '<span class="sec-empty">Search above to choose a security.</span>';
      $('s-last').textContent = '';
      $('s-chg').innerHTML = '';
      $('s-source').innerHTML = '';
    }

    document.querySelectorAll('[data-ccy]').forEach((el) => { el.textContent = `(${ccy})`; });

    // Side buttons
    document.querySelectorAll('.side-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === s.side)));

    // Price
    const pr = $('price-range');
    const ref = s.refPrice || s.price || 10;
    const lo = Math.min(ref * 0.5, s.price || ref);
    const hi = Math.max(ref * 1.5, s.price || ref);
    const pStep = ref < 1 ? 0.001 : 0.01;
    pr.min = (Math.floor(lo / pStep) * pStep).toFixed(3);
    pr.max = (Math.ceil(hi / pStep) * pStep).toFixed(3);
    pr.step = pStep;
    $('price').step = pStep;
    if (s.price != null) pr.value = s.price;
    pr.disabled = s.price == null && s.refPrice == null;
    $('price-reset').hidden = s.refPrice == null || s.price === s.refPrice;
    $('price').setAttribute('aria-invalid', String(!!sec && !(s.price > 0)));
    const statusBadge = s.priceStatus ? `<span class="badge">${esc(s.priceStatus)}</span>` : '';
    $('price-hint').innerHTML = !sec ? 'Choose a security to fill this in.'
      : s.price > 0 ? `${esc(s.priceSource)}${statusBadge}`
      : `<span class="warn">Enter a price to calculate.</span> ${esc(sec.note || '')}`;

    // Cash, quantity labels
    $('cash-label').textContent = isBuy ? 'Cash available to invest' : 'Cash you want to raise (receive proceeds in)';
    $('qty-label').textContent = isBuy ? 'Quantity to buy' : 'Quantity to sell';
    $('qty-max').hidden = !isBuy;
    $('avgcost-field').hidden = isBuy;

    // Fractional
    $('qty').step = s.fractional ? '0.0001' : '1';
    const qr = $('qty-range');
    qr.step = s.fractional ? '0.0001' : '1';
    const maxU = r.a ? r.a.units : 0;
    qr.max = String(Math.max(10, Math.ceil(maxU * 1.5), Math.ceil((s.qty || 0) * (isBuy ? 1 : 2))));
    qr.value = String(s.qty || 0);

    // Cash currency
    document.querySelectorAll('.ccy-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cash === s.cashCcy)));
    $('fx-inputs').hidden = !r.convert;
    $('fx-src').innerHTML = fxSourceHtml();
    $('fx-live').hidden = !(FX.manual && fxBest());

    // Cash hint
    let ch = '';
    if (r.convert && r.effRate > 0) {
      const rateTxt = `1 USD = ${group(r.effRate, 4, 4)} CAD (rate ${r.sellingUsd ? '−' : '+'} spread)`;
      ch = isBuy
        ? `${sec.symbol} trades in ${ccy}. Your ${s.cashCcy} is converted at ${rateTxt}: about ${money(r2((s.cash || 0) / r.f), ccy)} to spend.`
        : `${sec.symbol} trades in ${ccy}. Proceeds are converted to ${s.cashCcy} at ${rateTxt}.`;
    } else if (r.convert) {
      ch = 'Enter a conversion rate.';
    }
    $('cash-hint').textContent = ch;
    $('cash-hint').hidden = !ch;

    // Fees
    $('fee-total').textContent = money(r.fee, ccy);
    $('tax-amt').textContent = money(r.tax, ccy);
    $('qty-hint').textContent = isBuy && s.qtyAuto && r.valid ? 'Set to the most your cash can buy. Change it to explore other amounts.' : '';
    $('qty-hint').hidden = !$('qty-hint').textContent;
    $('tax-hint').textContent = `Defaults: 13% HST on CAD trades, 0% on USD trades. Fee is charged in the security's currency (${ccy}).`;

    // Result cards
    renderCards(r, isBuy, ccy);
    renderTarget(r, isBuy, ccy);
    renderDetails(sec, ccy);
  }

  function renderCards(r, isBuy, ccy) {
    const s = state;
    const cc = r.cashCcy;
    const msg = { sec: 'Choose a security', price: 'Enter a price', rate: 'Enter a conversion rate' }[r.reason];
    if (!r.valid) {
      $('a-kicker').textContent = isBuy ? 'With your cash you can buy' : 'To raise your cash, sell';
      $('a-big').innerHTML = '—';
      $('a-rows').innerHTML = rows([['Next step', msg, { text: true }]]);
      $('b-kicker').textContent = isBuy ? 'Buying your quantity costs' : 'Selling your quantity pays';
      $('b-big').innerHTML = '—';
      $('b-rows').innerHTML = rows([['Next step', msg, { text: true }]]);
      return;
    }
    const tagHtml = isBuy ? '<span class="tag buy">BUY</span>' : '<span class="tag sell">SELL</span>';

    if (isBuy) {
      const a = r.a;
      $('a-kicker').innerHTML = `${tagHtml} With ${money(a.cash, cc)} you can buy`;
      $('a-big').innerHTML = `${units(a.units)} <small>units</small>`;
      const aRows = [
        [`Cost of ${units(a.units)} units`, money(a.cost, ccy)],
        ['Trading fee', money(r.fee, ccy)],
        ['Total cost', money(a.units > 0 ? a.total : 0, ccy), { total: true }]
      ];
      if (r.convert) aRows.push([`Total in ${cc}`, money(a.units > 0 ? a.totalCash : 0, cc)]);
      aRows.push(['Cash left', money(a.left, cc), { neg: a.left < 0 }]);
      if (!a.coversFee) aRows.push(['Note', '<span class="loss">Cash does not cover the fee</span>', { text: true }]);
      $('a-rows').innerHTML = r.hasCash ? rows(aRows) : rows([['Next step', 'Enter your cash available', { text: true }]]);
      if (!r.hasCash) { $('a-big').textContent = '—'; $('a-kicker').innerHTML = `${tagHtml} With your cash you can buy`; }

      const b = r.b;
      $('b-kicker').innerHTML = `${tagHtml} Buying ${units(b.qty)} units costs`;
      $('b-big').textContent = b.qty > 0 ? money(r.convert ? b.totalCash : b.total, cc) : '—';
      const bRows = [
        [`${units(b.qty)} × ${price(s.price, ccy)}`, money(b.cost, ccy)],
        ['Trading fee', money(r.fee, ccy)],
        ['Total cost', money(b.total, ccy), { total: true }]
      ];
      if (r.convert) bRows.push([`Total in ${cc}`, money(b.totalCash, cc)]);
      if (r.hasCash) bRows.push(['Cash left', money(b.diff, cc), { neg: b.diff < 0 }]);
      $('b-rows').innerHTML = b.qty > 0 ? rows(bRows) : rows([['Next step', 'Enter a quantity', { text: true }]]);
    } else {
      const a = r.a;
      $('a-kicker').innerHTML = `${tagHtml} To raise ${money(a.cash, cc)} sell`;
      $('a-big').innerHTML = a.units > 0 ? `${units(a.units)} <small>units</small>` : '—';
      const aRows = [
        [`${units(a.units)} × ${price(s.price, ccy)}`, money(a.gross, ccy)],
        ['Trading fee', `−${money(r.fee, ccy)}`],
        ['You receive', money(a.net, ccy), { total: true }]
      ];
      if (r.convert) aRows.push([`You receive in ${cc}`, money(a.netCash, cc)]);
      $('a-rows').innerHTML = a.units > 0 ? rows(aRows) : rows([['Next step', 'Enter the cash you want to raise', { text: true }]]);

      const b = r.b;
      $('b-kicker').innerHTML = `${tagHtml} Selling ${units(b.qty)} units pays`;
      $('b-big').textContent = b.qty > 0 ? money(r.convert ? b.netCash : b.net, cc) : '—';
      const bRows = [
        [`${units(b.qty)} × ${price(s.price, ccy)}`, money(b.gross, ccy)],
        ['Trading fee', `−${money(r.fee, ccy)}`],
        ['You receive', money(b.net, ccy), { total: !(b.net < 0), neg: b.net < 0 }]
      ];
      if (r.convert) bRows.push([`You receive in ${cc}`, money(b.netCash, cc), { neg: b.netCash < 0 }]);
      if (b.gain != null) {
        bRows.push(['Your cost for these units', money(b.basis, ccy)]);
        bRows.push(['Gain or loss on sale', `${signedMoney(b.gain, ccy)}`]);
        bRows.push(['Return', signedPct(b.pct)]);
      }
      if (b.net < 0) bRows.push(['Note', '<span class="loss">Fee is larger than the sale</span>', { text: true }]);
      $('b-rows').innerHTML = b.qty > 0 ? rows(bRows) : rows([['Next step', 'Enter a quantity', { text: true }]]);
    }
  }

  function renderTarget(r, isBuy, ccy) {
    const panel = $('target-panel');
    panel.hidden = !isBuy;
    if (!isBuy) return;
    const t = r.t;
    const tr = $('tprice-range');
    if (!r.valid || !t) {
      $('t-basis').textContent = '';
      $('t-rows').innerHTML = rows([['Next step', r.valid ? 'Enter a quantity to buy' : ({ sec: 'Choose a security', price: 'Enter a price', rate: 'Enter a conversion rate' }[r.reason]), { text: true }]]);
      tr.disabled = true;
      return;
    }
    tr.disabled = false;
    $('t-basis').textContent = `Based on buying ${units(t.Q)} units at ${price(state.price, ccy)}`;
    const P = state.price;
    tr.min = (P * 0.5).toFixed(2);
    tr.max = (Math.max(P * 2, (t.T || 0) * 1.1)).toFixed(2);
    tr.step = P < 1 ? '0.001' : '0.01';
    if (t.T != null) tr.value = String(t.T);

    if (state.targetMode === 'pct') setVal('tprice', t.T);
    else setVal('tpct', t.pct != null ? r2(t.pct) : null);

    const items = [
      ['Total buy cost', money(t.buyTotal, ccy)],
      ['Break-even price', price(t.be, ccy)]
    ];
    if (t.T != null) {
      items.push([`Value at ${price(t.T, ccy)} after sell fee`, money(t.proceeds, ccy)]);
      items.push(['Projected gain', signedMoney(t.gain, ccy)]);
      items.push(['Return', signedPct(t.pct)]);
    }
    $('t-rows').innerHTML = rows(items);
  }

  function renderDetails(sec, ccy) {
    if (!sec) {
      $('d-rows').innerHTML = rows([['Next step', 'Choose a security', { text: true }]]);
      $('cdr-box').hidden = true;
      return;
    }
    const items = [
      ['Coded description', `<span>${esc(sec.symbol)}</span>`],
    ];
    if (sec.brokerDescription) items.push(['Broker description', esc(sec.brokerDescription), { text: true }]);
    items.push(['Decoded description', `<a href="${esc(sec.website)}" target="_blank" rel="noopener" data-testid="link-decoded">${esc(sec.name)}</a>${sec.issuer && sec.issuer !== sec.name ? ` · ${esc(sec.issuer)}` : ''}`, { text: true }]);
    items.push(['Security type', esc(sec.type === 'CDR' ? 'CDR (Canadian Depositary Receipt), equity' : sec.type), { text: true }]);
    items.push(['Exchange', esc(sec.exchange), { text: true }]);
    items.push(['Trading currency', ccy, { text: true }]);
    if (sec.usListing) items.push(['Also trades as', `${esc(sec.usListing.ticker)} on ${esc(sec.usListing.exchange)} (USD). The CAD price shown is an estimate: U.S. price × live USD→CAD rate, before any spread. The price you get comes from the TSX.`, { text: true }]);
    if (sec.cdr) items.push(['Tracks', `${esc(sec.cdr.underlyingTicker)} on ${esc(sec.cdr.underlyingExchange)} (USD)`, { text: true }]);
    $('d-rows').innerHTML = rows(items);

    const box = $('cdr-box');
    box.hidden = !sec.cdr;
    if (!sec.cdr) return;
    const c = sec.cdr;
    const hasRatio = c.ratio != null && c.fxForward != null;
    $('uprice').disabled = !hasRatio;
    const est = hasRatio && state.uprice > 0 ? r2(state.uprice * c.ratio * c.fxForward) : null;
    $('cdr-est').textContent = est != null ? price(est, 'CAD') : '—';
    $('use-est').disabled = est == null;
    $('use-est').dataset.est = est != null ? String(est) : '';
    $('cdr-hint').innerHTML = hasRatio
      ? `U.S. price × CDR ratio ${c.ratio} × FX forward ${c.fxForward}, from <a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">CIBC's CDR directory</a> (${esc(c.asOf)}). An estimate only; the price you get comes from the exchange.`
      : `CIBC hasn't published a ratio for this CDR yet. Enter the price manually once it trades.`;
  }

  // ---------- Search (combobox) ----------
  const search = $('sec-search');
  const pop = $('sec-pop');
  const list = $('sec-list');
  let matches = [];
  let active = -1;

  function filter(q) {
    q = q.trim().toLowerCase();
    return window.SECURITIES.filter((s) => !q || s.symbol.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.issuer || '').toLowerCase().includes(q));
  }
  function openPop() {
    matches = filter(search.value);
    active = matches.length ? 0 : -1;
    list.innerHTML = matches.map((s, i) => `
      <li class="opt-row" role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}" data-testid="option-security-${esc(s.symbol)}">
        <span class="opt-sym">${esc(s.symbol)}</span><span class="opt-sep">|</span>
        <span class="opt-name">${esc(s.name)}</span><span class="opt-sep">|</span>
        ${(() => { const q = PriceProvider.getQuote(s); return `<span class="opt-price">${q ? group(q.price, 2, 4) + ' ' + s.currency : 'No price'}</span>
        <span class="opt-chg">${q ? changeHtml(q) : ''}</span>`; })()}
      </li>`).join('');
    $('pop-heading').textContent = search.value.trim() ? `Matches (${matches.length})` : `Your securities (${matches.length})`;
    $('pop-empty').hidden = matches.length > 0;
    pop.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    updateActive();
  }
  function closePop() {
    pop.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  }
  function updateActive() {
    list.querySelectorAll('.opt-row').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      search.setAttribute('aria-activedescendant', `opt-${active}`);
      const el = $(`opt-${active}`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else search.removeAttribute('aria-activedescendant');
  }
  function choose(i) {
    const sec = matches[i];
    if (!sec) return;
    search.value = '';
    closePop();
    search.blur();
    setSecurity(sec);
  }
  search.addEventListener('focus', openPop);
  search.addEventListener('input', openPop);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (pop.hidden) openPop(); active = Math.min(matches.length - 1, active + 1); updateActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); updateActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(active); }
    else if (e.key === 'Escape') { closePop(); search.blur(); }
  });
  list.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.opt-row');
    if (row) { e.preventDefault(); choose(Number(row.dataset.i)); }
  });
  document.addEventListener('mousedown', (e) => { if (!$('search').contains(e.target)) closePop(); });

  // ---------- Input wiring ----------
  function bindNum(id, key, after) {
    $(id).addEventListener('input', (e) => { state[key] = num(e.target.value); if (after) after(); render(); });
  }
  bindNum('price', 'price', () => { state.priceSource = 'Entered manually'; state.priceStatus = 'Manual'; });
  $('price-range').addEventListener('input', (e) => {
    state.price = num(e.target.value); state.priceSource = 'Adjusted with slider'; state.priceStatus = 'Manual';
    $('price').value = e.target.value; render();
  });
  $('price-reset').addEventListener('click', () => { setSecurityPriceToLast(); });
  function setSecurityPriceToLast() {
    if (!state.sec) return;
    const q = PriceProvider.getQuote(state.sec);
    if (!q) return;
    state.price = q.price; state.priceSource = q.source; state.priceStatus = q.status;
    $('price').value = String(q.price); render();
  }

  bindNum('cash', 'cash');
  bindNum('qty', 'qty', () => { state.qtyAuto = false; });
  $('qty-range').addEventListener('input', (e) => { state.qtyAuto = false; state.qty = num(e.target.value); $('qty').value = e.target.value; render(); });
  $('qty-max').addEventListener('click', () => {
    const r = compute();
    state.qtyAuto = true;
    if (r.a && r.hasCash) { state.qty = r.a.units; $('qty').value = String(r.a.units); }
    render();
  });
  $('fractional').addEventListener('change', (e) => {
    state.fractional = e.target.checked;
    if (!state.fractional && state.qty != null) { state.qty = Math.floor(state.qty); $('qty').value = String(state.qty); }
    render();
  });
  bindNum('avgcost', 'avgCost');
  bindNum('commission', 'commission');
  bindNum('taxpct', 'taxPct');
  bindNum('fxmid', 'fxMid', () => { FX.manual = true; });
  $('fx-live').addEventListener('click', () => { FX.manual = false; applyFx(); render(); });
  bindNum('spread', 'spreadPct');
  document.querySelectorAll('.ccy-toggle button').forEach((b) => b.addEventListener('click', () => { state.cashCcy = b.dataset.cash; render(); }));

  $('tprice').addEventListener('input', (e) => { state.targetMode = 'price'; state.targetPrice = num(e.target.value); render(); });
  $('tpct').addEventListener('input', (e) => { state.targetMode = 'pct'; state.targetPct = num(e.target.value); render(); });
  $('tprice-range').addEventListener('input', (e) => { state.targetMode = 'price'; state.targetPrice = num(e.target.value); $('tprice').value = e.target.value; render(); });

  bindNum('uprice', 'uprice');
  $('use-est').addEventListener('click', (e) => {
    const est = num(e.currentTarget.dataset.est);
    if (est == null) return;
    state.price = est; state.priceSource = 'Estimated from the U.S. share price you entered'; state.priceStatus = 'Estimate (manual)';
    $('price').value = String(est); render();
  });

  document.querySelectorAll('.side-btn').forEach((b) => b.addEventListener('click', () => {
    state.side = b.dataset.side;
    if (state.side === 'buy' && state.targetMode === 'price' && state.targetPrice == null && state.price) state.targetPrice = r2(state.price * 1.1);
    render();
  }));

  // ---------- Init ----------
  $('commission').value = String(state.commission);
  // Reset
  $('reset').addEventListener('click', () => {
    Object.assign(state, {
      sec: null, side: 'buy', price: null, refPrice: null, priceSource: '', priceStatus: '',
      cash: null, cashCcy: 'CAD', qty: null, qtyAuto: true, fractional: false, commission: DEFAULTS.commission,
      taxPct: DEFAULTS.taxByCurrency.CAD, spreadPct: DEFAULTS.spreadPct, avgCost: null,
      targetMode: 'price', targetPrice: null, targetPct: 10, uprice: null
    });
    ['price', 'cash', 'qty', 'avgcost', 'tprice', 'tpct', 'uprice', 'sec-search'].forEach((id) => { $(id).value = ''; });
    $('commission').value = String(DEFAULTS.commission);
    $('taxpct').value = String(DEFAULTS.taxByCurrency.CAD);
    $('spread').value = String(DEFAULTS.spreadPct);
    $('fractional').checked = false;
    $('account').value = 'RRSP';
    $('ordertype').value = 'limit';
    $('tradetime').value = nowLocal();
    FX.manual = false; applyFx();
    closePop();
    render();
    window.scrollTo({ top: 0 });
  });
  $('spread').value = String(state.spreadPct);
  $('tradetime').value = nowLocal();
  $('taxpct').value = String(state.taxPct);
  render();
  loadFx();
  setInterval(() => { loadFx(); }, 60000);
  loadQuotes();
  setInterval(() => { loadQuotes(); }, 30000);
})();
