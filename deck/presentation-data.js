/**
 * JC Parets Style Technical Presentation Deck Data
 * Stock Market Media / TrendLabs Strategy Deck
 *
 * v2 content: lesser-known equities (FN, MEDP, CRDO, MUSA),
 * Lighter crypto (LIT) + LIT/BTC relative-strength gauge.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smaAt(data, i, period) {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let j = 0; j < period; j++) sum += data[i - j].close;
  return sum / period;
}

function attachIndicators(data) {
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < data.length; i++) {
    data[i].sma50 = smaAt(data, i, 50);
    data[i].sma200 = smaAt(data, i, 200);
    if (i === 0) {
      data[i].rsi = 50;
      continue;
    }
    const change = data[i].close - data[i - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i < 14) {
      avgGain += gain;
      avgLoss += loss;
      data[i].rsi = 50;
    } else if (i === 14) {
      avgGain = (avgGain + gain) / 14;
      avgLoss = (avgLoss + loss) / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      data[i].rsi = 100 - 100 / (1 + rs);
    } else {
      avgGain = (avgGain * 13 + gain) / 14;
      avgLoss = (avgLoss * 13 + loss) / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      data[i].rsi = 100 - 100 / (1 + rs);
    }
    const spy = 520 + i * 0.42 + Math.sin(i / 14) * 6;
    data[i].rsRatio = (data[i].close / spy) * 100;
  }
  return data;
}

function generateTechnicalSeries(startPrice, trendSlope, volatility, points, baseBreakoutIdx, seed, pinClose) {
  const rand = mulberry32(seed || 1);
  const data = [];
  let price = startPrice;
  const startDate = new Date(2025, 0, 6);

  for (let i = 0; i < points; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const cycle = Math.sin(i / 18) * (volatility * 0.55);
    const thrust = i > baseBreakoutIdx ? trendSlope * 1.35 : 0;
    const step = trendSlope + (rand() - 0.47) * volatility + thrust;
    price = Math.max(startPrice * 0.35, price + step + cycle * 0.15);

    const body = (rand() - 0.5) * volatility * 0.85;
    const open = price - body;
    const close = price;
    const wick = volatility * (0.35 + rand() * 0.7);
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volBoost = i > baseBreakoutIdx ? 1.7 : 1;
    const volume = Math.floor((18e6 + rand() * 42e6) * volBoost);

    data.push({
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }),
      open,
      high,
      low,
      close,
      volume
    });
  }

  if (pinClose && data.length) {
    const offset = pinClose - data[data.length - 1].close;
    for (const bar of data) {
      bar.open += offset;
      bar.high += offset;
      bar.low += offset;
      bar.close += offset;
    }
  }

  const decimals = pinClose && pinClose < 2 ? 4 : 2;
  for (const bar of data) {
    bar.open = +bar.open.toFixed(decimals);
    bar.high = +bar.high.toFixed(decimals);
    bar.low = +bar.low.toFixed(decimals);
    bar.close = +bar.close.toFixed(decimals);
  }

  attachIndicators(data);
  for (const bar of data) {
    if (bar.sma50 != null) bar.sma50 = +bar.sma50.toFixed(decimals);
    if (bar.sma200 != null) bar.sma200 = +bar.sma200.toFixed(decimals);
    if (bar.rsi != null) bar.rsi = +bar.rsi.toFixed(1);
    if (bar.rsRatio != null) bar.rsRatio = +bar.rsRatio.toFixed(3);
  }
  return data;
}

/* Palette refs for Fib/level lines (kept in sync with styles.css/chart-engine):
   green #4a7c59, navy #23405f, muted gold #b08a3e, brick red #a8462f. */
const LEVEL_COLORS = {
  targetFar: "#23405f",
  targetNear: "#4a7c59",
  pivot: "#b08a3e",
  risk: "#a8462f"
};

const PRESENTATION_DATA = {
  macroRegime: {
    status: "BULLISH",
    marketBreadth: "78% Above 200-day SMA",
    creditSpreads: "Tight & Contracting",
    smallCapParticipation: "Multi-Year Base Expansion",
    theme: "Weight of the Evidence Favors Longs"
  },
  slides: [
    // SLIDE 1: Macro Setup & Weight of the Evidence
    {
      id: "macro-overview",
      type: "macro",
      title: "The Weight of the Evidence",
      subtitle: "Multi-Timeframe Macro Regime & Intermarket Confluence",
      setupPill: "Primary Trend: Bullish",
      pillClass: "bullish",
      dwell: 26,
      metrics: [
        { label: "Equities / Bonds", value: "ALL-TIME HIGH", class: "green" },
        { label: "% Above 200d SMA", value: "78.4%", class: "green" },
        { label: "Primary Bias", value: "LONG RISK", class: "blue" },
        { label: "VIX Regime", value: "COMPRESSED", class: "gold" }
      ],
      pillars: [
        {
          icon: "🌐",
          title: "Global Equity Breadth",
          status: "BULLISH BREAKOUT",
          statusClass: "bullish",
          desc: "New 52-week highs in the U.S., Europe, and Asia continue to expand. When the vast majority of sectors and global indexes are in uptrends, you do NOT bet on market collapses.",
          miniMetrics: ["NYSE Net Highs: +240", "Advance/Decline: Positive"]
        },
        {
          icon: "⚡",
          title: "Credit & Intermarket Ratios",
          status: "HIGH RISK APPETITE",
          statusClass: "bullish",
          desc: "High Yield vs Treasuries (HYG/IEI) and Consumer Discretionary vs Staples (XLY/XLP) are trending higher. Credit markets and risk-on leadership confirm the equity rally.",
          miniMetrics: ["HY Spreads: 295 bps", "Discretionary: Outperforming"]
        },
        {
          icon: "🎯",
          title: "The 'Line in the Sand' Rule",
          status: "ASYMMETRIC TRADES",
          statusClass: "bullish",
          desc: "We don't need to predict the future. We simply identify the levels where we are unequivocally wrong, manage risk ruthlessly below them, and let our winners run to Fibonacci targets.",
          miniMetrics: ["Avg Win/Loss: 3.8x", "Discipline: Absolute"]
        }
      ],
      jcNotes: `
        <h5>JC's Opening Monologue:</h5>
        <blockquote>"Look, everybody wants to have an opinion on the Fed, the election, or inflation. You know what I care about? The Weight of the Evidence. Price is the only thing that pays."</blockquote>
        <p>When you look across thousands of charts every week, the message is loud and clear: breadth is expanding, credit spreads are tight, and leadership is coming from places most people aren't even watching.</p>
        <p><strong>Our approach tonight:</strong> No mega-cap darlings. We go through four under-the-radar equity setups — Fabrinet, Medpace, Credo, Murphy USA — plus one crypto breakout in Lighter's LIT token. Every one of them with a well-defined risk level and asymmetric upside Fibonacci targets.</p>
      `
    },

    // SLIDE 2: FN (Fabrinet)
    {
      id: "fn-compounder-breakout",
      type: "chart",
      ticker: "FN",
      name: "Fabrinet",
      title: "The Quiet Compounder: Shelf Breakout",
      subtitle: "Precision Optical Manufacturing — Steady Uptrend Resolving Higher",
      setupPill: "Continuation Breakout",
      pillClass: "bullish",
      dwell: 34,
      metrics: [
        { label: "Current Price", value: "$262.40", class: "blue" },
        { label: "Line in Sand (Risk)", value: "$245.00", class: "red" },
        { label: "Target 1 (161.8%)", value: "$315.00", class: "green" },
        { label: "Target 2 (261.8%)", value: "$380.00", class: "green" }
      ],
      ruleTitle: "Quiet Trends Are The Best Trends",
      ruleQuote: "Nobody talks about Fabrinet at cocktail parties, and that's exactly why we love it. Low-drama compounders that grind along rising 50-days and then resolve sideways shelves higher are the bread and butter of this business.",
      tradeLevels: [
        { type: "risk", label: "Line in the Sand (Stop)", val: "$245.00 (-6.6%)" },
        { type: "pivot", label: "Breakout Pivot Shelf", val: "$255.00" },
        { type: "target", label: "Target 1 (161.8% Fib)", val: "$315.00 (+20.0%)" },
        { type: "target", label: "Target 2 (261.8% Fib)", val: "$380.00 (+44.8%)" },
        { type: "risk", label: "Risk / Reward Ratio", val: "4.4 : 1 Asymmetric", customClass: "rr" }
      ],
      evidence: [
        "<strong>Shelf Resolution:</strong> Textbook 10-week flat shelf between $245–$255 resolving to the upside on expanding volume.",
        "<strong>Moving Average Stack:</strong> Price > rising 50-day SMA ($260) > rising 200-day SMA ($235) — a perfectly ordered bullish trend.",
        "<strong>RSI Profile:</strong> Holding the 55–70 bullish regime through the entire consolidation — no bearish divergence anywhere.",
        "<strong>Execution:</strong> We are long above $245, targeting $315 and $380. Below $245, the setup simply doesn't exist."
      ],
      chartData: generateTechnicalSeries(218, 0.16, 2.4, 220, 168, 26240, 262.4),
      fibLevels: [
        { label: "261.8% Fib Extension ($380.00)", price: 380, color: LEVEL_COLORS.targetFar },
        { label: "161.8% Fib Extension ($315.00)", price: 315, color: LEVEL_COLORS.targetNear },
        { label: "Breakout Pivot ($255.00)", price: 255, color: LEVEL_COLORS.pivot },
        { label: "Line in the Sand ($245.00)", price: 245, color: LEVEL_COLORS.risk }
      ],
      riskLevel: 245,
      jcNotes: `
        <h5>JC's Charting Breakdown on FN:</h5>
        <blockquote>"This is the kind of chart I dream about. Fabrinet does precision optical manufacturing for the datacom and telecom world — and while everyone argues about the AI darlings, FN just quietly built a ten-week shelf and broke out."</blockquote>
        <p><strong>The Trade Playbook:</strong></p>
        <ul>
          <li><strong>The Rule:</strong> Above $245, the path of least resistance is higher toward $315, then $380.</li>
          <li><strong>Risk Management:</strong> A close back below $245 means the shelf failed and we step aside. Risk is defined to about 6.5% against 20–45% of upside. That's the asymmetry we get paid for.</li>
        </ul>
      `
    },

    // SLIDE 3: MEDP (Medpace Holdings)
    {
      id: "medp-base-after-correction",
      type: "chart",
      ticker: "MEDP",
      name: "Medpace Holdings, Inc.",
      title: "The Base After the Correction",
      subtitle: "Clinical Research Leader — Rounding Base & Momentum Reset Complete",
      setupPill: "Base-After-Correction",
      pillClass: "bullish",
      dwell: 32,
      metrics: [
        { label: "Current Price", value: "$348.60", class: "blue" },
        { label: "Line in Sand (Risk)", value: "$320.00", class: "red" },
        { label: "Target 1 (161.8%)", value: "$420.00", class: "green" },
        { label: "Target 2 (261.8%)", value: "$505.00", class: "green" }
      ],
      ruleTitle: "Corrections End Where Bases Begin",
      ruleQuote: "A 30% correction doesn't kill a leadership stock — it resets it. When the selling exhausts and a multi-month base forms at rising long-term support, the next leg is usually the best one.",
      tradeLevels: [
        { type: "risk", label: "Line in the Sand (Stop)", val: "$320.00 (-8.2%)" },
        { type: "pivot", label: "Base Neckline Pivot", val: "$342.00" },
        { type: "target", label: "Target 1 (161.8% Fib)", val: "$420.00 (+20.5%)" },
        { type: "target", label: "Target 2 (261.8% Fib)", val: "$505.00 (+44.9%)" },
        { type: "risk", label: "Risk / Reward Ratio", val: "4.3 : 1 Asymmetric", customClass: "rr" }
      ],
      evidence: [
        "<strong>Selling Exhaustion:</strong> Five-month rounding base carved out directly on top of the rising 200-day SMA after a 30% correction.",
        "<strong>Neckline Reclaim:</strong> Price has pushed back through the $342 neckline on the strongest weekly volume since the correction began.",
        "<strong>RSI Reset & Reacceleration:</strong> Momentum washed out to the 40 zone — classic bull-market reset — and is now pressing back above 60.",
        "<strong>Execution:</strong> We are buyers above $320 with targets at $420 and $505. Below $320 the base failed and we're out."
      ],
      chartData: generateTechnicalSeries(308, 0.11, 4.2, 220, 170, 34863, 348.6),
      fibLevels: [
        { label: "261.8% Fib Extension ($505.00)", price: 505, color: LEVEL_COLORS.targetFar },
        { label: "161.8% Fib Extension ($420.00)", price: 420, color: LEVEL_COLORS.targetNear },
        { label: "Base Neckline ($342.00)", price: 342, color: LEVEL_COLORS.pivot },
        { label: "Line in the Sand ($320.00)", price: 320, color: LEVEL_COLORS.risk }
      ],
      riskLevel: 320,
      jcNotes: `
        <h5>JC's Charting Breakdown on MEDP:</h5>
        <blockquote>"Medpace got cut by a third and everyone declared the story dead. But look at what the chart actually did — it stopped going down, built a five-month rounding base right on the rising 200-day, and just poked its head through the neckline."</blockquote>
        <p><strong>The Execution:</strong></p>
        <ul>
          <li>Our line in the sand is $320 — just beneath the shelf of the late-stage base.</li>
          <li>Above $320 we want to be long, targeting $420 first and $505 down the road. If the base fails, we take the small loss and revisit later. No emotion, just levels.</li>
        </ul>
      `
    },

    // SLIDE 4: CRDO (Credo Technology Group)
    {
      id: "crdo-ai-infra-momentum",
      type: "chart",
      ticker: "CRDO",
      name: "Credo Technology Group",
      title: "High-Beta AI Plumbing: Momentum Ignition",
      subtitle: "Connectivity Silicon — Volatility Compression Firing Out of a Flag",
      setupPill: "High-Beta Momentum",
      pillClass: "bullish",
      dwell: 30,
      metrics: [
        { label: "Current Price", value: "$64.80", class: "blue" },
        { label: "Line in Sand (Risk)", value: "$54.00", class: "red" },
        { label: "Target 1 (161.8%)", value: "$82.00", class: "green" },
        { label: "Target 2 (261.8%)", value: "$110.00", class: "green" }
      ],
      ruleTitle: "Volatility Compression Precedes Expansion",
      ruleQuote: "When a high-beta leader stops making lower lows and coils into a tight flag on drying-up volume, the ensuing expansion is almost always in the direction of the primary trend. And this trend is up.",
      tradeLevels: [
        { type: "risk", label: "Line in the Sand (Stop)", val: "$54.00 (-16.7%)" },
        { type: "pivot", label: "Flag Breakout Pivot", val: "$58.50" },
        { type: "target", label: "Target 1 (161.8% Fib)", val: "$82.00 (+26.5%)" },
        { type: "target", label: "Target 2 (261.8% Fib)", val: "$110.00 (+69.8%)" },
        { type: "risk", label: "Risk / Reward Ratio", val: "4.1 : 1 Asymmetric", customClass: "rr" }
      ],
      evidence: [
        "<strong>Compression Coil:</strong> Six-week bull flag with successively tighter weekly closes — range contracted 60% from the prior swing.",
        "<strong>AI Infrastructure Bid:</strong> Active electrical cable demand keeps CRDO pinned near highs while the broader semi complex chops sideways.",
        "<strong>Relative Strength:</strong> RS line vs the S&P 500 made a new cycle high three weeks before price did — the tell we look for.",
        "<strong>Execution:</strong> Position size is cut in half — this is a high-beta name. Long above $54, targeting $82 and $110."
      ],
      chartData: generateTechnicalSeries(34, 0.13, 1.6, 220, 165, 6480, 64.8),
      fibLevels: [
        { label: "261.8% Fib Extension ($110.00)", price: 110, color: LEVEL_COLORS.targetFar },
        { label: "161.8% Fib Extension ($82.00)", price: 82, color: LEVEL_COLORS.targetNear },
        { label: "Flag Pivot ($58.50)", price: 58.5, color: LEVEL_COLORS.pivot },
        { label: "Line in the Sand ($54.00)", price: 54, color: LEVEL_COLORS.risk }
      ],
      riskLevel: 54,
      jcNotes: `
        <h5>JC's Charting Breakdown on CRDO:</h5>
        <blockquote>"Everyone knows the GPU names. Almost nobody can tell you who makes the cables and connectivity silicon that actually link those GPUs together. That's Credo — and the chart is coiled like a spring."</blockquote>
        <p><strong>The Trade Playbook:</strong></p>
        <ul>
          <li><strong>The Rule:</strong> Above $54 we are long with half size — respect the beta — targeting $82 and then $110.</li>
          <li><strong>Risk Management:</strong> High-beta cuts both ways. A break of $54 and the coil failed; we exit without negotiation. Defined risk, half position, full discipline.</li>
        </ul>
      `
    },

    // SLIDE 5: MUSA (Murphy USA)
    {
      id: "musa-quiet-relative-strength",
      type: "chart",
      ticker: "MUSA",
      name: "Murphy USA Inc.",
      title: "The Quiet Relative Strength Leader",
      subtitle: "Fuel & Convenience Retail — Polarity Flip at Prior Cycle Highs",
      setupPill: "Quiet RS Leader",
      pillClass: "bullish",
      dwell: 30,
      metrics: [
        { label: "Current Price", value: "$512.30", class: "blue" },
        { label: "Line in Sand (Risk)", value: "$465.00", class: "red" },
        { label: "Target 1 (161.8%)", value: "$585.00", class: "green" },
        { label: "Target 2 (261.8%)", value: "$680.00", class: "green" }
      ],
      ruleTitle: "Relative Strength You Have To Look For",
      ruleQuote: "The best leadership is the kind nobody notices. While the indexes chopped for months, a gas station operator quietly made new highs. That's not a story stock — that's institutional accumulation hiding in plain sight.",
      tradeLevels: [
        { type: "risk", label: "Line in the Sand (Stop)", val: "$465.00 (-9.2%)" },
        { type: "pivot", label: "Polarity Pivot (Old Highs)", val: "$498.00" },
        { type: "target", label: "Target 1 (161.8% Fib)", val: "$585.00 (+14.2%)" },
        { type: "target", label: "Target 2 (261.8% Fib)", val: "$680.00 (+32.7%)" },
        { type: "risk", label: "Risk / Reward Ratio", val: "3.6 : 1 Asymmetric", customClass: "rr" }
      ],
      evidence: [
        "<strong>Polarity Flip:</strong> The prior cycle highs near $498 — resistance for over a year — have flipped to support on two successful retests.",
        "<strong>Stealth RS:</strong> MUSA made fresh all-time highs during a flat-to-down tape for the S&P 500. That is the definition of relative strength.",
        "<strong>Defensive Growth Hybrid:</strong> Staples-adjacent fuel retail leading while defensives as a group lag — idiosyncratic strength, not sector beta.",
        "<strong>Execution:</strong> We are long above $465, targeting $585 and $680. Low volatility, tight risk — this one lets us size up."
      ],
      chartData: generateTechnicalSeries(438, 0.24, 4.4, 220, 158, 51230, 512.3),
      fibLevels: [
        { label: "261.8% Fib Extension ($680.00)", price: 680, color: LEVEL_COLORS.targetFar },
        { label: "161.8% Fib Extension ($585.00)", price: 585, color: LEVEL_COLORS.targetNear },
        { label: "Polarity Pivot ($498.00)", price: 498, color: LEVEL_COLORS.pivot },
        { label: "Line in the Sand ($465.00)", price: 465, color: LEVEL_COLORS.risk }
      ],
      riskLevel: 465,
      jcNotes: `
        <h5>JC's Charting Breakdown on MUSA:</h5>
        <blockquote>"Murphy USA sells gasoline and snacks. It will never trend on social media. And yet it quietly made all-time highs while the broad market went nowhere for months. You know who was buying? Institutions. That's who."</blockquote>
        <p><strong>The Execution:</strong></p>
        <ul>
          <li>Old resistance at $498 is the new floor; our hard line in the sand sits below it at $465.</li>
          <li>Low realized volatility means we can carry a fuller position against a 9% stop with $585 and $680 as the upside objectives. Boring charts pay the bills.</li>
        </ul>
      `
    },

    // SLIDE 6: LIT/USD (Lighter)
    {
      id: "lit-post-tge-breakout",
      type: "chart",
      ticker: "LIT",
      name: "Lighter (LIT/USD)",
      title: "The Post-TGE Base Breakout",
      subtitle: "Lighter — zk-Rollup Perpetuals DEX Token Resolving Its Launch Base",
      setupPill: "Post-TGE Breakout",
      pillClass: "bullish",
      dwell: 32,
      metrics: [
        { label: "Current Price", value: "$3.42", class: "blue" },
        { label: "Line in Sand (Risk)", value: "$2.85", class: "red" },
        { label: "Target 1 (161.8%)", value: "$4.60", class: "green" },
        { label: "Target 2 (261.8%)", value: "$6.20", class: "green" }
      ],
      ruleTitle: "Post-Launch Bases Are Pure Price Discovery",
      ruleQuote: "After a token generation event, early hype sellers and airdrop flippers create the supply. Once that base absorbs them and price resolves above the opening range, there is zero overhead supply left. Every holder is in profit — that's rocket fuel.",
      tradeLevels: [
        { type: "risk", label: "Line in the Sand (Stop)", val: "$2.85 (-16.7%)" },
        { type: "pivot", label: "Launch Base Pivot", val: "$3.10" },
        { type: "target", label: "Target 1 (161.8% Fib)", val: "$4.60 (+34.5%)" },
        { type: "target", label: "Target 2 (261.8% Fib)", val: "$6.20 (+81.3%)" },
        { type: "risk", label: "Risk / Reward Ratio", val: "3.9 : 1 Asymmetric", customClass: "rr" }
      ],
      evidence: [
        "<strong>Launch Base Resolved:</strong> Post-TGE distribution range between $2.20–$3.10 absorbed for a full quarter, now breaking out on rising volume.",
        "<strong>Real Venue, Real Flow:</strong> Lighter's zk-rollup perp DEX consistently ranks among the top decentralized venues by volume — the token is backed by an actual machine.",
        "<strong>Zero Overhead Supply:</strong> Above the $3.10 pivot there is no trapped capital — classic price-discovery structure.",
        "<strong>Execution (Crypto Risk Applies):</strong> Crypto gets wider risk levels — a 17% stop is tight by digital-asset standards. Size accordingly: half weight vs equities. Long above $2.85, targeting $4.60 and $6.20."
      ],
      chartData: generateTechnicalSeries(2.05, 0.0042, 0.115, 220, 175, 34200, 3.42),
      fibLevels: [
        { label: "261.8% Fib Extension ($6.20)", price: 6.2, color: LEVEL_COLORS.targetFar },
        { label: "161.8% Fib Extension ($4.60)", price: 4.6, color: LEVEL_COLORS.targetNear },
        { label: "Launch Base Pivot ($3.10)", price: 3.1, color: LEVEL_COLORS.pivot },
        { label: "Line in the Sand ($2.85)", price: 2.85, color: LEVEL_COLORS.risk }
      ],
      riskLevel: 2.85,
      jcNotes: `
        <h5>JC's Charting Breakdown on LIT:</h5>
        <blockquote>"Lighter built one of the best zero-knowledge rollup perp DEXes in crypto — serious volume, serious throughput. But I don't trade the tech, I trade the chart. And this chart just broke out of its entire post-TGE base."</blockquote>
        <p><strong>The Crypto Caveats:</strong></p>
        <ul>
          <li><strong>Wider Levels:</strong> Crypto volatility demands wider risk levels. Our line in the sand is $2.85 — roughly 17% below spot — and that is a <em>tight</em> stop in this asset class.</li>
          <li><strong>Smaller Size:</strong> Position is half our standard equity weight. Above $2.85 we target $4.60, then $6.20 in full price discovery. Below $2.85 the base failed and we walk away.</li>
        </ul>
      `
    },

    // SLIDE 7: LIT vs BTC Relative Strength Ratio
    {
      id: "lit-btc-relative-strength",
      type: "chart",
      ticker: "LIT / BTC",
      name: "Lighter vs Bitcoin Ratio",
      title: "Crypto Leadership Gauge: LIT vs BTC",
      subtitle: "Relative Strength Ratio — Is Altcoin Risk Actually Working? (×100,000)",
      setupPill: "Relative Strength Leader",
      pillClass: "relative-strength",
      dwell: 26,
      metrics: [
        { label: "Ratio Trend", value: "BULLISH BREAKOUT", class: "green" },
        { label: "BTC Dominance", value: "ROLLING OVER", class: "gold" },
        { label: "Altcoin Leadership", value: "EXPANDING", class: "blue" },
        { label: "Crypto Regime", value: "OFFENSIVE", class: "green" }
      ],
      ruleTitle: "Relative Strength Precedes Absolute Returns",
      ruleQuote: "In crypto, the only question that matters is: are alts beating Bitcoin? When a high-quality alt like LIT breaks out versus BTC, the entire risk curve is healthy. When alts can't hold up against BTC, you own Bitcoin and nothing else.",
      tradeLevels: [
        { type: "risk", label: "Ratio Line in Sand", val: "2.95 (×10⁵)" },
        { type: "pivot", label: "Multi-Month Ratio Pivot", val: "3.15 (×10⁵)" },
        { type: "target", label: "Target 1 (161.8% Fib)", val: "4.20 (×10⁵)" },
        { type: "target", label: "Target 2 (261.8% Fib)", val: "5.40 (×10⁵)" },
        { type: "risk", label: "Significance", val: "Confirmed Altcoin Upside", customClass: "rr" }
      ],
      evidence: [
        "<strong>Ratio Breakout:</strong> LIT/BTC resolving a multi-month accumulation shelf — LIT is gaining on Bitcoin, not just riding it.",
        "<strong>Dominance Rollover:</strong> BTC dominance stalling at cycle resistance while perp-DEX tokens lead the alt complex higher.",
        "<strong>Confirmation, Not Prediction:</strong> We don't forecast altseason — the ratio tells us when alt risk is actually being paid for.",
        "<strong>Conclusion:</strong> While LIT/BTC holds above 2.95 (×10⁵), alt exposure is justified. Below it, we retreat to BTC and stable ground."
      ],
      // LIT/BTC ratio scaled ×100,000 for readability (3.42 / ~97,000 ≈ 3.53e-5).
      chartData: generateTechnicalSeries(2.62, 0.0032, 0.052, 220, 150, 35300, 3.53),
      fibLevels: [
        { label: "261.8% Extension (5.40 ×10⁵)", price: 5.4, color: LEVEL_COLORS.targetFar },
        { label: "161.8% Extension (4.20 ×10⁵)", price: 4.2, color: LEVEL_COLORS.targetNear },
        { label: "Breakout Ratio Pivot (3.15 ×10⁵)", price: 3.15, color: LEVEL_COLORS.pivot },
        { label: "Ratio Line in the Sand (2.95 ×10⁵)", price: 2.95, color: LEVEL_COLORS.risk }
      ],
      riskLevel: 2.95,
      jcNotes: `
        <h5>JC's Relative Strength Macro Note:</h5>
        <blockquote>"Everybody asks me: 'Is it altseason?' Wrong question. The right question is: 'Is this specific alt outperforming Bitcoin?' For Lighter, the answer on the chart is an emphatic yes."</blockquote>
        <p>This ratio is our compass for crypto risk. As long as LIT outperforms BTC, holding the token is justified on relative grounds alone. If the ratio loses 2.95 (×10⁵), the leadership thesis is wrong and we rotate back to BTC. Simple, mechanical, unemotional.</p>
      `
    },

    // SLIDE 8: Summary & Execution Cheat Sheet Table
    {
      id: "trade-matrix-table",
      type: "table",
      title: "JC's Technical Execution Matrix",
      subtitle: "The Master Cheat Sheet: Defined Risk, Fibonacci Targets & Asymmetric R/R",
      setupPill: "Actionable Trade Summary",
      pillClass: "bullish",
      dwell: 28,
      metrics: [
        { label: "Total Setups", value: "4 Equities + 2 Crypto", class: "blue" },
        { label: "Average R/R Ratio", value: "4.1 : 1", class: "green" },
        { label: "Max Allowed Risk", value: "< 17% (Crypto)", class: "red" },
        { label: "Execution Rule", value: "NO GUESSING", class: "gold" }
      ],
      matrixRows: [
        {
          ticker: "FN",
          name: "Fabrinet",
          setup: "Steady Compounder Shelf Breakout",
          bias: "CORE LONG",
          biasClass: "core",
          riskLevel: "$245.00",
          pivot: "$255.00",
          target1: "$315.00 (161.8%)",
          target2: "$380.00 (261.8%)",
          rr: "4.4 : 1",
          verdict: "Long above $245. Quiet trends are the best trends."
        },
        {
          ticker: "MEDP",
          name: "Medpace Holdings",
          setup: "Base-After-Correction at 200d SMA",
          bias: "CORE LONG",
          biasClass: "core",
          riskLevel: "$320.00",
          pivot: "$342.00",
          target1: "$420.00 (161.8%)",
          target2: "$505.00 (261.8%)",
          rr: "4.3 : 1",
          verdict: "Long above $320. Correction ended, base resolved."
        },
        {
          ticker: "CRDO",
          name: "Credo Technology",
          setup: "High-Beta AI-Infra Flag Ignition",
          bias: "CORE LONG",
          biasClass: "core",
          riskLevel: "$54.00",
          pivot: "$58.50",
          target1: "$82.00 (161.8%)",
          target2: "$110.00 (261.8%)",
          rr: "4.1 : 1",
          verdict: "Half size. Long above $54. Compression → expansion."
        },
        {
          ticker: "MUSA",
          name: "Murphy USA",
          setup: "Quiet RS Leader, Polarity Flip",
          bias: "CORE LONG",
          biasClass: "core",
          riskLevel: "$465.00",
          pivot: "$498.00",
          target1: "$585.00 (161.8%)",
          target2: "$680.00 (261.8%)",
          rr: "3.6 : 1",
          verdict: "Full size. Long above $465. Stealth institutional bid."
        },
        {
          ticker: "LIT",
          name: "Lighter (LIT/USD)",
          setup: "Post-TGE Base Breakout",
          bias: "SATELLITE",
          biasClass: "alt",
          riskLevel: "$2.85",
          pivot: "$3.10",
          target1: "$4.60 (161.8%)",
          target2: "$6.20 (261.8%)",
          rr: "3.9 : 1",
          verdict: "Half size — crypto risk levels are wider. Long above $2.85."
        },
        {
          ticker: "LIT/BTC",
          name: "Lighter vs Bitcoin",
          setup: "Crypto Relative Strength Leadership",
          bias: "GAUGE",
          biasClass: "alt",
          riskLevel: "2.95 (×10⁵)",
          pivot: "3.15 (×10⁵)",
          target1: "4.20 (×10⁵)",
          target2: "5.40 (×10⁵)",
          rr: "Crypto Compass",
          verdict: "Holds alt exposure valid while above 2.95 (×10⁵)."
        }
      ],
      jcNotes: `
        <h5>JC's Final Execution Rules:</h5>
        <blockquote>"Remember the golden rule of trading: It is not about being right or wrong. It is about how much you make when you are right, and how little you lose when you are wrong."</blockquote>
        <ol>
          <li><strong>Respect the Line in the Sand:</strong> If any position falls below its risk level, sell it. No hoping, no rationalizing.</li>
          <li><strong>Size To The Asset Class:</strong> Equities get standard weight; high-beta names like CRDO and crypto like LIT get half weight because their lines in the sand are wider.</li>
          <li><strong>Take Profits at Fibonacci Targets:</strong> Trim 1/3 at Target 1 (161.8%), move stops to breakeven, and let the rest run to Target 2 (261.8%).</li>
          <li><strong>Let the Weight of the Evidence Guide You:</strong> As long as market internals and the LIT/BTC ratio stay bullish, keep pressing the winners.</li>
        </ol>
      `
    }
  ]
};

/* ==========================================================================
   SYMBOL_LIBRARY — deterministic, seeded, fully offline symbol data.
   Map of ticker -> lazily generated series ({ ticker, name, data }).
   Series are produced by generateTechnicalSeries (mulberry32-seeded,
   pinned closes) with SMA50/SMA200/RSI/RS-ratio attached via
   attachIndicators. Generation happens on first access and is cached,
   so first paint stays fast. No fetch/XHR — data is always available.
   Crypto symbols (LIT/BTC/ETH/SOL) carry crypto-appropriate volatility.
   ========================================================================== */
const SYMBOL_DEFS = [
  // params: [startPrice, trendSlope, volatility, points, breakoutIdx, seed, pinClose]
  { ticker: "FN",   name: "Fabrinet",            params: [218, 0.16, 2.4, 220, 168, 26240, 262.4] },
  { ticker: "MEDP", name: "Medpace Holdings",    params: [308, 0.11, 4.2, 220, 170, 34863, 348.6] },
  { ticker: "CRDO", name: "Credo Technology",    params: [34, 0.13, 1.6, 220, 165, 6480, 64.8] },
  { ticker: "MUSA", name: "Murphy USA",          params: [438, 0.24, 4.4, 220, 158, 51230, 512.3] },
  { ticker: "LIT",  name: "Lighter (LIT/USD)",   params: [2.05, 0.0042, 0.115, 220, 175, 34200, 3.42] },
  { ticker: "BTC",  name: "Bitcoin USD",         params: [72000, 130, 2100, 220, 160, 97450, 97450] },
  { ticker: "ETH",  name: "Ethereum USD",        params: [2650, 4.2, 95, 220, 155, 34210, 3421] },
  { ticker: "SOL",  name: "Solana USD",          params: [168, 0.22, 6.5, 220, 150, 21450, 214.5] },
  { ticker: "SPY",  name: "S&P 500 ETF",         params: [480, 0.35, 2.4, 220, 170, 58200, 582.4] },
  { ticker: "QQQ",  name: "Nasdaq 100 ETF",      params: [420, 0.42, 2.9, 220, 165, 50125, 501.3] },
  { ticker: "IWM",  name: "Russell 2000 ETF",    params: [195, 0.09, 1.5, 220, 150, 20875, 208.7] },
  { ticker: "GLD",  name: "Gold ETF",            params: [205, 0.14, 1.1, 220, 152, 24180, 241.8] }
];

const SYMBOL_LIBRARY = (() => {
  const lib = {};
  const cache = {};
  SYMBOL_DEFS.forEach((def) => {
    Object.defineProperty(lib, def.ticker, {
      enumerable: true,
      get() {
        if (!cache[def.ticker]) {
          cache[def.ticker] = {
            ticker: def.ticker,
            name: def.name,
            data: generateTechnicalSeries.apply(null, def.params)
          };
        }
        return cache[def.ticker];
      }
    });
  });
  // Non-enumerable helpers so Object.keys(SYMBOL_LIBRARY) === tickers.
  Object.defineProperty(lib, "has", {
    enumerable: false,
    value: (t) => Object.prototype.hasOwnProperty.call(lib, t)
  });
  Object.defineProperty(lib, "tickers", {
    enumerable: false,
    get: () => SYMBOL_DEFS.map((d) => d.ticker)
  });
  return lib;
})();
