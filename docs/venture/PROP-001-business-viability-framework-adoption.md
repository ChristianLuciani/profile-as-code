# PROP-001 — Adopt Business Viability Framework as Core Venture-as-Code Methodology

- **Id:** PROP-001 (monotonic, venture-as-code core proposals)
- **Status:** draft
- **as_of:** 2026-11-20
- **Authored in:** Session `6ffbde15-ddbd-4895-8206-a7d46352b136`
- **Evidence base:** R-026 (Cuenca market viability), BUSINESS-VIABILITY-FRAMEWORK.md
- **Related:** venture-instance-pasco, venture-instance-kontablo
- **spawns:** []

---

## Summary

This proposal requests the ratification of the **Business Viability Framework** (BUSINESS-VIABILITY-FRAMEWORK.md) as a **core methodology** for all venture-as-code ventures, including but not limited to:

- **profile-as-code (pasco)** — Profile management and visibility services
- **venture-instance-kontablo** — Accounting ontology and reconciliation engine
- **All future ventures** under the venture-as-code umbrella

The framework provides a **rigorous, reusable, and defensive** approach to evaluating business model viability **before** investing significant resources.

---

## Typed Question

| Field | Value |
|---|---|
| **Answer shape** | **set** (ratify/reject/defer the framework adoption) |
| **Answer space** | The decision to adopt BUSINESS-VIABILITY-FRAMEWORK.md as core methodology |
| **One judgment** | **Whether the framework should be mandated for all venture evaluations** |
| **Evaluator** | Venture operator (human) |

---

## Decision Requested

1. **Ratify BUSINESS-VIABILITY-FRAMEWORK.md** as the **core methodology** for business model evaluation in venture-as-code
2. **Mandate its use** for all new venture proposals, market entries, and major investments
3. **Integrate it into the venture template** (future: venture-template repository)
4. **Apply it retroactively** to existing ventures (pasco, kontablo) for validation
5. **Establish it as a decision gate** (DG-BUSINESS-VIABILITY) that must pass before Phase 1 execution

---

## Scope

### In Scope
- Core methodology for business model evaluation
- TAM→SAM→SOM funnel with explicit filters
- Fragility test as a binary decision gate
- Unit economics calculation (LTV, CAC, Churn, Payback)
- Competitive mapping and pricing strategy
- Decision scorecard with weighted criteria
- Advanced models (Monte Carlo, sensitivity analysis)
- Validation requirements (money committed, pilots)

### Out of Scope
- Product development methodology (covered by existing docs)
- Technical architecture decisions
- Legal and compliance frameworks (though referenced)
- Financial accounting standards

---

## Why This Matters

### The Problem (Observed in venture-instance-pasco)

Prior research (R-017, R-020, R-021) focused on:
- ✅ Global web searches for competitors
- ✅ Technical capability analysis
- ✅ Feature comparisons

But **failed to answer** the most critical question:
- ❌ **How many customers can actually buy this?**
- ❌ **Is the market large enough to sustain the business?**
- ❌ **What is the break-even point vs. addressable market?**

**Result:** Investment in a service model for Cuenca that **cannot reach break-even** with realistic assumptions (R-026 finding: Fragility Ratio = 63%).

### The Cost of Not Having This Framework

| Venture | Issue | Cost |
|---|---|---|
| pasco (service) | No local market quantification | Time spent on unviable model |
| pasco (service) | No demand validation | Risk of building unwanted product |
| pasco (service) | No fragility test | No early warning of model flaws |
| kontablo | Complex market, high CAC | Risk of underestimating acquisition costs |
| kontablo | Enterprise sales cycle | Risk of overestimating early adoption |

**Quote from User (6ffbde15-ddbd-4895-8206-a7d46352b136):**
> *"Investing time and resources in a business cannot be a matter of roulette or falling in love with ideas. It must be grounded in the market it intends to serve. Better an early pain than an avoidable failure."*

---

## The Solution: Business Viability Framework

### What It Provides

1. **Standardized Methodology**
   - Consistent approach across all ventures
   - Comparable metrics and decision gates
   - Reusable templates and calculations

2. **Defensive Investing**
   - Prevents investment in unviable models
   - Identifies fragility early
   - Reduces risk of failure

3. **Market Grounding**
   - Forces quantification of market size
   - Requires validation with real data
   - Prevents "falling in love with ideas"

4. **Decision Clarity**
   - Binary gates (Go/No-Go)
   - Weighted scorecards
   - Transparent assumptions

### Framework Components

| Component | Purpose | Output |
|---|---|---|
| **MVC Definition** | Define target customer precisely | Operational client criteria |
| **TAM→SAM→SOM Funnel** | Quantify addressable market | Market size estimates |
| **Conversion Modeling** | Estimate adoption rates | Expected clients by scenario |
| **Competitive Mapping** | Understand competitive landscape | Pricing anchors, differentiation |
| **Unit Economics** | Calculate per-customer economics | LTV, CAC, Churn, Payback |
| **Fragility Test** | Binary viability check | Go/No-Go decision |
| **Decision Scorecard** | Multi-dimensional evaluation | Weighted score (1–5) |
| **Advanced Models** | Refinements and sensitivity | Monte Carlo, cohort analysis |
| **Validation Requirements** | Ensure real-world grounding | Money committed, pilots |

### Decision Gates

**DG-BUSINESS-VIABILITY** (Proposed):

| Gate | Question | Criteria | Decision |
|---|---|---|---|
| **Gate 1: Market Size** | Is SAM large enough? | SAM > 3× Break-Even | Go/No-Go |
| **Gate 2: Demand Validation** | Is demand validated? | ≥ 5 LOIs or 1 paid pilot | Go/No-Go/Pivot |
| **Gate 3: Unit Economics** | Are economics sustainable? | LTV:CAC > 3:1, Margin > 60% | Go/No-Go/Optimize |
| **Gate 4: Fragility Test** | Does model pass fragility test? | Break-Even < 50% of SOM | Go/No-Go/Redesign |

---

## Evidence

### Case Study: pasco Service Model in Cuenca (R-026)

**Without Framework:**
- Research focused on global competitors (R-017, R-020)
- Local market not quantified
- No break-even analysis
- Result: Model appeared viable

**With Framework:**
- TAM: 180–250 agencies
- SAM: 45–90 agencies
- SOM Year 1: 9–27 agencies
- Break-Even: 17 clients
- Fragility Ratio: 63% → **FRAGILE**
- Result: Clear No-Go for Cuenca-only model

**Impact:** Prevented investment in unviable model, identified need for:
- Geographic expansion (Quito, Guayaquil)
- Channel partners (agency resellers)
- Demand validation (paid pilots)

### Case Study: kontablo (Hypothetical Application)

**Market:**
- TAM: 200K–400K multi-jurisdictional businesses
- SAM: 40K–80K (meet MVC criteria)
- SOM Year 1: 3K–6K (realistically reachable)

**Economics:**
- Ticket: USD 1,000/month
- COGS: USD 200/month
- Gross Margin: USD 800/month (80%)
- CAC: USD 5,000
- LTV: USD 40,000
- LTV:CAC: 8:1 ✅
- Payback: 6.25 months ✅

**Fragility Test:**
- Break-Even: 63 clients
- SOM optimista: 6,000 clients
- Fragility Ratio: 1.05% → **STRONG** ✅

**Result:** Model passes all gates, proceed with confidence.

---

## Hypotheses

| # | Hypothesis | Measure | Threshold |
|---|---|---|---|
| H1 | Framework reduces risk of investing in unviable models | % of proposals that pass gates and succeed | > 80% |
| H2 | Framework identifies fragility early (before development) | Stage at which models are rejected | Before Phase 1 |
| H3 | Framework improves decision quality | Accuracy of market size estimates | ±20% of actual |
| H4 | Framework is reusable across ventures | # of ventures using framework | All new ventures |
| H5 | Framework saves time and resources | Time spent on unviable models | Reduced by > 50% |

---

## Alternatives Considered

### Alternative 1: No Framework (Status Quo)
- **Pros:** No overhead, flexibility
- **Cons:** High risk of unviable investments, inconsistent decisions, no early warnings
- **Rejected:** Does not address the core problem identified by user

### Alternative 2: Framework as Guidance Only (Not Mandated)
- **Pros:** Less overhead, optional use
- **Cons:** Will be ignored, inconsistent application, no guaranteed benefit
- **Rejected:** "Guidance only" frameworks are rarely used in practice

### Alternative 3: External Framework (e.g., Lean Startup)
- **Pros:** Proven methodology, existing resources
- **Cons:** Not tailored to venture-as-code, missing key components (fragility test), not integrated
- **Rejected:** Custom framework is more appropriate for our context

### Alternative 4: Framework with Training Requirement
- **Pros:** Ensures proper use, higher quality
- **Cons:** Adds overhead, delays implementation
- **Rejected:** Start with framework adoption, add training later if needed

---

## Decision Gates (for This Proposal)

| Gate | Condition | If Met | If Not Met |
|---|---|---|---|
| **DG-FRAMEWORK-RATIFICATION** | Framework is ratified by operator | Adopt as core methodology | Reject or defer |
| **DG-FRAMEWORK-INTEGRATION** | Framework integrated into venture template | Mandate for all new ventures | Optional use |
| **DG-FRAMEWORK-RETROACTIVE** | Framework applied to existing ventures | Validate pasco, kontablo | Apply to new ventures only |

---

## Risks and Open Questions

### Risks

1. **Overhead** `[INF]` — Framework adds upfront work to proposals
   - *Mitigation:* Template and tools reduce overhead; benefit outweighs cost

2. **False Precision** `[INF]` — Estimates may appear more precise than they are
   - *Mitigation:* Always use ranges, declare assumptions, state confidence levels

3. **Paralysis by Analysis** `[INF]` — Over-analysis delays decisions
   - *Mitigation:* Time-box analysis, use decision gates to force binary outcomes

4. **Framework Obsolescence** `[INF]` — Market conditions change, framework may need updates
   - *Mitigation:* Regular review, versioning, feedback loop

### Open Questions

1. **Should the framework be automated?** `[?]` — Tooling to calculate TAM→SAM→SOM, fragility test
   - *Impact:* Higher adoption, lower overhead

2. **Should validation requirements be strict?** `[?]` — Require paid pilots before any development
   - *Impact:* Higher quality, but may delay early-stage ventures

3. **Should the framework apply to all ventures or only commercial ones?** `[?]` — Open-source vs. commercial distinction
   - *Impact:* Scope of applicability

4. **How often should the framework be reviewed?** `[?]` — Annual, quarterly, or per-venture
   - *Impact:* Balance between stability and improvement

---

## Expected Outcome

**Success Metrics (12 months):**
- **100%** of new venture proposals use the framework
- **> 80%** of proposals that pass all gates succeed
- **> 50%** reduction in time spent on unviable models
- **0** major investments in models that fail the fragility test

**Success Metrics (24 months):**
- Framework is **automated** with tooling
- Framework is **extended** with additional models (e.g., network effects, platform economics)
- Framework is **adopted** by external ventures (if open-sourced)

---

## Evaluation Record

- (Empty — operator appends: `YYYY-MM-DD — operator verdict: ratified / rejected / deferred → spawned: bADR-NNN, EXP-NNN`)

---

## Appendices

### Appendix A: Framework Document

The full framework is documented in:
- **File:** `docs/venture/BUSINESS-VIABILITY-FRAMEWORK.md`
- **Status:** Ready for ratification
- **Version:** 1.0

### Appendix B: Template Files

Proposed templates (to be created if ratified):
1. **Business Viability Canvas** (`templates/business-viability-canvas.yaml`)
2. **Market Sizing Spreadsheet** (`templates/market-sizing.xlsx`)
3. **Unit Economics Calculator** (`templates/unit-economics.xlsx`)
4. **Fragility Test Tool** (`scripts/fragility-test.js`)

### Appendix C: Integration Points

**venture-instance-pasco:**
- Apply framework to all service model proposals
- Re-evaluate existing proposals (PROP-010, PROP-021, etc.)
- Use for geographic expansion decisions

**venture-instance-kontablo:**
- Apply framework to pricing and market entry
- Validate enterprise sales assumptions
- Model multi-jurisdictional complexity

**venture-as-code (core):**
- Reference framework in CONTRIBUTING.md
- Add to onboarding documentation
- Include in venture template (future)

---

## References

### Internal
- [R-026: Cuenca agencies market viability](https://github.com/ChristianLuciani/venture-instance-pasco/blob/main/docs/research/R-026-cuenca-agencies-market-viability.md)
- [venture-instance-pasco](https://github.com/ChristianLuciani/venture-instance-pasco)
- [venture-instance-kontablo](https://github.com/ChristianLuciani/venture-instance-kontablo)

### External
- [The Lean Startup — Eric Ries](https://theleanstartup.com/)
- [Running Lean — Ash Maurya](https://leanstack.com/running-lean/)
- [The Mom Test — Rob Fitzpatrick](https://www.momtestbook.com/)
- [TAM SAM SOM — Investopedia](https://www.investopedia.com/terms/t/tam-sam-som.asp)

---

## Conclusion

**The Business Viability Framework is a necessary addition to venture-as-code.**

It addresses a critical gap identified in the pasco venture: the lack of rigorous market evaluation before investing resources. The framework provides:

1. **A standardized, reusable methodology** for all ventures
2. **Defensive investing** through explicit gates and tests
3. **Market grounding** to prevent "falling in love with ideas"
4. **Decision clarity** with binary outcomes and transparent assumptions

**Recommendation:** Ratify and mandate the framework for all venture-as-code ventures.

> *"Better an early pain than an avoidable failure."*
