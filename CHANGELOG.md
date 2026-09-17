# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases are tagged `vX.Y.Z`; until v1.0.0 the API is in active design (see SPEC §7) and
minor versions may contain breaking contract changes.

## [Unreleased]

### Fixed

- **strings vacíos en langMaps = ausentes (issue #84, opción (a) ratificada)** — los valores `en: ""` eran
  schema-válidos (sin `minLength`) y los accesores los trataban como texto presente (`!== undefined`): filas
  degeneradas en outputs públicos (`- **hub** — ` con dash colgante, `Evidence:  ([source])` con doble espacio,
  `- ** **` vacío en github-org). Regla semántica única en el acces de texto: `langText` (core, `compile.ts`) y los
  `pickText` de ambos renderers devuelven `undefined` para `""` — la vacuidad cuenta como ausente en AMBOS niveles del
  lookup (un `es: ""` cae al `en`; un `en: ""` no emite nada). Sin ghost-fallbacks en el registro de `fallbacks`
  (solo se anota cuando efectivamente se devolvió texto). Sin trim (el límite de la regla es el string vacío exacto —
  `" "` queda como dato, candidato para un check futuro). Byte-parity: workspaces poblados byte-idénticos (tests
  byte-for-byte sin cambios); solo outputs previamente degenerados mejoran. TDD: 5 tests rojos (core 3, readme 1,
  org 1) → verde; suite 258/258.
- **`github-readme`: campos opcionales nunca interpolan `"undefined"` (issue #78)** — `identity.links[].label` es
  opcional en el schema (solo `url` es requerido, y el string vacío es válido — sin minLength) y el renderer la
  interpolaba cruda: un workspace válido sin `label` (o con `label: ""`) publicaba `- [undefined](…)` o `- [](…)` en
  un README público. Fallback opción (b) del issue: `hostnamePath(l.url)` — exactamente el label que ya usan los
  links de `projects[]`, sin cambio de contrato. El sweep del patrón (misma clase, mismo archivo) encontró dos
  instancias más y las arregla en el mismo PR: `skill.level` (omisión del paréntesis) y `project.status` (omisión del
  segmento ` · \`status\``). Byte-parity: inputs con los tres campos poblados emiten byte-idéntico (test EXPECTED sin
  cambios); `github-org` verificado limpio (todas sus interpolaciones opcionales están guardadas).

### Planned (roadmap)

- Renderers: `github-readme` (dogfood), linkedin, upwork, x, researchgate, substack (M2/M4)
- CLI `pasco`: build · validate · diff · check · refine · skills:install (M1/M3)
- Per-platform skills v1 from SOTA research (M3)
- `profile-data` template repo + web renderer (M5)

## [0.1.0] - 2026-09-15

### Added

- **`identity.email` — el email de contacto como hecho de primera clase (v1.5, issue #71)** —
  el boundary de schemes http(s)-only (#53/PR #64) no dejaba hogar para un email de contacto:
  los workspaces lo modelaban como fila `mailto:` en `identity.links[]`, que el patrón
  `^https?://` rechaza — `profile-data-template` y el workspace real del operador fallaban
  `pasco validate` día uno (el output ya deployado llevaba el mailto: pre-#53, o sea que el
  dato era legítimo). Decisión ratificada por el operador (opción B): campo dedicado.
  - **Schema v1.5 (aditivo)** — `identity.email` (string, patrón RFC-5322-adyacente
    `^[^@\s]+@[^@\s]+\.[^@\s]+$`); `mailto:` sigue RECHAZADO en `links[]` (D12) — el boundary
    de #53 queda intacto en los 13 sitios de URL. Fixture positiva (`valid-full.json`) +
    negativa (`invalid-bad-email.json`); `gen:zod` regenerado (D3).
  - **GEO** — `geoCheck` emite `email` (schema.org `email` sobre `Person` **y** `Organization`,
    §17.1); `sameAs` queda solo con URLs de página (un `mailto:` no es una página de
    referencia — el wart semántico preexistente desaparece). `identity.email` entra al
    denominador del readiness (`completeness`): un perfil sin email baja de 6/6 a 6/7.
  - **Renderers** — `github-readme`: fila `- [Email](mailto:…)` PRIMERO en `## Links` (un
    hecho de contacto encabeza, los canales siguen) + `email` en su JSON-LD;
    `github-org`: fila `- mailto:…` + `email` en el JSON-LD (paridad §17.1). Output-only:
    `links[]` no cambia, `sameAs` nunca lleva mailto. Sin email → byte-idéntico al output
    pre-v1.5 (regresión cubierta por tests).
  - **SPEC** — §6 (párrafo del campo + sketch), §15.2 (regla de la fila Links), §15.4
    (mismoAs solo páginas), §17.1 (paridad brand); `schema/README.md` (regla de schemes +
    fila identity); tests: 195 (+9 vs base).
- **Release pipeline para `@profile-as-code/cli` (issues #42/#43)** — `.github/workflows/release.yml`:
  tag `v*` (o `workflow_dispatch`, con input `dry_run` para smoke del pipeline sin publicar) → guard
  tag↔versión → build → test → assert del tarball → `npm publish --access public`
  (`id-token: write` para provenance OIDC, secret `NPM_TOKEN`). El publish real lo dispara el
  operador (#44). **Provenance condicional (decisión a, #44):** npm la rechaza desde repos fuente
  privados, así que `--provenance` se agrega solo cuando el repo ya es público — v0.1.0 sale sin
  ella (pre-flip) y los tags siguientes la llevan automáticamente, sin edición de seguimiento.
  El tarball es self-contained: `@profile-as-code/core` + renderers se buclean en un
  `dist/index.js` único (tsup; 147.58 KB, build 2026-09-15) porque no están en npm; `yaml`/`zod` quedan como dependencias
  reales. Assert (`packages/cli/scripts/verify-pack.mjs`, corrido en `ci.yml` y pre-publish):
  el tarball expone el bin `pasco` (existe, ejecutable, shebang, sin `workspace:` en las ranges que
  resuelve el consumidor) + smoke de instalación aislada del bin linkeado (`pasco <versión>`).
- **Evidence registry — capa de prueba pointer-first (D17/§18 — issue #48)** — el SPEC gana
  la capa de evidencia del workspace: dos bloques tipados (`credentials[]` atestaciones de
  terceros; `artifacts[]` obras/media), matriz de capacidades por locator (protege
  byte-stability §15.1 y el URL SSOT §15.4), `media/` opcional en el workspace que llega a la
  superficie pública solo vía `assets/` del renderer (define el slot de §15.2),
  `PASCO_EVIDENCE_ROOT` per-machine (nunca commiteado), y symlink/stow relegado a
  conveniencia documentada de power-user. Enmiendas: §5 (D17), §6, §12 (M7/M8), §14 (Q9),
  §15.4 (URL SSOT extendido), §17.1 (paridad brand). **Solo contrato** — la implementación
  (schema v1.3 + `pnpm gen:zod` + checks + JSON-LD `hasCredential`) es M7, PRs separados
  (dev-methodology §1).
- **Evidence registry core — schema v1.4 + checks + JSON-LD (M7, D17/§18 — issue #48)** —
  la capa de prueba ratificada en la SPEC entra al motor:
  - **Schema v1.4 (aditivo, semver minor)** — raíces nuevas `credentials[]`
    (certificate/title/award/patent: issuer, credentialId, verifyUrl, issued/expires,
    visibility) y `artifacts[]` (portfolio/gallery/showreel/dataset/document/code:
    locator `{url|path}` con XOR, checksum sha256, license, tags, visibility);
    cross-refs: `evidenceItem` gana `credentialId`/`artifactId`, `publications[]`/`press[]`
    ganan `artifactRefs`. `visibility: public|unlisted|private` first-class (§18.5) —
    ausente = public (el perfil pre-registro era público por diseño). El XOR del locator
    vive en JSON Schema (`oneOf`) y se re-chequea post-Zod en core (el Zod generado no
    puede expresar required-without-property; mismo fail-class que el ledger, D12).
  - **Core** — `checkRegistryIntegrity` (load falla con clase D12: ids duplicados,
    cross-refs colgantes, locator XOR) y `registryCheck` (§18.8 offline/determinista:
    `credential-expiry` warn; `no-private-in-public-output` ERROR — el gate de leak §18.5:
    evidencia/publicaciones/press públicos que referencian entradas non-public fallan
    `pasco check`). JSON-LD (§18.9): `Person`/`Organization` ganan `hasCredential` →
    `EducationalOccupationalCredential` (solo public; término en área "new" de schema.org,
    fuente fechada en la SPEC). El registro viaja en el slice `compile()` (facts).
  - **CLI** — `pasco check` ejecuta las reglas del registro (warn + error, exit FAIL en
    leak). **Renderer** — `github-readme` emite sección compacta `## Credentials` /
    `## Artifacts` (solo `public`; locators `path` NUNCA emiten URL pública — D14) y
    `hasCredential` en su JSON-LD. Template-side (`media/` scaffold, evidence-packs,
    symlink doc) vive en profile-data-template#8; M8 (pipeline de media) es el siguiente.
- **Media pipeline — byte-stable asset transport (M8, D17/D19 — issue #48)** — los
  pointers se convierten en bytes deployables sin que el motor sea dueño de los binarios
  (D14). Q9 resuelto como **D19** (§13): un dir `assets/` por salida de plataforma, NO un
  store content-addressed compartido (las superficies de deploy son repos separados; cada
  salida es self-contained y reviewable).
  - **Core** — `collectMedia(profile, workspace)`: bundler único — solo artifacts
    `path`-locator **public** (§18.5), sha256 + bytes en orden determinista (sorted por id),
    verificación del `checksum` declarado (mismatch = error, asset NO bundleado); cadena de
    resolución: `media/…` = workspace-relative (SSOT; missing/unsafe = error), resto =
    external bajo `PASCO_EVIDENCE_ROOT` (env > gitignored `.pasco/local.toml`, per-machine,
    nunca commiteado; missing = warn, CI-degradable §18.3; roots relativos anclan al
    workspace, no al CWD de invocación); guard de contención
    (`media-path-unsafe`); symlink fuera del workspace sin checksum = warn (§18.7);
    oversize > 50 MB = warn (§18.6). Targets `assets/<id>/<basename>` (ids únicos
    core-checked → collision-free) — `artifactAssetTarget` es la derivación única que
    renderer y build comparten. `mediaManifest` = registro compile-time determinista.
  - **Renderer interface (§15.2)** — el slot `assets?: string[]` queda definido: el
    renderer DECLARA los targets deploy-relativos que su texto referencia (via
    `opts.assets`); sin bundle → path locators quedan sin link (output byte-idéntico al
    pre-M8). `github-readme` emite ` — [assets/<id>/<basename>](href)` para los bundleados —
    href percent-encoded (espacios/paréntesis rompen destinos CommonMark; el target del
    manifest queda raw) — y nunca un path interno del workspace.
  - **Build** — copia exactamente los targets referenciados a
    `profiles/<platform>/assets/` y escribe `assets/manifest.json` (version, platform,
    lang, sha256/bytes/origin por asset); rebuild limpio — el output dir queda como
    función pura del workspace (§15.1, sin drift stale). `pasco check` ejecuta las reglas
    de media (error: `media-missing-workspace`/`media-path-unsafe`/`media-checksum-mismatch`;
    warn: `media-external-missing`/`media-symlink-external`/`media-oversize`/
    `media-unbundled-no-id`).
  - **Docs** — `docs/media-pipeline.md` (contrato engine-side: pipeline, resolución,
    manifest, git-lfs, symlink tradeoffs, playbook de deploy con verificación).
  - **Fix §18.9 (gap M7)** — el JSON-LD de `github-org` ahora emite `hasCredential`
    (solo public), como la SPEC ya prescribía para Organization. Portfolio-site
    consumption queda **con M5** (el web renderer aún no existe; el contrato §15.2/§18.6
    es su seam de consumo).
- **Per-entry deploy-status ledger (v1.3 schema, D18 — issue #37)** — el deploy loop pasa de
  granularidad-plataforma y prosa mantenida a mano (`CHECKLIST.md`) a **estado por entrada como
  dato** que solo `pasco` muta. Responde la pregunta del operador por bloque: ¿mío o del
  template? ¿publicado? ¿en qué superficie y en sync — o desactualizado?
  - **Schema v1.3 (aditivo, semver minor)** — nueva raíz `deployments`
    (`content/deployments.yaml`: ledgerKey → surface → `{deployedAt, contentHash, source}`);
    `id` opcional estable en `experience`/`projects`/`publications`/`education`/`press`;
    flag de provenance `origin: template`. Restricciones de claves via `propertyNames`
    (JSON Schema) **y** re-chequeadas post-Zod en core (gen-zod las descarta): unicidad de
    `id` por bloque, claves compuestas ambiguas **solo cuando el ledger las direcciona**
    (aditivo: workspaces legacy con duplicados siguen validando), surface ∈ enum D16.
  - **Core** — `hashUnit`/`canonicalJson` (SHA-256 de la serialización canónica *sin*
    metadatos del ledger: agregar un `id` nunca marca `stale`), `trackableUnits` (espacio de
    claves §19.2: bloques raíz, bios/headlines/skills/handles compuestos, filas con id),
    `deployStatus` (`in-sync`/`stale`/`never` + untracked + removed — detección de staleness
    exacta por hash, independiente de release tags), `checkLedgerIntegrity` (post-Zod, D12).
  - **CLI** — `pasco status [platform] [--mark <ledgerKey> <surface>] [--at <iso>]
    [--write-checklist] [--json]`: reporte por entrada + camino de escritura del ledger
    (regla D14) + `CHECKLIST.md` regenerado como vista AUTO-GENERATED.
  - **Fixtures contract** — `valid-deployments` + `invalid-deployments-bad-surface` +
    `invalid-deployments-bad-key` en `scripts/schema-check`.
- **Platform set — Postiz parity + operator extras (v1.2 schema, D16 — issue #30)** — el
  enum compartido de plataformas (person + brand) pasa de 16 a **43**: la unión de las 34
  redes soportadas por Postiz ([OFICIAL] docs.postiz.com llms.txt, fetched 2026-09-02) + 9
  extras del operador (`ghost`, `spotify`, `soundcloud`, y las seis superficies v1 no-Postiz:
  `github-readme`, `upwork`, `researchgate`, `substack`, `patreon`, `github-org`). Slugs
  nuevos Postiz verbatim (`linkedin-page`, `instagram-standalone`, `devto`, `gmb`,
  `warpcast`, `moltbook`, `mewe`, `tumblr`).
  - **Schema v1.2 (aditivo)** — `$id`/`title` bump; `check.platform` == `['all', ...platform]`
    asertado por `scripts/schema-check` (dedup guard, no confianza manual).
  - **Core** — `PLATFORMS` espeja el enum (contract test vitest: schema ↔ types.ts); drift
    reconoce los hosts nuevos (incluye subdominios `*.ghost.io`, `*.hashnode.dev`,
    `*.medium.com`, `*.wordpress.com`, `*.slack.com`) y corrige el bug pre-existente de
    `patreon.com` ausente en PLATFORM_HOSTS.
  - **Fuera de scope** — skills por plataforma: follow-ups, un issue por plataforma.

- **Brand flavor (M6, D15/§17 — issue #25)** — el engine modela identidades de marca:
  - **Schema v1.1 (aditivo)** — `flavor: person|brand`, variante org de `identity`
    (`orgName`, `logo`, `brandVoice`, `mission`, `tagline`, `established`), bloques
    `socialHandles` (handle matrix con `status: claimed|pending`), `newsletter`,
    `podcast`, `press`, `audiences`; plataformas brand (`github-org`, `bluesky`,
    `instagram`, `tiktok`, `youtube`, `spotify`, `reddit`, `mastodon`, `soundcloud`);
    reglas de check `handle-claimed` / `handle-consistent`.
  - **Core** — `flavor` normalizado (default person), drift handle-matrix
    (`drift/duplicate-handle`, `drift/handle-claimed-not-linked`,
    `drift/handle-host-mismatch`), GEO `schema.org/Organization` (sameAs = links +
    claimed handle urls), compile con bloques brand.
  - **Renderer `github-org`** — README de org determinista (badges de handles
    claimed, newsletter, podcast, press, audiences, JSON-LD Organization).
  - **CLI** — `pac init --flavor brand`, `pac build github-org` (solo brand),
    `pac check` ejecuta las handle rules offline.
  - **Skill `github-org`** — voz de marca ≠ voz personal, checks de handle matrix,
    trademark/impersonación (firmar siempre como el nombre completo).
  - **Templates** — puntero `templates/profile-data-brand/` (multi-workspace §9.1).

- **Schema contract v1** — `schema/profile.schema.json` (JSON Schema 2020-12, D3): the single
  contract for a `profile-data` workspace. i18n `langMap` with EN required, GEO anchors,
  evidence claims, declarative checks, active variant selection.
- **Core engine (M1)** — `packages/core`: `load()` (YAML → validate → normalize), `driftCheck()`
  (factual contradictions, warn semantics D12), `geoCheck()` (consistency score + structured-data
  readiness), `compile()` (language-aware platform slices). Zod generated from the schema.
- **CI/CD** — `ci` check on every PR and on `main` (schema self-test + pnpm test/build),
  Dependabot (npm + actions), auto-delete of merged head branches. Branch protection
  (required status checks) is deferred while the repo is private on GitHub Free —
  `main` is protected by access + process (`docs/STANDARDS.md`); re-applied on flip
  (`docs/ci-cd.md`).
- **Community scaffolding** — CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, SECURITY, PR/issue
  templates, GitHub Discussions.
- **Prior-art research** — `docs/research/01-prior-art.md`, SOTA research prompts + runner.
- **`@profile-as-code/markdown` — la regla CommonMark compartida (issues #75/#76)** — el escaping
  de markdown vivía solo en `github-readme` (`mdHref`, issue #73) y faltaba en `github-org`: el
  renderer siguiente (M2/M4) habría copiado la regla por tercera vez, y una regla que viaja por
  copia es exactamente cómo el mismo bug llega al próximo adapter. El paquete separa las dos
  superficies — `mdHref()` (destinos) y `mdText()` (texto de link: backslash-escape de `\`/`[`/`]`).
  Sin dependencias; `core` sigue agnóstico de plataforma (AGENTS.md §7); 12 tests propios.

### Changed

- **GEO readiness denominator ahora cuenta `identity.email` (v1.5, issue #71)** — cambio
  de comportamiento para consumidores que comparaban `completeness`: un perfil sin email
  pasa de 6/6 a **6/7** (y con email llega a 7/7). Diseño intencional: el email es un
  hecho de primera clase del identity y entra al readiness como los demás campos.
- **BREAKING — CLI bin rename: `pac` → `pasco` (issue #38)** — the npm name `pac` is occupied since 2015
  and owns the `pac` bin (global-install collision risk); `paco` is occupied too. Verified
  free candidates on registry.npmjs.org, 2026-09-07. Operator decision: the binary is now
  **`pasco`** — never owned on npm, zero collision/dispute risk. Package stays
  `@profile-as-code/cli`; workspace config `.pacrc` → `.pascorc`; renderer artifact comments
  now read `generated by profile-as-code pasco build …`. Historical entries above keep
  their original names. A legacy `.pacrc` found where `.pascorc` is expected now fails
  with a migration hint instead of being silently ignored (sota-review round 2).

- Spec consolidated (D1–D14 resolved): Substack as platform, profile-data as separate repo,
  model-agnostic `pac refine`.

### Fixed

- **Renderer: every markdown link destination from a SSOT URL is CommonMark-safe
  (issue #73)** — URLs with `(`/`)`/space are contract-legitimate (`$defs/url`:
  `^https?://` + `format: uri` both tolerate them) but a raw CommonMark destination ends
  at the first `)` or space → broken link + stray text. The canonical helper `mdHref`
  (introduced by #72 for asset targets + the email row) now covers ALL destinations the
  `github-readme` renderer emits from a SSOT URL: badges, project links, project evidence
  sources, DOI hrefs, credential `verifyUrl`, artifact `locator.url` and the `Links` rows.
  - **`mdHref` = `encodeURI`'s ASCII set minus `%`, plus the parens** — verified
    exhaustively (all 128 ASCII chars): the output is byte-identical to the previous
    helper except where the old output was wrong or over-normalized — a VALID `%` escape
    is no longer double-encoded (`%20` → `%2520` addressed a different resource) and a
    non-ASCII URL stays verbatim (an IRI is a valid CommonMark destination). A lone `%`
    (malformed escape) becomes `%25`; the C0/C1 controls that survive the schema boundary
    are percent-encoded (TAB/LF/CR never arrive — the boundary's WHATWG preprocessing
    strips them; encoding them is defensive).
  - **Blast radius** — for the 7 newly-covered destinations the output changes only when
    one of those fields carries a URL with `(`/`)`/space, and no known workspace does:
    the deployed workspace is byte-identical (verified: `profile-data` main-build vs
    fix-build diff = empty) → no re-peg note. JSON-LD `sameAs`/`email` stay verbatim
    (§18.4); facts stay raw in labels (a DOI's text keeps its bytes — only the href is
    encoded).
  - **github-org NOT touched** (operator-scoped): its `## Links` rows are plain text
    (`- ${url}`), not CommonMark destinations — verified; the same destination class does
    exist in its badges/newsletter/podcast/press/logo emissions → escalated as #75, and
    the adjacent link-*text* class (a `]` in a URL breaks the label) as #76.

- **`github-org`: todos los destinos CommonMark son seguros (issue #75)** — badges (el `src` de
  shields.io **y** el href del handle: el path de la marca se interpola dentro del primer
  destino), newsletter, podcast (url + rss), press y `identity.logo` pasan por `mdHref()`. Un
  `(`/`)`/espacio legítimo del SSOT (`$defs/url`) terminaba el destino en el primer `)` y el
  resto quedaba como texto suelto. `## Links` sigue siendo texto plano (no hay destino que romper).

- **Los renderers escapan el TEXTO de los links (issue #76)** — un `]` en el path de una URL, en
  un DOI o en un `identity.links[].label` cerraba el label antes de tiempo: el link no existía y
  el resto quedaba como texto + autolink (repro contra un parser CommonMark real, en el issue).
  `mdText()` backslash-escapa `\`/`[`/`]`; CommonMark desescapa al renderizar, así que el label
  visible conserva sus bytes (el hecho se mantiene crudo, §18.4). Cubre `github-readme` (links de
  proyectos, DOI, artifact url, asset target, `Links`) y `github-org` (newsletter, podcast).
  Byte-parity: sólo cambia con `\`/`[`/`]` en un label — ningún workspace conocido los tiene
  (los tests byte-for-byte existentes pasan sin modificación).
