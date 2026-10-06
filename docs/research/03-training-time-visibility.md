# Research 03 — Training-time corpus presence (the layer below GEO)

> Question: beyond inference-time retrieval (SEO → GEO, SPEC §12), can profile-as-code outputs enter
> the **training corpora** of future models — and is that a documented discipline?
> Method: primary-source fetch this session — arXiv 2311.09735 (GEO), arXiv 2302.10149 (poisoning),
> commoncrawl.org/faq, llmstxt.org; re-verified during premerge review — arXiv 2305.17493 +
> Crossref DOI 10.1038/s41586-024-07566-y (venue), developers.openai.com/api/docs/bots.md,
> huggingface.co/commoncrawl. Not re-fetched: Google-Extended and Anthropic crawler docs (candidate
> paths 404 / fetch truncation this session). Date: 2026-10-05.
> Tiers: [OFICIAL] primary doc of the fact's emitter · [EXPERTO] recognized and citable expert
> analysis · [BENCHMARK] published measurement · [?] not qualifiable · markers: [MI] own analysis ·
> [WEB] source exists · [INF] inference.

## TL;DR

There **is** a documented layer ("training-time corpus presence") and its levers are documented — but
as a *marketing discipline* it is not ratified like GEO: no standard name, no public benchmarks, no
feedback signal. Feasibility is proven by adversarial literature (web-scale training-corpus
poisoning). Consequence for this repo: a consent-gated floor — **private-first default** (AI-training
crawlers blocked, no open license); an owner's explicit opt-in is what lets today's GEO work compound
across model generations at ~zero marginal cost. The dataset publication decision (Hugging Face
dataset vs contributing to existing open datasets vs both) is frozen as **Q10** (SPEC §14), deferred
until the M3 platform SOTA research closes.

## Map: three visibility layers

| # | Layer | Evidence anchor | Controls |
|---|---|---|---|
| 1 | Search (SEO) | mature discipline (decades) | indexation + ranking in search engines |
| 2 | Inference (GEO/AEO) | [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735), KDD 2024 (v3 2024-06-28) | citation *when an agent retrieves* your content; up to `+40%` visibility [BENCHMARK] |
| 3 | Training (corpus presence) | emerging; no ratified discipline [INF] | what the model "knows" **without** retrieval |

## Documented levers (funnel into training corpora)

| # | Lever | Mechanism | Source (date) | Tier |
|---|---|---|---|---|
| 1 | **Don't block Common Crawl** | CCBot honors robots.txt and consumes sitemaps announced in robots.txt [OFICIAL]; dominant pretraining corpora (C4, The Pile, RefinedWeb, FineWeb) build on Common Crawl [EXPERTO]; CC also keeps an [opt-out ledger](https://commoncrawl.org/blog/common-crawl-foundation-opt-out-registry) — its existence signals this is a main channel [INF] | [commoncrawl.org/faq](https://commoncrawl.org/faq), consulted 2026-10-05 | [OFICIAL] (CC behavior) · [EXPERTO] (corpora-on-CC) |
| 2 | **Don't block vendor AI crawlers** | GPTBot: "Disallowing GPTBot indicates a site's content should not be used in training generative AI foundation models" [OFICIAL]; Google-Extended (Gemini) and Anthropic's Claude crawler docs describe the same training-vs-retrieval split, but those docs were not fetched this session [?]; the market trend is *blocking* them, so an allow-posture is a differential [INF] | [developers.openai.com/api/docs/bots.md](https://developers.openai.com/api/docs/bots.md), consulted 2026-10-05 | [OFICIAL] (GPTBot) · [?] (Google/Anthropic crawlers) |
| 3 | **Public GitHub repos** | READMEs + repository code enter code-/documentation-weighted corpora | no named source this session | [MI] |
| 4 | **Open structured datasets (Hugging Face)** | publishing the compiled profile (JSON-LD/JSON) as a dataset makes it directly consumable curation material; the Common Crawl Foundation distributes its own data on HF | [huggingface.co/commoncrawl](https://huggingface.co/commoncrawl) + [CC FAQ](https://commoncrawl.org/faq) nav, consulted 2026-10-05 | [OFICIAL] (HF presence) · [INF] (curation-material claim) |
| 5 | **Open license + freshness** | curation pipelines filter by license, dedup and quality classifiers [INF]; pressure source: model collapse — indiscriminate training on recycled/generated content causes irreversible defects | Shumailov et al., Nature 631:755–759 (2024-07-24), [DOI 10.1038/s41586-024-07566-y](https://doi.org/10.1038/s41586-024-07566-y) (Crossref, consulted 2026-10-05) · preprint [arXiv:2305.17493](https://arxiv.org/abs/2305.17493) (v3 2024-04-14) | [OFICIAL] (venue verified via Crossref) · curators-filter [INF] |
| 6 | **Independent citations** | Wikipedia-class secondary sources (press, papers, books) re-enter corpora with high weight; gated by third-party notability | no named source this session | [MI] |
| 7 | **llms.txt** | verbatim: "Our expectation was that llms.txt would mainly be useful for inference rather than training, and that is how it has been used, though training runs could take advantage of the information too" | [llmstxt.org](https://llmstxt.org/) (v2: published 2024-09-03, modified 2026-08-10), consulted 2026-10-05 | [OFICIAL] |

## Feasibility anchor (adversarial framing)

[Poisoning Web-Scale Training Datasets is Practical](https://arxiv.org/abs/2302.10149) — Carlini et
al., submitted 2023-02-20 (v2 2024-05-06): web-scale corpus entry is controllable by modest external
actors; the authors showed `$60` could have poisoned 0.01% of LAION-400M/COYO-700M [BENCHMARK]. The
paper frames it as an attack; the legitimate flip side is that *corpus presence* is a controllable
surface, not an abstraction.

## Limits (why this is not yet "a marketing discipline")

- No feedback loop: training cycles are ~annual and opaque; nobody can demonstrate
  "I published → the next model generation knows me" [INF].
- Inference-time retrieval dominates present agent behavior — GEO covers the measurable horizon;
  in-weights presence matters for model priors and offline/no-retrieval contexts [INF].
- Compounding path: agents cite retrieved content today; aggregated web text re-enters future corpora
  via re-crawl and distillation — so GEO now is training-time exposure later, *if* crawlers stay
  allowed [INF].

## For profile-as-code

- Already covered by the engine: public GitHub repos (lever 3) and citability renderers +
  JSON-LD `schema.org/Person` (layer 2, SPEC §8).
- Floor regardless of the Q10 resolution (SPEC §12, M9) — **private-first default**: the `robots.txt`
  matrix on published surfaces **blocks** AI-training crawlers and published profiles carry **no**
  open license, unless the profile owner explicitly opts in (consent field, deferred with Q10).
  Consent framing: the levers above are opt-in mechanics that belong to the data owner — an engine
  defaulting to allow-posture would make a privacy decision on users' behalf [MI].
- Deferred to Q10: a `huggingface-dataset` renderer/exporter vs contributing profile data to existing
  open datasets vs both — decided when the M3 platform SOTA research closes.
