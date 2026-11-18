// Security list and reference data.
// Prices are a snapshot from the user's CNBC watchlist on 2026-11-18 (time not recorded).
// In phase 2 this list moves to a Supabase table and prices come from a quote provider
// (see PriceProvider in app.js). Keep field names stable so the swap is a drop-in change.

window.SNAPSHOT_LABEL = 'CNBC watchlist snapshot, Nov 18, 2026';

window.SECURITIES = [
  {
    symbol: 'NVDA-CA', ticker: 'NVDA', exchange: 'TSX', currency: 'CAD', type: 'CDR',
    name: 'Nvidia CDR (CAD Hedged)', issuer: 'NVIDIA Corporation', website: 'https://www.nvidia.com',
    brokerDescription: 'NVIDIA CORP CDR CAD HEDGED CIBC DEPOSITARY RECEIPTS REG S',
    last: 33.62, change: -0.92, changePct: -2.66,
    cdr: { underlyingTicker: 'NVDA', underlyingExchange: 'Nasdaq', ratio: 0.15502319, fxForward: 1.43052769,
           asOf: 'Nov 17, 2026', underlyingLast: 151.78, sourceUrl: 'https://cdr.cibc.com/en/cdr-directory/NVDA' }
  },
  {
    symbol: 'ANTH-CA', ticker: 'ANTH', exchange: 'TSX', currency: 'CAD', type: 'CDR',
    name: 'Anthropic CDR (CAD Hedged)', issuer: 'Anthropic, PBC', website: 'https://www.anthropic.com',
    brokerDescription: null,
    last: null, change: null, changePct: null, note: 'Not trading yet. Listing expected Nov 19, 2026.',
    cdr: { underlyingTicker: 'ANT', underlyingExchange: 'Nasdaq', ratio: null, fxForward: null,
           asOf: null, underlyingLast: null, sourceUrl: 'https://cdr.cibc.com/en/cdr-directory/' }
  },
  {
    symbol: 'SPCX-CA', ticker: 'SPCX', exchange: 'TSX', currency: 'CAD', type: 'CDR',
    name: 'SpaceX CDR (CAD Hedged)', issuer: 'Space Exploration Technologies Corp.', website: 'https://www.spacex.com',
    brokerDescription: null,
    last: 23.91, change: 0.41, changePct: 1.74,
    cdr: { underlyingTicker: 'SPCX', underlyingExchange: 'Nasdaq', ratio: 0.11615069, fxForward: 1.42862772,
           asOf: 'Nov 18, 2026', underlyingLast: null, sourceUrl: 'https://cdr.cibc.com/en/cdr-directory/SPCX' }
  },
  {
    symbol: 'XNDU-CA', ticker: 'XNDU', exchange: 'TSX', currency: 'CAD', type: 'Equity',
    name: 'Xanadu Quantum Technologies Limited', issuer: 'Xanadu Quantum Technologies Limited', website: 'https://www.xanadu.ai',
    brokerDescription: null, last: 2.78, change: 0.05, changePct: 1.83
  },
  {
    symbol: 'BB-CA', ticker: 'BB', exchange: 'TSX', currency: 'CAD', type: 'Equity',
    name: 'BlackBerry Limited', issuer: 'BlackBerry Limited', website: 'https://www.blackberry.com',
    brokerDescription: null, last: 12.34, change: 0.71, changePct: 6.10
  },
  {
    symbol: 'AIM-CA', ticker: 'AIM', exchange: 'TSX', currency: 'CAD', type: 'Equity',
    name: 'Aimia Inc.', issuer: 'Aimia Inc.', website: 'https://www.aimia.com',
    brokerDescription: null, last: 2.60, change: 0.03, changePct: 0.97
  },
  {
    symbol: 'CYM-V', ticker: 'CYM', exchange: 'TSX Venture', currency: 'CAD', type: 'Equity',
    name: 'Cymat Technologies Ltd.', issuer: 'Cymat Technologies Ltd.', website: 'https://www.cymat.com',
    brokerDescription: null, last: 0.10, change: 0, changePct: 0
  },
  {
    symbol: 'ACHR', ticker: 'ACHR', exchange: 'NYSE', currency: 'USD', type: 'Equity',
    name: 'Archer Aviation Inc.', issuer: 'Archer Aviation Inc.', website: 'https://www.archer.com',
    brokerDescription: null, last: 3.30, change: -0.22, changePct: -6.26
  },
  {
    symbol: 'QBTS', ticker: 'QBTS', exchange: 'NYSE', currency: 'USD', type: 'Equity',
    name: 'D-Wave Quantum Inc.', issuer: 'D-Wave Quantum Inc.', website: 'https://www.dwavequantum.com',
    brokerDescription: null, last: 7.75, change: -0.33, changePct: -4.15
  },
  {
    symbol: 'QS', ticker: 'QS', exchange: 'NYSE', currency: 'USD', type: 'Equity',
    name: 'QuantumScape Corporation', issuer: 'QuantumScape Corporation', website: 'https://www.quantumscape.com',
    brokerDescription: null, last: 3.22, change: -0.06, changePct: -1.83
  },
  {
    symbol: 'ACDVF', ticker: 'ACDVF', exchange: 'OTC Markets', currency: 'USD', type: 'Equity',
    name: 'Air Canada', issuer: 'Air Canada', website: 'https://www.aircanada.com',
    brokerDescription: null, last: 15.86, change: -0.05, changePct: -0.31
  }
];
