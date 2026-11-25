// Supabase Edge Function: quotes
// Returns real-time U.S. quotes from Finnhub and CIBC CDR ratios for the Investment Calculator.
// The Finnhub key is read from the FINNHUB_API_KEY secret and never sent to the browser.

const FINNHUB = "https://finnhub.io/api/v1/quote";
const CIBC = "https://cdr.cibc.com/v1/cdr/view";
const SYM = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_SYMBOLS = 30;
const QUOTE_TTL_MS = 15_000; // reuse a quote for 15 seconds to protect the free 60-calls/minute limit
const CDR_TTL_MS = 3_600_000; // CIBC updates ratios once a day

type Quote = { price: number; change: number; changePct: number; prevClose: number; time: string | null } | { error: string };
const quoteCache = new Map<string, { at: number; data: Quote }>();
let cdrCache: { at: number; data: Record<string, unknown> } | null = null;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function symbols(param: string | null) {
  return [...new Set((param ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => SYM.test(s)))].slice(0, MAX_SYMBOLS);
}

async function getQuote(sym: string, key: string): Promise<Quote> {
  const hit = quoteCache.get(sym);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.data;
  const res = await fetch(`${FINNHUB}?symbol=${encodeURIComponent(sym)}`, { headers: { "X-Finnhub-Token": key } });
  let data: Quote;
  if (!res.ok) {
    data = { error: res.status === 429 ? "Rate limit reached" : `Finnhub HTTP ${res.status}` };
  } else {
    const q = await res.json();
    data = q && q.c > 0
      ? { price: q.c, change: q.d, changePct: q.dp, prevClose: q.pc, time: q.t ? new Date(q.t * 1000).toISOString() : null }
      : { error: "No data for this symbol" };
  }
  quoteCache.set(sym, { at: Date.now(), data });
  return data;
}

async function getCdrs() {
  if (cdrCache && Date.now() - cdrCache.at < CDR_TTL_MS) return cdrCache.data;
  const res = await fetch(CIBC);
  if (!res.ok) throw new Error(`CIBC HTTP ${res.status}`);
  const body = await res.json();
  const out: Record<string, unknown> = {};
  for (const x of body.response ?? []) {
    if (!x.active) continue;
    out[x.ticker] = {
      name: x.name,
      ratio: x.ratio,
      fxForward: x.fxForwardRate,
      underlying: String(x.underlyingTradingSymbol ?? "").split(" ")[0],
      updated: x.modifiedDate,
    };
  }
  cdrCache = { at: Date.now(), data: out };
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const syms = symbols(url.searchParams.get("symbols"));
  const cdrSyms = symbols(url.searchParams.get("cdr"));
  const out: Record<string, unknown> = { fetchedAt: new Date().toISOString(), quotes: {}, cdr: {} };

  if (syms.length) {
    const key = Deno.env.get("FINNHUB_API_KEY");
    if (!key) {
      out.error = "FINNHUB_API_KEY secret is not set";
    } else {
      const results = await Promise.all(syms.map((s) => getQuote(s, key).catch((e) => ({ error: String(e) }))));
      syms.forEach((s, i) => ((out.quotes as Record<string, unknown>)[s] = results[i]));
    }
  }

  if (cdrSyms.length) {
    try {
      const all = await getCdrs();
      for (const s of cdrSyms) (out.cdr as Record<string, unknown>)[s] = all[s] ?? null;
    } catch (_e) {
      out.cdrError = "CIBC CDR directory unavailable";
    }
  }

  return json(out);
});
