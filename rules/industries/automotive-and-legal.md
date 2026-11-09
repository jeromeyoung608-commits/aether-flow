---
id: industry.auto-legal
version: 1
scope: industry
field_types: [identifier, code, text]
regions: [global]
industries: [automotive, legal]
severity: warning
direction: both
evidence: medium
source: ["ISO 3779 (VIN)", "49 CFR 565", "ECLI standard", "Chinese Court Case Number Rules"]
---

# Automotive & Legal Rule Pack

## 1. Applicable Scope

The two industries have highly similar field shapes — both are "strongly structured identifiers + large amounts of free-text titles" — so they are merged.

- Automotive: VIN, license plate, engine number
- Legal: case number, party titles, court name, electronic case identifier

## 2. Validation / Normalization Logic

**2.1 VIN (Vehicle Identification Number, ISO 3779)**

```regex
^[A-HJ-NPR-Z0-9]{17}$
```

**Excludes `I`, `O`, `Q`** (to avoid confusion with 1 and 0); this is VIN's first hard rule and the most frequent source of errors.

Structure:

| Position | Meaning |
| :--- | :--- |
| 1–3 | WMI (World Manufacturer Identifier, world manufacturer code) |
| 4–8 | VDS (vehicle description section) |
| 9 | **check digit** (0–9 or X) |
| 10 | model year |
| 11 | assembly plant code |
| 12–17 | production serial number |

**2.2 VIN Check Digit Algorithm (9th character)**

```
Letter-to-number transliteration:
A=1 B=2 C=3 D=4 E=5 F=6 G=7 H=8
J=1 K=2 L=3 M=4 N=5 P=7 R=9
S=2 T=3 U=4 V=5 W=6 X=7 Y=8 Z=9
(I / O / Q are excluded; note J=1, P=7, R=9 are the three most error-prone)
Digits keep their own value

Weights (positions 1–17):
8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2
Position 9 weight is 0

S = Σ(value × weight)
S mod 11
Remainder 10 → check digit is "X", otherwise the remainder itself
```

**Note:** `P=7` is the only mapping that breaks the "alphabetical increment" pattern (because after skipping O, P inherits R's previous value); it is the most frequently mis-implemented item.

**2.3 VIN Model Year Code (10th character)**

| Code | Year | Code | Year |
| :--- | :--- | :--- | :--- |
| A | 2010 | N | 2022 |
| B | 2011 | P | 2023 |
| C | 2012 | R | 2024 |
| D | 2013 | S | 2025 |
| E | 2014 | T | 2026 |
| F | 2015 | V | 2027 |
| G | 2016 | W | 2028 |
| H | 2017 | X | 2029 |
| J | 2018 | Y | 2030 |
| K | 2019 | 1–9 | 2031–2039 |
| L | 2020 | — | — |
| M | 2021 | — | — |

**Excludes `I`, `O`, `Q`, `U`, `Z`.** 30-year cycle (starting 1980, second cycle from 2010), so a single character alone cannot determine whether it is 2010 or 1980 — other fields (e.g. registration date) are needed for disambiguation.

**2.4 License Plate**

**insufficient evidence — manual enrichment suggested.** License plate formats vary enormously across countries (China `京A·12345`, different US states, different European countries) and change with policy. This pack does not provide a unified regex, only a normalization policy:

- Compare after removing spaces and separators (`京A·12345` and `京A12345` treated as identical)
- Keep the original display form for presentation
- Chinese province abbreviations (`京`, `沪`, `粤`...) require a mapping table, which can be supplied by `region.cn`

**2.5 Chinese Court Case Number**

```regex
^（?\(?\d{4}\)?）?[\u4e00-\u9fa5]{1,3}\d{2,6}([\u4e00-\u9fa5]{1,4})?\d{1,6}号$
```

Actual structure: `(year)` + court code + case-type code + serial number, terminated by the literal character 号.

Example: `(2024)京0105民初12345号`

- Parentheses may be full-width `（）` or half-width `()` and must be normalized
- Court code includes province/city abbreviation + district code (e.g. `京0105` is Chaoyang District)
- Case-type codes: `民初`, `民终`, `刑初`, `执`, `行初`, etc.

**2.6 ECLI (European Case Law Identifier)**

```regex
^ECLI:[A-Z]{2}:[A-Z0-9]{2,7}:\d{4}:[A-Z0-9]{1,25}$
```

Structure: `ECLI:country-code:court-code:year:serial`. Example: `ECLI:NL:HR:2024:123`

**2.7 Party Titles (Legal Documents)**

| Chinese | English | Note |
| :--- | :--- | :--- |
| 原告 | Plaintiff / Claimant | Claimant is mostly used in Commonwealth |
| 被告 | Defendant | |
| 上诉人 | Appellant | |
| 被上诉人 | Appellee / Respondent | Respondent commonly used in Commonwealth |
| 申请人 | Applicant / Petitioner | |
| 被申请人 | Respondent | different scenario from Appellee |
| 第三人 | Third Party | |
| 被执行人 | Person Subject to Enforcement | specific to Chinese enforcement proceedings |

**Roles are structured fields, not tags.** `Plaintiff` and `Defendant` are not interchangeable, and a single case may have multiple plaintiffs. Storing roles as free text breaks downstream statistics.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `1HGCM82633A004352` | valid (if check passes) | classic 17-digit example |
| `1HGCM82633A00435I` | reject | contains `I` |
| `1HGCM82633A00435O` | reject | contains `O` |
| `1hgcm82633a004352` | `1HGCM82633A004352` | normalize to uppercase |
| `1HGCM82633A004352 ` | strip spaces | |
| `1HGCM8263XA004352` | 9th char must be digit or X | `X` is a valid check digit |
| `1HGCM82633A004352` (9th char should be X) | reject | check digit mismatch |
| `(2024)京0105民初12345号` | valid | |
| `（2024）京0105民初12345号` | normalize to half/full-width (pick one) | mixed full/half-width parentheses |
| `2024京0105民初12345号` | add parentheses | missing year parentheses |
| `ECLI:NL:HR:2024:123` | valid | |
| `ecli:nl:hr:2024:123` | normalize to uppercase | |
| `原告` ←→ `被告` swapped | reject | roles are not interchangeable |
| `1st party` / `第一方` | `third_party` is an error | semantic confusion |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `车架号`, `VIN`, `底盘号` | `vin` | 17 digits |
| `发动机号`, `Engine No.` | `engine_no` | **no unified format**; not validated |
| `车牌`, `号牌`, `License Plate` | `plate` | no unified format |
| `案号`, `案件编号` | `case_no` | Chinese format see 2.5 |
| `原告` / `Plaintiff` / `申请人` | `plaintiff` / `applicant` | different procedures use different titles; cannot be force-merged |
| `被告` / `Defendant` / `被申请人` | `defendant` / `respondent` | same as above |
| `本院`, `this court` | replace with the actual court name | leftover from document template |

> **needs human confirmation**: License plate formats, engine number rules, and case-number formats of each country have no global standard; they must be added per target market and should not be hard-coded all at once.
