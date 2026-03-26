/**
 * Hero / landing page for Shipyard Agent.
 *
 * Uses the same animation patterns as the FleetGraph reference:
 * blur-in text, shiny-text shimmer, spotlight cards, particles canvas,
 * count-up stats, scroll reveal, star-border, glare-hover.
 */

import type { RequestHandler } from 'express';

export function heroHandler(): RequestHandler {
  return (_req, res) => {
    res.type('html').send(PAGE_HTML);
  };
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shipyard Agent</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

  :root {
    --bg: #060a12;
    --bg2: #0a0e17;
    --card: #111827;
    --card-hover: #1a2035;
    --border: #2a3250;
    --border-active: #3a4570;
    --text: #e2e8f0;
    --text-muted: #6b7a90;
    --text-dim: #4a5568;
    --accent: #818cf8;
    --accent-glow: rgba(129, 140, 248, 0.15);
    --accent-strong: #6366f1;
    --green: #10b981;
    --green-dim: rgba(16, 185, 129, 0.12);
    --yellow: #f59e0b;
    --yellow-dim: rgba(245, 158, 11, 0.12);
    --red: #ef4444;
    --red-dim: rgba(239, 68, 68, 0.12);
    --cyan: #22d3ee;
    --cyan-dim: rgba(34, 211, 238, 0.12);
    --purple: #a78bfa;
    --purple-dim: rgba(167, 139, 250, 0.12);
    --orange: #fb923c;
    --orange-dim: rgba(251, 146, 60, 0.12);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; }

  body {
    font-family: 'Space Grotesk', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }

  .mono { font-family: 'JetBrains Mono', monospace; }

  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* ===== BlurText animation ===== */
  .blur-in {
    opacity: 0;
    filter: blur(12px);
    transform: translateY(20px);
    animation: blurTextIn 0.8s ease-out forwards;
  }
  .blur-in-delay-1 { animation-delay: 0.15s; }
  .blur-in-delay-2 { animation-delay: 0.3s; }
  .blur-in-delay-3 { animation-delay: 0.45s; }
  .blur-in-delay-4 { animation-delay: 0.6s; }
  .blur-in-delay-5 { animation-delay: 0.75s; }

  @keyframes blurTextIn {
    0% { opacity: 0; filter: blur(12px); transform: translateY(20px); }
    50% { opacity: 0.6; filter: blur(4px); transform: translateY(4px); }
    100% { opacity: 1; filter: blur(0px); transform: translateY(0); }
  }

  /* ===== ShinyText shimmer ===== */
  .shiny-text {
    background-image: linear-gradient(
      120deg,
      var(--accent) 0%, var(--accent) 35%,
      #fff 50%,
      var(--accent) 65%, var(--accent) 100%
    );
    background-size: 200% auto;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shinyTextSweep 3s linear infinite;
  }
  @keyframes shinyTextSweep {
    0% { background-position: 150% center; }
    100% { background-position: -50% center; }
  }

  /* ===== ScrollReveal ===== */
  .reveal {
    opacity: 0;
    transform: translateY(32px);
    transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.7s cubic-bezier(0.16, 1, 0.3, 1),
                filter 0.7s cubic-bezier(0.16, 1, 0.3, 1);
    filter: blur(4px);
  }
  .reveal.visible {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0px);
  }
  .stagger-children .reveal { transition-delay: calc(var(--stagger, 0) * 80ms); }

  /* ===== SpotlightCard ===== */
  .spotlight-card {
    position: relative;
    overflow: hidden;
    --mouse-x: 50%;
    --mouse-y: 50%;
    --spotlight-color: rgba(129, 140, 248, 0.08);
  }
  .spotlight-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: radial-gradient(
      600px circle at var(--mouse-x) var(--mouse-y),
      var(--spotlight-color),
      transparent 40%
    );
    opacity: 0;
    transition: opacity 0.4s ease;
    pointer-events: none;
    z-index: 1;
  }
  .spotlight-card:hover::before { opacity: 1; }
  .spotlight-card > * { position: relative; z-index: 2; }

  /* ===== StarBorder (animated conic gradient border) ===== */
  .star-border {
    position: relative;
    border: none !important;
    background: var(--card);
    overflow: visible;
  }
  .star-border::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: conic-gradient(
      from var(--star-angle, 0deg),
      transparent 0%,
      var(--accent) 10%,
      transparent 20%,
      transparent 50%,
      var(--cyan) 60%,
      transparent 70%
    );
    z-index: -1;
    animation: starBorderSpin 4s linear infinite;
  }
  .star-border::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: inherit;
    background: var(--card);
    z-index: -1;
  }
  @keyframes starBorderSpin {
    0% { --star-angle: 0deg; }
    100% { --star-angle: 360deg; }
  }
  @property --star-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  /* ===== GlareHover ===== */
  .glare-hover {
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }
  .glare-hover:hover {
    transform: translateY(-4px) scale(1.01);
    box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px var(--border-active);
  }

  /* ===== CountUp ===== */
  .count-up { font-variant-numeric: tabular-nums; }

  /* ===== Particle Canvas ===== */
  #particles-canvas {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }

  /* ===== Pulse dot ===== */
  .pulse-dot {
    animation: pulseDot 2s ease-in-out infinite;
  }
  @keyframes pulseDot {
    0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
    50% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  }

  /* ===== Nav ===== */
  nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 100;
    padding: 0 40px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(6, 10, 18, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .nav-brand {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--text);
  }
  .nav-brand .brand-accent { color: var(--accent); }
  .nav-links { display: flex; align-items: center; gap: 16px; }
  .nav-link {
    padding: 8px 14px;
    font-size: 13px;
    color: var(--text-muted);
    text-decoration: none;
    font-family: 'JetBrains Mono', monospace;
    transition: color 0.2s;
  }
  .nav-link:hover { color: var(--text); }
  .nav-cta {
    padding: 8px 24px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: transparent;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    text-decoration: none;
    font-family: 'Space Grotesk', sans-serif;
  }
  .nav-cta:hover {
    background: var(--accent);
    color: var(--bg);
    box-shadow: 0 0 24px var(--accent-glow);
  }

  /* ===== Hero ===== */
  .hero {
    position: relative;
    padding: 160px 40px 80px;
    text-align: center;
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }
  .hero > * { position: relative; z-index: 1; }
  .hero::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 120px;
    background: linear-gradient(to top, var(--bg), transparent);
    z-index: 1;
    pointer-events: none;
  }
  .hero-badge {
    display: inline-block;
    padding: 6px 16px;
    border: 1px solid var(--accent);
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  .hero h1 {
    font-size: 72px;
    font-weight: 800;
    letter-spacing: -3px;
    line-height: 1.05;
    margin-bottom: 20px;
  }
  .hero h1 .accent { color: var(--accent); }
  .hero .hero-sub {
    font-size: 19px;
    color: var(--text-muted);
    max-width: 640px;
    margin: 0 auto 40px;
    line-height: 1.7;
  }
  .hero-cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 14px 36px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--bg);
    font-size: 16px;
    font-weight: 700;
    text-decoration: none;
    transition: all 0.2s;
    box-shadow: 0 4px 24px var(--accent-glow);
    margin-bottom: 48px;
  }
  .hero-cta:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 40px rgba(129, 140, 248, 0.3);
  }
  .hero-stats {
    display: flex;
    justify-content: center;
    gap: 56px;
    margin-top: 12px;
  }
  .hero-stat .num {
    font-size: 42px;
    font-weight: 700;
    color: var(--text);
    font-family: 'JetBrains Mono', monospace;
  }
  .hero-stat .label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin-top: 4px;
  }

  /* ===== Sections ===== */
  section { padding: 80px 40px; max-width: 1200px; margin: 0 auto; }
  .section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }
  section > h2 {
    font-size: 36px;
    font-weight: 700;
    letter-spacing: -1.5px;
    margin-bottom: 12px;
  }
  section > .subtitle {
    font-size: 16px;
    color: var(--text-muted);
    margin-bottom: 48px;
    max-width: 700px;
    line-height: 1.7;
  }

  /* ===== Pipeline ===== */
  .pipeline-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 16px;
  }
  .pipeline-card {
    padding: 28px 20px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--card);
    text-align: center;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .pipeline-card:hover {
    background: var(--card-hover);
    border-color: var(--border-active);
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  }
  .pipeline-num {
    width: 40px; height: 40px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    margin-bottom: 14px;
  }
  .pipeline-name {
    font-size: 15px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    margin-bottom: 6px;
  }
  .pipeline-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.6;
  }
  .pipeline-model {
    margin-top: 10px;
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--text-dim);
    letter-spacing: 0.5px;
  }

  /* ===== Features ===== */
  .features-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }
  .feature-card {
    padding: 32px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--card);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .feature-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 10px; }
  .feature-card p { font-size: 14px; color: var(--text-muted); line-height: 1.7; }
  .feature-icon {
    width: 40px; height: 40px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    margin-bottom: 16px;
  }

  /* ===== Stack ===== */
  .stack-row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 20px; }
  .stack-chip {
    padding: 10px 18px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card);
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    color: var(--text-muted);
    transition: all 0.2s;
  }
  .stack-chip:hover { border-color: var(--border-active); background: var(--card-hover); }
  .stack-chip .hl { color: var(--text); }

  /* ===== Architecture ===== */
  .arch-card {
    display: grid;
    grid-template-columns: 200px 1fr 200px;
    gap: 24px;
    align-items: center;
    padding: 36px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--card);
  }
  .arch-col { display: flex; flex-direction: column; gap: 12px; }
  .arch-box {
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
    font-size: 12px;
    text-align: center;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    transition: transform 0.2s;
  }
  .arch-box:hover { transform: scale(1.03); }
  .arch-box.input { background: var(--accent-glow); border-color: rgba(129,140,248,0.3); color: var(--accent); }
  .arch-box.output { background: var(--green-dim); border-color: rgba(16,185,129,0.3); color: var(--green); }
  .arch-center {
    text-align: center;
    padding: 40px 32px;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--accent-glow), transparent);
  }
  .arch-center h3 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
  .arch-center p { font-size: 12px; color: var(--text-muted); line-height: 1.6; }

  /* ===== Footer ===== */
  footer {
    padding: 60px 40px;
    text-align: center;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 14px;
  }
  footer strong { color: var(--accent); }

  .sep { border: none; border-top: 1px solid var(--border); margin: 0; }

  /* ===== Responsive ===== */
  @media (max-width: 900px) {
    .pipeline-grid { grid-template-columns: repeat(2, 1fr); }
    .features-grid { grid-template-columns: 1fr; }
    .arch-card { grid-template-columns: 1fr; }
    .hero h1 { font-size: 44px; letter-spacing: -2px; }
    .hero-stats { flex-wrap: wrap; gap: 24px; }
    nav { padding: 0 20px; }
    section { padding: 60px 20px; }
    .hero { padding: 140px 20px 60px; }
  }
  @media (max-width: 600px) {
    .pipeline-grid { grid-template-columns: 1fr; }
    .hero-stats { gap: 16px; }
    .hero h1 { font-size: 36px; }
    .nav-link { display: none; }
  }
</style>
</head>
<body>

<!-- NAV -->
<nav>
  <div class="nav-brand">Shipyard <span class="brand-accent">/</span> Agent</div>
  <div class="nav-links">
    <a href="/runs" class="nav-link">Runs</a>
    <a href="/benchmarks" class="nav-link">Benchmarks</a>
    <a href="/dashboard" class="nav-cta" aria-label="Open Dashboard">Dashboard</a>
  </div>
</nav>

<!-- HERO -->
<div class="hero">
  <canvas id="particles-canvas"></canvas>
  <div class="hero-badge shiny-text blur-in">Autonomous Code Agent</div>
  <h1>
    <span class="blur-in blur-in-delay-1">Shipyard</span><br>
    <span class="blur-in blur-in-delay-2 accent">Agent</span>
  </h1>
  <p class="hero-sub blur-in blur-in-delay-3">
    Plan, execute, verify, and review code changes autonomously.
    LangGraph-powered multi-phase pipeline with human-in-the-loop oversight.
  </p>
  <a href="/dashboard" class="hero-cta blur-in blur-in-delay-4">Open Workspace &#8594;</a>
  <div class="hero-stats blur-in blur-in-delay-5">
    <div class="hero-stat">
      <div class="num count-up" data-target="5">0</div>
      <div class="label">Graph Phases</div>
    </div>
    <div class="hero-stat">
      <div class="num count-up" data-target="8">0</div>
      <div class="label">Tool Actions</div>
    </div>
    <div class="hero-stat">
      <div class="num count-up" data-target="3">0</div>
      <div class="label">AI Models</div>
    </div>
    <div class="hero-stat">
      <div class="num count-up" data-target="4">0</div>
      <div class="label">Run Modes</div>
    </div>
  </div>
</div>

<hr class="sep">

<!-- PIPELINE -->
<section>
  <div class="section-label shiny-text reveal">LangGraph Pipeline</div>
  <h2 class="reveal">Five-Phase Execution</h2>
  <p class="subtitle reveal">
    Every instruction flows through a deterministic graph. Each phase has its own model, tools, and validation gates.
  </p>

  <div class="pipeline-grid stagger-children">
    <div class="pipeline-card spotlight-card glare-hover reveal" style="--stagger:0;--spotlight-color:rgba(129,140,248,0.08)">
      <div class="pipeline-num" style="background:var(--accent-glow);color:var(--accent)">1</div>
      <div class="pipeline-name">Plan</div>
      <div class="pipeline-desc">Reads codebase, generates step-by-step execution plan with file targets</div>
      <div class="pipeline-model">GPT-5.3 Codex</div>
    </div>
    <div class="pipeline-card spotlight-card glare-hover reveal" style="--stagger:1;--spotlight-color:rgba(16,185,129,0.08)">
      <div class="pipeline-num" style="background:var(--green-dim);color:var(--green)">2</div>
      <div class="pipeline-name">Execute</div>
      <div class="pipeline-desc">Applies edits, creates files, runs tools against the working directory</div>
      <div class="pipeline-model">GPT-5.4 Mini</div>
    </div>
    <div class="pipeline-card spotlight-card glare-hover reveal" style="--stagger:2;--spotlight-color:rgba(34,211,238,0.08)">
      <div class="pipeline-num" style="background:var(--cyan-dim);color:var(--cyan)">3</div>
      <div class="pipeline-name">Verify</div>
      <div class="pipeline-desc">Runs typecheck, tests, lint. Captures stdout/stderr for review</div>
      <div class="pipeline-model">bash</div>
    </div>
    <div class="pipeline-card spotlight-card glare-hover reveal" style="--stagger:3;--spotlight-color:rgba(245,158,11,0.08)">
      <div class="pipeline-num" style="background:var(--yellow-dim);color:var(--yellow)">4</div>
      <div class="pipeline-name">Review</div>
      <div class="pipeline-desc">Evaluates diffs and verification output, decides: accept, retry, or escalate</div>
      <div class="pipeline-model">GPT-5.3 Codex</div>
    </div>
    <div class="pipeline-card spotlight-card glare-hover reveal" style="--stagger:4;--spotlight-color:rgba(167,139,250,0.08)">
      <div class="pipeline-num" style="background:var(--purple-dim);color:var(--purple)">5</div>
      <div class="pipeline-name">Report</div>
      <div class="pipeline-desc">Generates human-readable summary of all changes and verification results</div>
      <div class="pipeline-model">GPT-5.4 Mini</div>
    </div>
  </div>
</section>

<hr class="sep">

<!-- FEATURES -->
<section>
  <div class="section-label shiny-text reveal">Capabilities</div>
  <h2 class="reveal">Built for Real Codebases</h2>
  <p class="subtitle reveal">
    Not a toy. Shipyard Agent handles multi-file edits, test suites, type systems, and CI gates.
  </p>

  <div class="features-grid stagger-children">
    <div class="feature-card spotlight-card glare-hover reveal" style="--stagger:0;--spotlight-color:rgba(129,140,248,0.06)">
      <div class="feature-icon" style="background:var(--accent-glow);color:var(--accent)">&#9881;</div>
      <h3>Live Edit Feed</h3>
      <p>Watch file edits stream in real-time as the agent works. Every tool call, every diff, visible in the dashboard as it happens.</p>
    </div>
    <div class="feature-card spotlight-card glare-hover reveal" style="--stagger:1;--spotlight-color:rgba(16,185,129,0.06)">
      <div class="feature-icon" style="background:var(--green-dim);color:var(--green)">&#10003;</div>
      <h3>Plan-then-Confirm</h3>
      <p>Review the agent's plan before any code is touched. Approve, modify, or reject. Like Cursor's plan review, built into the pipeline.</p>
    </div>
    <div class="feature-card spotlight-card glare-hover reveal" style="--stagger:2;--spotlight-color:rgba(245,158,11,0.06)">
      <div class="feature-icon" style="background:var(--yellow-dim);color:var(--yellow)">&#9733;</div>
      <h3>Model Flexibility</h3>
      <p>Switch between GPT-5.4 Mini for fast edits and GPT-5.1/5.3 Codex for deeper reasoning. Per-run model selection.</p>
    </div>
    <div class="feature-card spotlight-card star-border glare-hover reveal" style="--stagger:3;border-radius:16px;--spotlight-color:rgba(34,211,238,0.06)">
      <div class="feature-icon" style="background:var(--cyan-dim);color:var(--cyan)">&#9878;</div>
      <h3>Benchmark Tracking</h3>
      <p>Capture snapshots of type safety, test health, security, build speed, and more. Compare original vs refactored codebases with radar + trend charts.</p>
    </div>
  </div>
</section>

<hr class="sep">

<!-- ARCHITECTURE -->
<section>
  <div class="section-label shiny-text reveal">Architecture</div>
  <h2 class="reveal">How It Fits Together</h2>
  <p class="subtitle reveal">
    A TypeScript runtime with Express API, WebSocket streaming, and Postgres persistence. The graph engine is LangGraph.
  </p>

  <div class="arch-card spotlight-card reveal" style="--spotlight-color:rgba(129,140,248,0.04)">
    <div class="arch-col">
      <div class="arch-box input">Dashboard UI</div>
      <div class="arch-box input">REST API</div>
      <div class="arch-box input">WebSocket</div>
    </div>
    <div class="arch-center">
      <h3>Shipyard Agent</h3>
      <p>LangGraph state machine with plan, execute, verify, review, report nodes. Repo map context, tool hooks, and persistence layer.</p>
    </div>
    <div class="arch-col">
      <div class="arch-box output">File Edits</div>
      <div class="arch-box output">Verification</div>
      <div class="arch-box output">Reports</div>
    </div>
  </div>

  <div class="stack-row reveal" style="margin-top:32px">
    <div class="stack-chip"><span class="hl">TypeScript</span> runtime</div>
    <div class="stack-chip"><span class="hl">LangGraph</span> state machine</div>
    <div class="stack-chip"><span class="hl">OpenAI</span> GPT-5</div>
    <div class="stack-chip"><span class="hl">Express</span> + WebSocket</div>
    <div class="stack-chip"><span class="hl">PostgreSQL</span> persistence</div>
    <div class="stack-chip"><span class="hl">Vitest</span> + typecheck</div>
  </div>
</section>

<hr class="sep">

<!-- FOOTER -->
<footer>
  <p class="reveal" style="font-size:18px;color:var(--text-muted);max-width:700px;margin:0 auto;line-height:1.7;">
    <strong>Shipyard Agent</strong> is an autonomous code agent that plans, edits, verifies, and reports on code changes with full transparency and human oversight.
  </p>
  <br>
  <p class="reveal" style="font-size:11px;font-family:'JetBrains Mono',monospace;">
    LangGraph + OpenAI GPT-5 &middot; TypeScript &middot; PostgreSQL &middot; WebSocket streaming
  </p>
  <br>
  <a href="/dashboard" class="nav-cta reveal" style="display:inline-block">Open Dashboard &#8594;</a>
</footer>

<!-- ===== SCRIPTS ===== -->
<script>
// Particles Background
(function() {
  var canvas = document.getElementById('particles-canvas');
  var ctx = canvas.getContext('2d');
  var hero = canvas.parentElement;
  var particles = [];
  var PARTICLE_COUNT = 60;
  var MAX_DIST = 120;

  function resize() {
    canvas.width = hero.offsetWidth;
    canvas.height = hero.offsetHeight;
  }

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.3 + 0.1
    };
  }

  function init() {
    resize();
    particles = [];
    for (var i = 0; i < PARTICLE_COUNT; i++) particles.push(createParticle());
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < particles.length; i++) {
      for (var j = i + 1; j < particles.length; j++) {
        var dx = particles[i].x - particles[j].x;
        var dy = particles[i].y - particles[j].y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          var alpha = (1 - dist / MAX_DIST) * 0.08;
          ctx.strokeStyle = 'rgba(129, 140, 248, ' + alpha + ')';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    for (var k = 0; k < particles.length; k++) {
      var p = particles[k];
      ctx.fillStyle = 'rgba(129, 140, 248, ' + p.opacity + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  init();
  draw();
})();

// CountUp
(function() {
  var counters = document.querySelectorAll('.count-up');
  var duration = 1200;

  function animateCount(el) {
    var target = parseInt(el.dataset.target, 10);
    var start = performance.now();
    function step(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(function(el) { observer.observe(el); });
})();

// ScrollReveal
(function() {
  var reveals = document.querySelectorAll('.reveal');
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  reveals.forEach(function(el) { observer.observe(el); });
})();

// SpotlightCard
(function() {
  document.querySelectorAll('.spotlight-card').forEach(function(card) {
    card.addEventListener('mousemove', function(e) {
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--mouse-y', (e.clientY - rect.top) + 'px');
    });
  });
})();
</script>

</body>
</html>`;
