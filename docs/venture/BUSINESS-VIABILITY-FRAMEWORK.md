# Business Viability Framework

> **Core Methodology for Venture-as-Code**
> 
> *"An idea that solves a real problem is still a dream if the number of customers who can and will pay for it is not enough to sustain operations."*

## Overview

This document establishes the **standard methodology** for evaluating the viability of any business model within the venture-as-code ecosystem. It is designed to be:

- **Reusable**: Applicable to any venture (pasco, kontablo, or future ventures)
- **Rigorous**: Based on quantifiable metrics, not assumptions
- **Defensive**: Prevents investment in models that cannot sustain themselves
- **Transparent**: Every number has a source, every assumption is declared

**Core Principle**: Viability is determined by the equation:

```
universe × conversion × ticket × margin ≥ cost_of_operations
```

The universe of customers is the denominator of everything; if it is small, no margin can save it.

---

## When to Use This Framework

Apply this framework **BEFORE** investing significant resources in:

- New product development
- Market entry strategies
- Pricing model changes
- Go-to-market planning
- Funding decisions

**Trigger**: Any proposal that involves spending money or time on a business model hypothesis.

---

## Methodology: TAM→SAM→SOM Funnel with Fragility Test

### Step 1: Define the Minimum Viable Client (MVC)

**Do NOT use broad labels** like "SMEs", "agencies", or "businesses". Define the client with **operational, verifiable characteristics**:

| Dimension | Criteria | Example (pasco) | Example (kontablo) |
|---|---|---|---|
| **Location** | Geographic scope | Cuenca, Ecuador | Global (jurisdiction-agnostic) |
| **Size** | Employees, revenue, or scale | ≥5 employees OR ≥USD 100K revenue | ≥10 employees, ≥USD 500K revenue |
| **Industry/Type** | Business category | Marketing/digital agencies | Accounting firms, fintech, DeFi |
| **Pain Point** | Specific, verifiable problem | Manual profile management, disconnected systems | Jurisdictional chart reconciliation, multi-standard compliance |
| **Exclusion** | What disqualifies them | Already using mature ERP with profile integration | Already using enterprise accounting software (SAP, Oracle) |
| **Payment Capacity** | Ability to pay | Formal business, RUC registered, payment methods | Established business, budget for compliance tools |

**MVC Template:**
> *A [business type] based in [location], with [size criteria], that [has pain point], and [can pay]. Excluded: [exclusion criteria].*

**Example (pasco):**
> A formal marketing/digital agency based in Cuenca, Ecuador, with ≥5 employees or ≥USD 100K annual revenue, offering web development or digital marketing services, currently managing profiles manually or with disconnected tools, and lacking integrated auditability. Excluded: agencies already using mature ERP/CRM with profile integration.

**Example (kontablo):**
> An accounting firm, fintech company, or DeFi protocol with ≥10 employees and ≥USD 500K annual revenue, operating across multiple jurisdictions, struggling with chart of accounts reconciliation between local standards and IFRS/XBRL, and lacking a unified accounting ontology. Excluded: firms already using enterprise-grade accounting systems with multi-jurisdictional support.

---

### Step 2: Build the Universe — TAM→SAM→SOM Funnel

Apply successive filters to quantify the addressable market. **Every filter must have a source or declared assumption.**

#### TAM: Total Addressable Market

**Definition:** All potential customers that could theoretically use the product/service.

**Data Sources (by priority):**
1. **Official Census** (INEC, Eurostat, etc.) — Most reliable, often outdated
2. **Business Registries** (Superintendencia de Compañías, Chambers of Commerce) — Current, but may miss informal businesses
3. **Commercial Directories** (Google Maps, LinkedIn, industry directories) — Broad coverage, variable quality
4. **Industry Reports** (Gartner, IDC, local associations) — Paid, but authoritative
5. **Web Scraping** (systematic searches) — Useful for digital-first businesses

**Rule:** No census data >5 years old used as final number; use for structure only and adjust with recent sources.

**Calculation Method:**
- **Triangulation**: Use multiple sources and take the conservative range
- **Bottom-up**: Estimate from population × business density × category percentage
- **Top-down**: Start from total businesses and apply category filters

**Example (pasco - Cuenca):**
- Cámara de Comercio: ~200 agencies
- INEC Directorio: ~450 businesses (broader category)
- Google Maps: ~150 results
- **TAM = 180–250 marketing/digital agencies**

**Example (kontablo - Global):**
- Total accounting firms worldwide: ~2M (IBISWorld)
- Fintech companies: ~30K (Statista)
- DeFi protocols: ~5K (DeFiLlama)
- Multi-jurisdictional subset: ~10–20%
- **TAM = 200K–400K potential customers**

#### SAM: Serviceable Available Market

**Definition:** Customers that **could** benefit from the product/service (meet MVC criteria).

**Filters to Apply:**

1. **Size Filter**: Minimum size to justify the product
   - Assumption: 40–60% of TAM for B2B services
   - Source: Industry benchmarks, local market knowledge

2. **Service/Industry Filter**: Must be in target industry
   - Assumption: 60–80% of size-filtered
   - Source: Business registry categories

3. **Pain Point Filter**: Must have the specific problem
   - Assumption: 50–70% of industry-filtered
   - Source: Surveys, interviews, or inferred from market maturity

4. **Exclusion Filter**: Must not have disqualifying factors
   - Assumption: 80–95% do NOT have mature solutions
   - Source: Market penetration data, competitor analysis

**Example (pasco):**
- TAM: 180–250
- Size filter (55%): 99–138
- Service filter (75%): 74–103
- Pain filter (65%): 48–67
- Exclusion filter (90%): **43–60 → SAM = 45–90**

**Example (kontablo):**
- TAM: 200K–400K
- Size filter (50%): 100K–200K
- Industry filter (80%): 80K–160K
- Pain filter (60%): 48K–96K
- Exclusion filter (85%): **41K–82K → SAM = 40K–80K**

#### SOM: Serviceable Obtainable Market

**Definition:** Customers that can be **realistically reached and converted** in a given timeframe.

**Filters to Apply:**

5. **Channel Reach**: Can be reached through current channels
   - Assumption: 20–50% of SAM (Year 1)
   - Source: Channel capacity, partnership network

6. **Budget Capacity**: Can afford the pricing
   - Assumption: 50–80% of reachable
   - Source: Pricing research, income data

7. **Decision Timeline**: Will decide within timeframe
   - Assumption: 30–60% of budget-qualified (Year 1)
   - Source: Sales cycle length, urgency of problem

**Example (pasco - Year 1):**
- SAM: 45–90
- Channel reach (40%): 18–36
- Budget capacity (70%): 13–25
- Timeline (50%): **7–12 → SOM = 9–27**

**Example (kontablo - Year 1):**
- SAM: 40K–80K
- Channel reach (30%): 12K–24K
- Budget capacity (60%): 7K–14K
- Timeline (40%): **3K–6K → SOM = 3,000–6,000**

---

### Step 3: Conversion Modeling (Ranges, Not Single Numbers)

**Never use a single conversion rate.** Model three scenarios with justification:

| Scenario | Conversion Rate | When It Applies | Justification |
|---|---|---|---|
| **Pesimista** | 2–3% | Only the most mature, high-pain segment converts | Early market, new category, requires education |
| **Base** | 5–7% | With focused outreach, references, pilot programs | Established category, clear value proposition |
| **Optimista** | 10–12% | With channel partners, regulation catalyst, strong differentiation | Market tailwinds, viral adoption, network effects |

**Expected Clients Calculation:**
```
Expected Clients = SOM × Conversion Rate
```

**Example (pasco):**
- Pesimista: 9–27 × 2–3% = **0.2–0.8 → 1–2 clients**
- Base: 9–27 × 5–7% = **0.5–1.9 → 2–5 clients**
- Optimista: 9–27 × 10–12% = **1–3 → 3–6 clients**

**Example (kontablo):**
- Pesimista: 3K–6K × 2–3% = **60–180 clients**
- Base: 3K–6K × 5–7% = **150–420 clients**
- Optimista: 3K–6K × 10–12% = **300–720 clients**

---

### Step 4: Competitive Landscape and Pricing

#### Competitive Mapping

Identify **all** competitors, including:
- **Direct competitors**: Offer similar products/services
- **Indirect competitors**: Solve the same problem differently
- **Substitutes**: "Excel", "manual processes", "do nothing"

**Competitive Matrix:**

| Competitor | Offering | Price | Strengths | Weaknesses | Differentiator |
|---|---|---|---|---|---|
| Manual/Excel | Internal processes | "Free" (sunk cost) | No switching cost | No auditability, error-prone | Auditability, automation |
| Competitor A | Partial solution | USD X | Established | Missing features | Integration, completeness |
| Competitor B | Full solution | USD Y | Feature-rich | Expensive | Cost-effectiveness |

**Example (pasco):**
| Competitor | Offering | Price | Strengths | Weaknesses |
|---|---|---|---|---|
| Manual/Excel | Profile management | "Free" | Familiar, no cost | No auditability, manual |
| CreceRank | AI citation measurement | USD 49–299 | Low entry, self-serve | Measurement only, no remediation |
| Blue Nova | Full SEO/GEO service | USD 290–990 | Turnkey | High cost, not white-label |

#### Pricing Strategy

**Price Anchors:** Identify what customers already pay for similar solutions.

**Anchoring Rule:** Position your price against the **next best alternative**, not your cost.

**Pricing Models to Consider:**
1. **Subscription** (MRR): Predictable revenue, lower barrier to entry
2. **One-time** (ARR): Higher upfront, but churn risk
3. **Usage-based**: Scales with value, but unpredictable
4. **Tiered**: Captures different customer segments
5. **Freemium**: Low-friction acquisition, but conversion challenge

**Value-Based Pricing:**
- Quantify the **economic value** your product provides
- Capture **10–30%** of that value as your price
- Example: If your product saves 10 hours/month at USD 50/hour = USD 500 value → Price at USD 50–150/month

---

### Step 5: Unit Economics

Calculate the economics for **each customer**:

#### Key Metrics

| Metric | Formula | Target | Notes |
|---|---|---|---|
| **Ticket** | Price per customer | Market-dependent | Monthly or annual |
| **COGS** | Cost of serving customer | < 30% of ticket | Infrastructure, support, success |
| **Gross Margin** | Ticket - COGS | > 70% | Before sales/marketing |
| **CAC** | Customer Acquisition Cost | < 1/3 of LTV | Sales, marketing, onboarding |
| **LTV** | Lifetime Value | > 3× CAC | Ticket × Gross Margin × (1/Churn) |
| **Payback Period** | CAC / (Ticket × Gross Margin) | < 12 months | Time to recover CAC |
| **Churn Rate** | % customers lost per period | < 5% monthly | Critical for SaaS |

**Example (pasco):**
- Ticket: USD 300/month
- COGS: USD 150/month (infrastructure, support)
- Gross Margin: USD 150/month (50%)
- CAC: USD 500 (sales, marketing)
- Churn: 3% monthly (36% annual)
- LTV: USD 300 × 50% × (1/0.03) = **USD 5,000**
- LTV:CAC Ratio: 5,000 / 500 = **10:1** ✅
- Payback Period: 500 / 150 = **3.3 months** ✅

**Example (kontablo):**
- Ticket: USD 1,000/month (enterprise)
- COGS: USD 200/month (hosting, support)
- Gross Margin: USD 800/month (80%)
- CAC: USD 5,000 (enterprise sales)
- Churn: 2% monthly (24% annual)
- LTV: USD 1,000 × 80% × (1/0.02) = **USD 40,000**
- LTV:CAC Ratio: 40,000 / 5,000 = **8:1** ✅
- Payback Period: 5,000 / 800 = **6.25 months** ✅

#### Break-Even Calculation

**Formula:**
```
Break-Even (clients) = Fixed Costs / Gross Margin per Client
```

**Fixed Costs Include:**
- Development (engineering, product, design)
- Operations (infrastructure, tools, admin)
- Sales & Marketing (team, campaigns)
- G&A (legal, accounting, overhead)

**Example (pasco):**
- Fixed Costs: USD 2,500/month
- Gross Margin: USD 150/client
- **Break-Even: 17 clients** (2,500 / 150)

**Example (kontablo):**
- Fixed Costs: USD 50,000/month
- Gross Margin: USD 800/client
- **Break-Even: 63 clients** (50,000 / 800)

---

### Step 6: The Fragility Test (Decision Gate)

**Rule:** If break-even > 50% of SOM (optimista), the model is **structurally fragile** and should NOT proceed without changes.

**Test Formula:**
```
Fragility Ratio = Break-Even / SOM (optimista)
If Fragility Ratio > 0.5 → FRAGILE
```

**Interpretation:**
- **< 0.3**: Strong model, high confidence
- **0.3–0.5**: Marginal, requires careful execution
- **> 0.5**: Fragile, needs fundamental changes

**Example (pasco):**
- Break-Even: 17 clients
- SOM optimista: 27 clients
- Fragility Ratio: 17 / 27 = **63% → FRAGILE** ❌

**Example (kontablo):**
- Break-Even: 63 clients
- SOM optimista: 6,000 clients
- Fragility Ratio: 63 / 6,000 = **1.05% → STRONG** ✅

**If Fragile:**
1. **Expand TAM**: Broader geographic scope, additional segments
2. **Increase Ticket**: Higher pricing, upsell/cross-sell
3. **Reduce Costs**: Lower fixed costs, improve margins
4. **Improve Conversion**: Better channels, stronger value proposition
5. **Find Channel Partners**: Leverage existing networks

---

### Step 7: Decision Scorecard

Evaluate the model across multiple dimensions with a weighted score:

| Criterion | Question | Weight | Score (1–5) | Notes |
|---|---|---|---|---|
| **Market Size** | Does SAM exceed break-even with margin? | High | | |
| **Verifiable Pain** | Does the customer manifest the problem? | High | | |
| **Willingness to Pay** | Is there validated demand (money committed)? | High | | |
| **Pricing Power** | Does the differential justify the price? | Medium | | |
| **Customization Effort** | Is it low or reducible with a wedge? | Medium | | |
| **Channel Access** | Is there a partner that reduces CAC? | Medium | | |
| **Competition** | Is the market fragmented or dominated? | Low | | |
| **Regulatory Fit** | Are there legal/regulatory barriers? | Medium | | |
| **Team Fit** | Does the team have the required capabilities? | Medium | | |
| **Timing** | Is the market ready for this solution? | Medium | | |

**Scoring:**
- **5**: Excellent, no concerns
- **4**: Good, minor concerns
- **3**: Acceptable, some concerns
- **2**: Marginal, significant concerns
- **1**: Poor, major concerns

**Threshold:**
- **≥ 4.0**: Proceed with confidence
- **3.0–4.0**: Proceed with caution, address concerns
- **< 3.0**: Do not proceed, fundamental issues

**Example (pasco):**
| Criterion | Score | Weighted |
|---|---|---|
| Market Size | 2 | 0.6 |
| Verifiable Pain | 3 | 0.9 |
| Willingness to Pay | 1 | 0.3 |
| Pricing Power | 4 | 0.8 |
| Customization Effort | 3 | 0.6 |
| Channel Access | 2 | 0.4 |
| Competition | 5 | 0.2 |
| **Total** | | **3.8/5.0** |

**Verdict:** Proceed with caution, but fragility test suggests fundamental issues.

---

## Advanced Models and Refinements

### 1. Cohort Analysis

Track metrics by customer cohort (sign-up date, segment, channel):

- **Activation Rate**: % of users who become paying customers
- **Retention Curve**: % retained at 1, 3, 6, 12 months
- **Expansion Revenue**: Revenue from upsells/cross-sells
- **Net Revenue Retention**: (Retention + Expansion - Churn) / Starting Revenue

**Target:** Net Revenue Retention > 100% (expansion outweighs churn)

### 2. Sensitivity Analysis

Test how sensitive the model is to changes in key assumptions:

| Variable | Base | -20% | +20% | Impact |
|---|---|---|---|---|
| TAM | 200 | 160 | 240 | High |
| Conversion | 5% | 4% | 6% | Medium |
| Ticket | USD 300 | USD 240 | USD 360 | High |
| COGS | USD 150 | USD 120 | USD 180 | Medium |
| Fixed Costs | USD 2,500 | USD 2,000 | USD 3,000 | High |

**Rule:** If a ±20% change in any variable makes the model unviable, it is **highly sensitive** and requires more validation.

### 3. Monte Carlo Simulation

Run 10,000+ simulations with random variations in key inputs:

- **Inputs**: TAM, conversion, ticket, COGS, fixed costs (all as ranges)
- **Output**: Probability distribution of outcomes (clients, revenue, profit)
- **Key Metric**: Probability of reaching break-even

**Example:**
- P(Reach 20 clients in Year 1) = 65%
- P(Profitable in Year 1) = 45%
- P(Reach USD 10K MRR) = 35%

**Decision Rule:**
- **> 70%**: High confidence
- **40–70%**: Medium confidence, manage risk
- **< 40%**: Low confidence, reconsider

### 4. Market Growth Modeling

Account for market growth over time:

```
TAM_t = TAM_0 × (1 + growth_rate)^t
```

**Growth Rate Sources:**
- Industry reports (Gartner, IDC)
- Historical data
- Expert estimates

**Example (kontablo):**
- TAM Year 0: 200K
- Growth Rate: 15% annually (DeFi/fintech growth)
- TAM Year 3: 200K × (1.15)^3 = **300K**

### 5. Seasonality and Cyclicality

Account for seasonal variations in demand:

- **Seasonality Factor**: Multiplier for each period (month, quarter)
- **Cyclicality**: Longer-term cycles (economic, industry)

**Example:**
- Q1: 0.8× (slow start)
- Q2: 1.0× (normal)
- Q3: 1.2× (peak)
- Q4: 1.0× (normal)

### 6. Regulatory and Compliance Factors

Assess regulatory impact on:

- **Market Access**: Licenses, certifications required
- **Compliance Costs**: Legal, audit, reporting
- **Time to Market**: Approval processes, delays
- **Ongoing Costs**: Maintaining compliance

**Example (kontablo):**
- Jurisdictional compliance: High complexity
- Compliance costs: USD 50K–100K/year
- Time to market: 6–12 months per jurisdiction

---

## Validation Requirements

**Before proceeding, validate with REAL data:**

### 1. Market Size Validation
- [ ] **Primary research**: Surveys, interviews with target customers
- [ ] **Pilot programs**: Test with 5–10 early adopters
- [ ] **Channel validation**: Confirm reach through proposed channels
- [ ] **Competitor benchmarking**: Verify market size estimates with industry data

### 2. Demand Validation
- [ ] **Money committed**: Letters of intent, pre-orders, paid pilots
- [ ] **Pricing validation**: Test different price points with real customers
- [ ] **Value proposition testing**: Validate messaging and positioning
- [ ] **Churn prediction**: Estimate based on similar products/services

### 3. Economics Validation
- [ ] **COGS measurement**: Track actual costs of serving customers
- [ ] **CAC measurement**: Track actual acquisition costs by channel
- [ ] **LTV projection**: Based on early retention data
- [ ] **Fixed costs**: Accurate budgeting and forecasting

**Rule:** No decision without **at least 3 validated data points** (money committed, pilot results, or primary research).

---

## Decision Gates

### Gate 1: Market Size (Pre-Investment)
**Question:** Is the SAM large enough to justify the investment?
**Criteria:**
- SAM > 3× Break-Even
- TAM growth > 0%
**Decision:** Go/No-Go

### Gate 2: Demand Validation (Pre-Development)
**Question:** Is there validated demand for the solution?
**Criteria:**
- ≥ 5 letters of intent or pre-orders
- ≥ 1 paid pilot
- Positive feedback from ≥ 10 prospects
**Decision:** Go/No-Go/Pivot

### Gate 3: Unit Economics (Pre-Scale)
**Question:** Are the unit economics sustainable?
**Criteria:**
- LTV:CAC > 3:1
- Gross Margin > 60%
- Payback Period < 12 months
**Decision:** Go/No-Go/Optimize

### Gate 4: Fragility Test (Final Check)
**Question:** Does the model pass the fragility test?
**Criteria:**
- Break-Even < 50% of SOM (optimista)
- Fragility Ratio < 0.5
**Decision:** Go/No-Go/Redesign

---

## Common Pitfalls to Avoid

1. **Confusing Density with Direccionability**
   - ❌ "There are 1,000 businesses in the category"
   - ✅ "There are 100 businesses that meet our MVC criteria and we can reach 40 of them"

2. **Using Broad Labels**
   - ❌ "SMEs", "agencies", "businesses"
   - ✅ "Marketing agencies in Cuenca with ≥5 employees and ≥USD 100K revenue"

3. **Taking Old Census Data as Final**
   - ❌ "2010 census says 500 businesses"
   - ✅ "2010 census says 500 businesses, adjusted for 5% annual growth = 650–700 today"

4. **Setting Price Without Competitive Mapping**
   - ❌ "We think USD 500 is reasonable"
   - ✅ "Competitors charge USD 300–800, we anchor at USD 500 based on value delivered"

5. **Validating with Surveys Only**
   - ❌ "80% of survey respondents said they would buy"
   - ✅ "5 customers committed to paid pilots, 3 already signed LOIs"

6. **Comparing Break-Even to TAM Instead of SOM**
   - ❌ "Break-even is 50 clients, TAM is 1,000 → 5% penetration, easy!"
   - ✅ "Break-even is 50 clients, SOM is 80 → 62.5% of SOM, fragile!"

7. **Assuming Technical Differentiation = Market Demand**
   - ❌ "Our product is technically superior, customers will pay"
   - ✅ "Customers value auditability (validated through interviews), our product delivers it at a 20% premium over alternatives"

8. **Analyzing Only One Scenario**
   - ❌ "We expect 5% conversion"
   - ✅ "Pesimista: 2%, Base: 5%, Optimista: 10%"

---

## Template: Business Viability Canvas

Use this canvas to document your analysis:

```yaml
# Business Viability Canvas
venture: pasco | kontablo | other
as_of: YYYY-MM-DD

# Step 1: Minimum Viable Client
mvc:
  location: "Cuenca, Ecuador"
  size: "≥5 employees OR ≥USD 100K revenue"
  industry: "Marketing/digital agencies"
  pain_point: "Manual profile management, disconnected systems"
  exclusion: "Already using mature ERP with profile integration"
  payment_capacity: "Formal business, RUC registered"

# Step 2: Market Sizing
market:
  tam:
    value: 180-250
    sources: ["Cámara de Comercio", "INEC Directorio", "Google Maps"]
    confidence: medium
    as_of: YYYY-MM-DD
  sam:
    value: 45-90
    filters: ["size", "industry", "pain", "exclusion"]
    assumptions: ["55% size filter", "75% industry filter", "65% pain filter", "90% exclusion filter"]
    confidence: medium-low
  som:
    year_1: 9-27
    filters: ["channel", "budget", "timeline"]
    assumptions: ["40% channel", "70% budget", "50% timeline"]
    confidence: low

# Step 3: Conversion
conversion:
  pesimista: 2-3%
  base: 5-7%
  optimista: 10-12%
  expected_clients:
    pesimista: 1-2
    base: 2-5
    optimista: 3-6

# Step 4: Pricing
pricing:
  ticket: USD 300
  anchors: ["Blue Nova: USD 290-990", "CreceRank: USD 49-299"]
  model: subscription

# Step 5: Unit Economics
economics:
  ticket: USD 300
  cogs: USD 150
  gross_margin: USD 150 (50%)
  cac: USD 500
  churn: 3% monthly
  ltv: USD 5,000
  ltv_cac_ratio: 10:1
  payback_period: 3.3 months

# Step 6: Break-Even & Fragility
break_even:
  fixed_costs: USD 2,500
  clients: 17
fragility_test:
  som_optimista: 27
  ratio: 63%
  verdict: FRAGILE

# Step 7: Scorecard
scorecard:
  market_size: 2
  verifiable_pain: 3
  willingness_to_pay: 1
  pricing_power: 4
  customization_effort: 3
  channel_access: 2
  competition: 5
  total: 3.8/5.0
  verdict: PROCEED_WITH_CAUTION

# Validation
validation:
  money_committed: 0
  paid_pilots: 0
  lois: 0
  primary_research: false
  status: NOT_VALIDATED

# Decision
decision:
  gate_1_market_size: PASS
  gate_2_demand: FAIL (no validation)
  gate_3_economics: PASS
  gate_4_fragility: FAIL
  overall: NO_GO
  recommendation: "Expand geographic scope, find channel partners, validate demand with paid pilots"
```

---

## Integration with Venture-as-Code

### For profile-as-code (pasco)

This framework applies to:
- **Service offerings**: White-label, audit, visibility services for agencies
- **Pricing models**: Subscription, one-time, usage-based
- **Market scope**: Local (Cuenca), national (Ecuador), regional (LATAM)

**Key Considerations:**
- Local market size is small (Cuenca: ~200 agencies)
- Competition is emerging (GEO/AEO services)
- Agencies build work in-house (R-022 finding)
- Need to validate willingness to pay with real money

### For venture-instance-kontablo

This framework applies to:
- **Product offerings**: Accounting ontology, reconciliation engine, compliance tools
- **Pricing models**: Enterprise subscription, usage-based, per-jurisdiction
- **Market scope**: Global (multi-jurisdictional businesses)

**Key Considerations:**
- Large TAM (200K–400K potential customers)
- High complexity (jurisdictional, regulatory)
- Enterprise sales cycle (long, high CAC)
- Strong differentiation (unified ontology)

---

## References

### Internal References
- [R-026: Cuenca agencies market viability](https://github.com/ChristianLuciani/venture-instance-pasco/blob/main/docs/research/R-026-cuenca-agencies-market-viability.md) — Application of this framework to pasco's Cuenca market
- [venture-instance-pasco](https://github.com/ChristianLuciani/venture-instance-pasco) — Business ledger for pasco venture
- [venture-instance-kontablo](https://github.com/ChristianLuciani/venture-instance-kontablo) — Business ledger for kontablo venture

### External References
- [TAM SAM SOM: What's the Difference?](https://www.investopedia.com/terms/t/tam-sam-som.asp) — Investopedia explanation
- [The Lean Startup](https://theleanstartup.com/) — Eric Ries, validated learning
- [Running Lean](https://leanstack.com/running-lean/) — Ash Maurya, business model validation
- [The Mom Test](https://www.momtestbook.com/) — Rob Fitzpatrick, customer interviews

---

## Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-11-20 | Vibe Code | Initial framework based on R-026 analysis |

---

## License

This document is part of the venture-as-code core methodology and is licensed under the same terms as the profile-as-code project (MIT License).

---

> **Remember:** "Investing time and resources in a business cannot be a matter of roulette or falling in love with ideas. It must be grounded in the market it intends to serve. Better a early pain than a avoidable failure."
