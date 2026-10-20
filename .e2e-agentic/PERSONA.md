# Persona sintética — Marta Ficticia (E2E agéntico)

> **Alcance declarado** (`agos` §Convenciones):
> Cubre: el workspace sintético completo (7 `content/*.yaml`), reproducible con `pasco init` + este archivo · No cubre: el perfil real del operador (no se usa ni se copia) ni ninguna persona real: "Marta Ficticia" es inventada, y las URLs `ejemplo.test` y `github.com/marta-ejemplo` no existen · as_of: 2026-10-20
> Si una pieza no aparece, no asumas que no existe: reportá el hueco.

### content/bios.yaml
- platform: linkedin
  lang: en
  length: medium
  text: Data engineer with experience in public-health pipelines, ETL design and open data. I turn messy registries into datasets a clinic can trust.
- platform: x
  lang: en
  length: short
  text: Data engineer. Public health pipelines. Open data.

### content/experience.yaml
- id: exp-analyst
  role:
    en: Data Analyst
    es: Analista de Datos
  org: Ministerio de Salud Ejemplo
  start: "2021-03-01"
  end: present
  highlights:
    en:
      - Rebuilt the vaccination registry pipeline; cut daily load time from 6h to 40min.
    es:
      - Reconstruí el pipeline del registro de vacunación; el load diario pasó de 6 h a 40 min.

### content/headlines.yaml
- platform: linkedin
  lang: en
  text: Data Engineer | Public Health Pipelines | Open Data

### content/identity.yaml
name: Marta Ficticia
location: Montevideo, Uruguay
email: marta@ejemplo.test
links:
  - platform: website
    label: Portfolio
    url: https://ejemplo.test
  - platform: github
    label: GitHub
    url: https://github.com/marta-ejemplo
  - platform: linkedin
    label: LinkedIn
    url: https://www.linkedin.com/in/marta-ejemplo
  - platform: github
    label: OpenVax
    url: https://github.com/marta-ejemplo/openvax
  - platform: x
    label: X
    url: https://x.com/marta_ejemplo

### content/positioning.yaml
statement:
  en: Data engineer building reliable pipelines for public health teams.
  es: Ingeniera de datos que construye pipelines confiables para equipos de salud pública.

### content/projects.yaml
- id: proj-openvax
  name: OpenVax Dashboard
  status: active
  description:
    en: Public dashboard of anonymized vaccination coverage by region, refreshed nightly.
    es: Panel público de cobertura de vacunación anonimizada por región, actualizado cada noche.
  links:
    - https://github.com/marta-ejemplo/openvax
  keywords: [data engineering, public health, open data]

### content/skills.yaml
- name: Data Engineering
  level: expert
  keywords: [ETL, SQL, pipelines, dbt]
  platformWeights: { github-readme: 1.0, linkedin: 0.9 }
- name: Public Health Data
  level: advanced
  keywords: [registries, anonymization, open data]
  platformWeights: { github-readme: 0.8, linkedin: 0.7 }

