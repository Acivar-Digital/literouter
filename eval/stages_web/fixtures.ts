/**
 * eval/stages_web/fixtures.ts
 *
 * Sample UI mockup fixtures in base64 data URI format (SVG) representing:
 * 1. SaaS Dashboard with 3-column grid, sidebar, and navbar
 * 2. Pricing table with 4 tiers
 * 3. Auth modal with error state
 */

export interface FixtureMockup {
  id: string;
  name: string;
  description: string;
  dataUri: string;
  svg: string;
}

/**
 * 1. SaaS Dashboard:
 * - Top navbar with logo, search bar, profile avatar
 * - Left sidebar with navigation links
 * - 3-column grid main content area with analytic metric cards and charts
 */
export const SAAS_DASHBOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <defs>
    <style>
      .bg { fill: #0f172a; }
      .nav { fill: #1e293b; }
      .sidebar { fill: #1e293b; stroke: #334155; }
      .card { fill: #1e293b; rx: 8px; stroke: #334155; }
      .accent { fill: #38bdf8; }
      .text-primary { fill: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
      .text-muted { fill: #94a3b8; font-family: system-ui, -apple-system, sans-serif; }
      .badge { fill: #0284c7; }
    </style>
  </defs>
  <!-- Background -->
  <rect width="1200" height="800" class="bg"/>

  <!-- Top Navbar -->
  <rect width="1200" height="64" class="nav"/>
  <circle cx="40" cy="32" r="16" fill="#38bdf8"/>
  <text x="70" y="38" class="text-primary" font-size="18" font-weight="bold">CloudMetrics SaaS</text>
  <!-- Navbar search bar -->
  <rect x="300" y="16" width="360" height="32" rx="6" fill="#334155"/>
  <text x="315" y="37" class="text-muted" font-size="13">Search projects, deployments, metrics...</text>
  <!-- User Profile & Notifications -->
  <circle cx="1140" cy="32" r="18" fill="#475569"/>
  <circle cx="1090" cy="32" r="12" fill="#334155"/>

  <!-- Left Sidebar -->
  <rect x="0" y="64" width="220" height="736" class="sidebar"/>
  <rect x="12" y="80" width="196" height="36" rx="6" fill="#0284c7" fill-opacity="0.2"/>
  <text x="44" y="103" class="accent" font-size="14" font-weight="600">📊 Overview</text>
  <text x="44" y="145" class="text-muted" font-size="14">⚡ Analytics</text>
  <text x="44" y="185" class="text-muted" font-size="14">👥 Customers</text>
  <text x="44" y="225" class="text-muted" font-size="14">⚙️ Settings</text>
  <text x="44" y="265" class="text-muted" font-size="14">📑 Invoices</text>

  <!-- Main Content: Header -->
  <text x="250" y="105" class="text-primary" font-size="24" font-weight="bold">Dashboard Analytics</text>
  <text x="250" y="128" class="text-muted" font-size="14">Real-time telemetry and resource consumption</text>

  <!-- 3-Column Grid for Metrics -->
  <!-- Column 1 -->
  <rect x="250" y="150" width="280" height="130" class="card"/>
  <text x="270" y="180" class="text-muted" font-size="14">Monthly Recurring Revenue</text>
  <text x="270" y="225" class="text-primary" font-size="28" font-weight="bold">$124,500</text>
  <text x="270" y="255" class="accent" font-size="12">▲ +14.2% from last month</text>

  <!-- Column 2 -->
  <rect x="560" y="150" width="280" height="130" class="card"/>
  <text x="580" y="180" class="text-muted" font-size="14">Active Subscriptions</text>
  <text x="580" y="225" class="text-primary" font-size="28" font-weight="bold">3,842</text>
  <text x="580" y="255" class="accent" font-size="12">▲ +8.1% new signups</text>

  <!-- Column 3 -->
  <rect x="870" y="150" width="280" height="130" class="card"/>
  <text x="890" y="180" class="text-muted" font-size="14">System Uptime</text>
  <text x="890" y="225" class="text-primary" font-size="28" font-weight="bold">99.98%</text>
  <text x="890" y="255" fill="#4ade80" font-family="system-ui" font-size="12">● All systems operational</text>

  <!-- Large Graph / Data Grid Area -->
  <rect x="250" y="310" width="590" height="440" class="card"/>
  <text x="270" y="345" class="text-primary" font-size="18" font-weight="600">Throughput &amp; Latency Trends</text>
  <path d="M 280 650 Q 380 500 480 580 T 680 430 T 800 390" fill="none" stroke="#38bdf8" stroke-width="3"/>
  <path d="M 280 680 Q 380 620 480 610 T 680 540 T 800 490" fill="none" stroke="#a855f7" stroke-width="2" stroke-dasharray="4"/>

  <!-- Right Activity Sidebar / 3rd column card -->
  <rect x="870" y="310" width="280" height="440" class="card"/>
  <text x="890" y="345" class="text-primary" font-size="18" font-weight="600">Recent Activity</text>
  <circle cx="905" cy="385" r="5" fill="#38bdf8"/>
  <text x="925" y="390" class="text-muted" font-size="13">Deploy #8491 to production</text>
  <circle cx="905" cy="425" r="5" fill="#4ade80"/>
  <text x="925" y="430" class="text-muted" font-size="13">User invitation accepted</text>
  <circle cx="905" cy="465" r="5" fill="#fbbf24"/>
  <text x="925" y="470" class="text-muted" font-size="13">API Rate limit warning: 85%</text>
</svg>`.trim();

/**
 * 2. Pricing Table with 4 Tiers:
 * - Free / Starter
 * - Pro / Growth
 * - Business / Enterprise
 * - Dedicated / Custom
 */
export const PRICING_TABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700" width="1200" height="700">
  <defs>
    <style>
      .bg { fill: #0a0e1a; }
      .card { fill: #131b2e; stroke: #23314e; stroke-width: 1.5; rx: 12px; }
      .card-popular { fill: #18223c; stroke: #3b82f6; stroke-width: 2.5; rx: 12px; }
      .text-title { fill: #f1f5f9; font-family: system-ui, -apple-system, sans-serif; }
      .text-sub { fill: #94a3b8; font-family: system-ui, -apple-system, sans-serif; }
      .price { fill: #ffffff; font-family: system-ui, -apple-system, sans-serif; font-weight: bold; }
      .btn { fill: #334155; rx: 6px; }
      .btn-primary { fill: #2563eb; rx: 6px; }
      .btn-text { fill: #ffffff; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 600; text-anchor: middle; }
      .badge { fill: #2563eb; rx: 4px; }
    </style>
  </defs>
  <rect width="1200" height="700" class="bg"/>

  <text x="600" y="70" class="text-title" font-size="32" font-weight="bold" text-anchor="middle">Transparent, Predictable Pricing</text>
  <text x="600" y="102" class="text-sub" font-size="16" text-anchor="middle">Scale effortlessly from side-project to enterprise workloads</text>

  <!-- Tier 1: Starter -->
  <rect x="50" y="150" width="250" height="480" class="card"/>
  <text x="80" y="195" class="text-title" font-size="20" font-weight="bold">Hobby</text>
  <text x="80" y="220" class="text-sub" font-size="13">For experiments &amp; solo developers</text>
  <text x="80" y="275" class="price" font-size="36">$0</text>
  <text x="135" y="275" class="text-sub" font-size="14">/ mo</text>
  <rect x="80" y="300" width="190" height="42" class="btn"/>
  <text x="175" y="326" class="btn-text">Get Started</text>
  <text x="80" y="380" class="text-sub" font-size="13">✓ 5,000 monthly requests</text>
  <text x="80" y="415" class="text-sub" font-size="13">✓ 1 seat included</text>
  <text x="80" y="450" class="text-sub" font-size="13">✓ Community support</text>
  <text x="80" y="485" class="text-sub" font-size="13">✗ Custom domains</text>

  <!-- Tier 2: Pro (Highlighted) -->
  <rect x="330" y="130" width="260" height="520" class="card-popular"/>
  <rect x="400" y="115" width="120" height="24" class="badge"/>
  <text x="460" y="131" fill="#ffffff" font-family="system-ui" font-size="11" font-weight="bold" text-anchor="middle">MOST POPULAR</text>
  <text x="360" y="185" class="text-title" font-size="20" font-weight="bold">Pro</text>
  <text x="360" y="210" class="text-sub" font-size="13">For rapidly growing startups</text>
  <text x="360" y="265" class="price" font-size="36">$49</text>
  <text x="430" y="265" class="text-sub" font-size="14">/ mo</text>
  <rect x="360" y="290" width="200" height="42" class="btn-primary"/>
  <text x="460" y="316" class="btn-text">Start 14-day Trial</text>
  <text x="360" y="370" class="text-title" font-size="13">✓ 500,000 monthly requests</text>
  <text x="360" y="405" class="text-title" font-size="13">✓ Up to 10 seats</text>
  <text x="360" y="440" class="text-title" font-size="13">✓ Priority 24/7 support</text>
  <text x="360" y="475" class="text-title" font-size="13">✓ Custom domains &amp; SSL</text>
  <text x="360" y="510" class="text-title" font-size="13">✓ 99.9% Uptime SLA</text>

  <!-- Tier 3: Business -->
  <rect x="620" y="150" width="250" height="480" class="card"/>
  <text x="650" y="195" class="text-title" font-size="20" font-weight="bold">Business</text>
  <text x="650" y="220" class="text-sub" font-size="13">For scaling businesses &amp; teams</text>
  <text x="650" y="275" class="price" font-size="36">$199</text>
  <text x="740" y="275" class="text-sub" font-size="14">/ mo</text>
  <rect x="650" y="300" width="190" height="42" class="btn"/>
  <text x="745" y="326" class="btn-text">Upgrade to Business</text>
  <text x="650" y="380" class="text-sub" font-size="13">✓ 5,000,000 requests</text>
  <text x="650" y="415" class="text-sub" font-size="13">✓ Unlimited seats</text>
  <text x="650" y="450" class="text-sub" font-size="13">✓ Dedicated Slack channel</text>
  <text x="650" y="485" class="text-sub" font-size="13">✓ SAML SSO &amp; Audit Logs</text>

  <!-- Tier 4: Enterprise -->
  <rect x="900" y="150" width="250" height="480" class="card"/>
  <text x="930" y="195" class="text-title" font-size="20" font-weight="bold">Enterprise</text>
  <text x="930" y="220" class="text-sub" font-size="13">Custom infrastructure &amp; compliance</text>
  <text x="930" y="275" class="price" font-size="36">Custom</text>
  <rect x="930" y="300" width="190" height="42" class="btn"/>
  <text x="1025" y="326" class="btn-text">Contact Sales</text>
  <text x="930" y="380" class="text-sub" font-size="13">✓ Bespoke throughput limits</text>
  <text x="930" y="415" class="text-sub" font-size="13">✓ On-premise VPC peering</text>
  <text x="930" y="450" class="text-sub" font-size="13">✓ Custom BAA &amp; SOC2 reports</text>
  <text x="930" y="485" class="text-sub" font-size="13">✓ 99.99% Financial SLA</text>
</svg>`.trim();

/**
 * 3. Auth Modal with Error State:
 * - Centered dialog box over dark backdrop
 * - Title, email and password form inputs
 * - Prominent alert banner with error message ("Invalid email or password")
 * - Form validation outline on error input
 * - Sign in submit button and cancel/close button
 */
export const AUTH_MODAL_ERROR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <style>
      .backdrop { fill: #090d16; fill-opacity: 0.85; }
      .dialog { fill: #1e293b; stroke: #334155; stroke-width: 1.5; rx: 12px; filter: drop-shadow(0 20px 25px rgba(0,0,0,0.5)); }
      .error-banner { fill: #ef4444; fill-opacity: 0.15; stroke: #ef4444; rx: 6px; }
      .text-title { fill: #f8fafc; font-family: system-ui, -apple-system, sans-serif; font-weight: bold; }
      .text-muted { fill: #94a3b8; font-family: system-ui, -apple-system, sans-serif; }
      .text-err { fill: #fca5a5; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }
      .input-normal { fill: #0f172a; stroke: #475569; rx: 6px; }
      .input-error { fill: #0f172a; stroke: #ef4444; stroke-width: 2; rx: 6px; }
      .btn-submit { fill: #2563eb; rx: 6px; }
    </style>
  </defs>
  <!-- Blurred / dimmed background backdrop -->
  <rect width="800" height="600" class="backdrop"/>

  <!-- Modal Dialog Window -->
  <rect x="200" y="80" width="400" height="440" class="dialog"/>

  <!-- Modal Header & Close Button -->
  <text x="235" y="125" class="text-title" font-size="22">Sign in to your account</text>
  <text x="235" y="148" class="text-muted" font-size="13">Welcome back! Please enter your details.</text>
  <text x="565" y="125" fill="#94a3b8" font-family="system-ui" font-size="18" cursor="pointer">✕</text>

  <!-- Error Alert Banner -->
  <rect x="235" y="170" width="330" height="40" class="error-banner"/>
  <circle cx="255" cy="190" r="8" fill="#ef4444"/>
  <text x="252" y="194" fill="#ffffff" font-family="system-ui" font-size="11" font-weight="bold">!</text>
  <text x="272" y="195" class="text-err" font-weight="500">Invalid email or password. Please try again.</text>

  <!-- Email Input Field -->
  <text x="235" y="238" class="text-title" font-size="13" font-weight="600">Email Address</text>
  <rect x="235" y="248" width="330" height="38" class="input-normal"/>
  <text x="247" y="272" fill="#f8fafc" font-family="system-ui" font-size="14">alex.chen@example.com</text>

  <!-- Password Input Field with Error Highlight -->
  <text x="235" y="312" class="text-title" font-size="13" font-weight="600">Password</text>
  <text x="480" y="312" fill="#38bdf8" font-family="system-ui" font-size="12" cursor="pointer">Forgot password?</text>
  <rect x="235" y="322" width="330" height="38" class="input-error"/>
  <text x="247" y="347" fill="#f8fafc" font-family="system-ui" font-size="14">••••••••••••</text>
  <text x="235" y="374" fill="#ef4444" font-family="system-ui" font-size="12">Authentication failed. Check your password.</text>

  <!-- Submit Button -->
  <rect x="235" y="398" width="330" height="42" class="btn-submit"/>
  <text x="400" y="424" fill="#ffffff" font-family="system-ui" font-size="14" font-weight="bold" text-anchor="middle">Sign In</text>

  <!-- Footer Link -->
  <text x="400" y="475" class="text-muted" font-size="13" text-anchor="middle">Don't have an account? <tspan fill="#38bdf8">Sign up for free</tspan></text>
</svg>`.trim();

/**
 * Converts an SVG string into a data URI (`data:image/svg+xml;base64,...`).
 */
export function svgToDataUri(svg: string): string {
  const base64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

export const FIXTURES = {
  saasDashboard: {
    id: "saas-dashboard",
    name: "SaaS Dashboard Grid",
    description: "SaaS Dashboard with 3-column grid, sidebar, and navbar",
    svg: SAAS_DASHBOARD_SVG,
    dataUri: svgToDataUri(SAAS_DASHBOARD_SVG),
  },
  pricingTable: {
    id: "pricing-table",
    name: "Pricing Table (4 Tiers)",
    description: "Pricing table with 4 tiers (Hobby, Pro, Business, Enterprise)",
    svg: PRICING_TABLE_SVG,
    dataUri: svgToDataUri(PRICING_TABLE_SVG),
  },
  authModalError: {
    id: "auth-modal-error",
    name: "Auth Modal Error State",
    description: "Centered authentication modal with invalid credentials error state",
    svg: AUTH_MODAL_ERROR_SVG,
    dataUri: svgToDataUri(AUTH_MODAL_ERROR_SVG),
  },
} as const;
