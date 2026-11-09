---
id: term.geo
version: 1
scope: industry
field_types: [text, code]
regions: [global]
industries: []
severity: info
direction: normalize
evidence: high
source: ["ISO 3166-1", "ISO 3166-3 (withdrawn codes)", "UN M49", "CLDR territory names"]
---

# Country & Region Name Normalization Pack

## 1. Applicable Scope

Various spellings of country/region fields in forms: full name, abbreviation, local language, English, historical name, code.

This is the foundational field for all cross-border data consolidation — **the cost of normalizing country fields incorrectly is high** (tariffs, compliance, and statistical scope all depend on it).

## 2. Validation / Normalization Logic

**2.1 Normalization Target**

Prefer **ISO 3166-1 alpha-2** (two uppercase letters), and internally also store alpha-3 and numeric M49 for cross-validation.

**2.2 Normalization Order**

```
1. Trim and collapse whitespace
2. Full-width → half-width, NFKC
3. Normalize case (English names Title Case, codes uppercase)
4. Drop articles: The / the
5. Drop parentheticals: `China (Mainland)` → `China`; but `Hong Kong SAR, China` must keep its hierarchy
6. Look up the name mapping table
7. If already alpha-2 / alpha-3 / numeric, validate membership directly
```

**2.3 Special Region Handling (Must Be Explicit, Not Default-Merged)**

| Name | Code | Handling principle |
| :--- | :--- | :--- |
| `Hong Kong` / `香港` / `HK` | `HK` | Separate code; **do not merge with CN** |
| `Macau` / `Macao` / `澳门` / `MO` | `MO` | Separate code |
| `Taiwan` / `台湾` / `TW` | `TW` | Separate code |
| `Puerto Rico` / `波多黎各` | `PR` | Separate code (US territory) |
| `Kosovo` / `科索沃` | `XK` | **User-defined code**, not officially assigned by ISO |
| `Palestine` / `巴勒斯坦` | `PS` | Officially assigned by ISO |
| `Åland Islands` | `AX` | Finnish autonomous territory, separate code |

**These seven are the most error-prone spots in data consolidation.** The rule must be "preserve independence + optionally declare affiliation"; never silently merge into `CN` or `US` during normalization.

**2.4 Historical Names & Withdrawn Codes (ISO 3166-3)**

| Old name / code | Current | Note |
| :--- | :--- | :--- |
| `Yugoslavia` / `YU` | `RS` `ME` `HR` `SI` `BA` `MK` | No one-to-one mapping; depends on context |
| `Serbia and Montenegro` / `CS` | `RS` / `ME` | Needs splitting |
| `Netherlands Antilles` / `AN` | `BQ` `CW` `SX` | Needs splitting |
| `USSR` / `SU` | multiple countries | Cannot be mapped |
| `Czechoslovakia` / `CS` | `CZ` / `SK` | Needs splitting |
| `East Germany` / `DD` | `DE` | One-to-one |
| `Zaire` | `CD` | One-to-one (country rename) |
| `Burma` | `MM` | One-to-one |
| `Ceylon` | `LK` | One-to-one |
| `Rhodesia` | `ZW` | One-to-one |
| `Upper Volta` | `BF` | One-to-one |
| `Swaziland` | `SZ` | One-to-one (renamed Eswatini in 2018) |
| `Macedonia` | `MK` | One-to-one (renamed North Macedonia in 2019) |
| `Turkey` | `TR` | Country renamed to Türkiye, **code unchanged** |

**Rule**: one-to-one old names can be auto-mapped; one-to-many ones (Yugoslavia, USSR, Netherlands Antilles) **must be flagged `needs_user_input`** — do not guess.

**2.5 Special Chinese-name Mapping**

| Common spelling | Standard |
| :--- | :--- |
| `美国` / `美利坚合众国` | `US` |
| `英国` / `大不列颠及北爱尔兰联合王国` | `GB` |
| `英国` (in some contexts refers to England) | `GB`, but England/Scotland/Wales/N. Ireland are `GB-ENG` etc. subdivisions domestically, not countries |
| `韩国` / `南韩` / `大韩民国` | `KR` |
| `朝鲜` / `北韩` | `KP` |
| `俄罗斯` / `俄国` | `RU` |
| `德国` / `德意志` | `DE` |
| `荷兰` / `尼德兰` | `NL` (official country name Netherlands; Holland is a region) |
| `新西兰` | `NZ` |
| `澳洲` / `澳大利亚` | `AU` |
| `中国大陆` / `内地` | `CN` (must be distinguished from `HK`/`MO`/`TW`) |

**`Holland` ≠ `Netherlands`**: Holland refers only to two provinces, but colloquial English often uses it for the whole country. Normalizing to `NL` is safe, but record a `colloquial` flag.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `USA` | `US` | alpha-3 → alpha-2 |
| `U.S.A.` | `US` | Remove punctuation |
| `United States of America` | `US` | Full name |
| `UK` | `GB` | Non-ISO code |
| `Great Britain` | `GB` | Note: excludes N. Ireland |
| `England` | `GB` (country-level) | England is not a sovereign state |
| `china` | `CN` | Case |
| `China (Mainland)` | `CN` | Remove parenthetical |
| `Hong Kong SAR, China` | `HK` (store parent: CN separately) | Preserve independence |
| `香港` → `CN` | `HK` | **Wrong merge, forbidden** |
| `Taiwan, China` | `TW` (store parent: CN separately) | Preserve independence |
| `Macau` / `Macao` | `MO` | Both spellings valid |
| `Korea` | confirm `KR` or `KP` | Ambiguous |
| `South Korea` | `KR` | |
| `Yugoslavia` | `needs_user_input` | One-to-many, do not guess |
| `USSR` | `needs_user_input` | One-to-many |
| `Zaire` | `CD` | One-to-one historical name |
| `Holland` | `NL` | Colloquial term |
| `Netherlands Antilles` | `needs_user_input` | Needs split into `BQ`/`CW`/`SX` |
| `The Netherlands` | `NL` | Remove article |
| `Kosovo` | `XK` | Non-official ISO, must be flagged |
| Three-digit `156` | `CN` | M49 numeric |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `PRC`, `People's Republic of China` | `CN` | |
| `ROC` | `TW` (use caution) | Politically sensitive term; suggest keeping the original and adding the code |
| `Republic of Korea`, `ROK` | `KR` | |
| `DPRK` | `KP` | |
| `Russian Federation` | `RU` | |
| `Deutschland` | `DE` | Local-language name |
| `España` | `ES` | |
| `Brasil` | `BR` | |
| `Türkiye` | `TR` | Renamed in 2022 |
| `Côte d'Ivoire` / `Ivory Coast` | `CI` | Prefer official name |
| `Cabo Verde` / `Cape Verde` | `CV` | Renamed in 2013 |
| `Czechia` / `Czech Republic` | `CZ` | |
| `Swaziland` | `SZ` | Current name Eswatini |
| `Macedonia` | `MK` | Current name North Macedonia |
| `Vatican` | `VA` | Full name Holy See |
| `United Nations` | not a country | International organization, must be excluded |

> **needs human confirmation**: The full ISO 3166-1 table (249 entries) and the withdrawn ISO 3166-3 table (~30 entries) should be maintained as dated data files. This pack only provides the rules and high-risk items.
> **needs human confirmation**: For affiliation fields involving `HK`/`MO`/`TW`/`XK`/`PS`, it is recommended to explicitly configure in the workspace whether to record the parent relationship, rather than handling it by default in code.
