---
id: region.gb
version: 1
scope: region
field_types: [identifier, phone, number]
regions: [GB]
industries: []
severity: error
direction: both
evidence: high
source: ["HMRC NINO guidance", "Royal Mail PAF postcode format", "Companies House", "VocaLink sort code", "UK VAT notice 700"]
---

# United Kingdom Region Rule Pack

## 1. Applicable Scope

Workspaces declared as UK regions; fields involve NINO, postcode, UTR, company registration number, bank sort code, VAT number.

Note: UK comprises four constituent countries (England / Scotland / Wales / Northern Ireland); postcodes and some administrative numbering rules are consistent, but VAT and Companies House prefixes differ.

## 2. Validation / Normalization Logic

**2.1 NINO (National Insurance Number)**

```regex
^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$
```

Letter exclusion notes (**this is the entire difficulty of this rule**):

| Position | Excluded Letters | Reason |
| :--- | :--- | :--- |
| 1st | `D` `F` `I` `Q` `U` `V` `O` | unused |
| 2nd | `D` `F` `I` `O` `Q` `U` `V` | unused (`O` only excluded in the 2nd position) |
| suffix | only `A` `B` `C` `D` | other letters invalid |

Structure: 2 letters + 6 digits + 1 suffix letter.

**2.2 Postcode**

```regex
^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$
```

Structure: `Outward code + Inward code`, with 0–1 optional space between.

The Outward part (area identifier) has only about 120 valid initial letter combinations (`AB, AL, B, BA, BB, BD, BH, BL, BN, BR, BS, BT, CA, CB, CF, CH, CM, CO, CR, CT, CV, CW, DA, DD, DE, DG, DH, DL, DN, DT, DY, E, EC, EH, EN, EX, FK, FY, G, GL, GU, HA, HD, HG, HP, HR, HS, HU, HX, IG, IP, IV, KA, KT, KY, L, LA, LD, LE, LL, LN, LS, LU, M, ME, MK, ML, N, NE, NG, NN, NP, NR, NW, OL, OX, PA, PE, PH, PL, PO, PR, RG, RH, RM, S, SA, SE, SG, SK, SL, SM, SN, SO, SP, SR, SS, ST, SW, SY, TA, TD, TF, TN, TQ, TR, TS, TW, UB, W, WA, WC, WD, WF, WN, WR, WS, WV, YO, ZE`).

If the Outward initial letter combination is not in the above set, mark `warning` rather than `error` (new postcodes are occasionally added).

**2.3 UTR (Unique Taxpayer Reference)**

```regex
^\d{10}$
```

10 pure digits, no check digit. **Only length and character set can be validated, not validity** (validity requires the HMRC system).

**2.4 Companies House Number**

```regex
^(?:\d{8}|[A-Z]{2}\d{6})$
```

- Plain 8-digit number: England & Wales ordinary company
- Letter prefix: `SC` (Scotland), `OC` (LLP), `FC` (overseas), `NC` (Northern Ireland), `NI` (Northern Ireland), `R`/`AP`/`IP` and other special entities

The prefix set expands over time; **maintaining it as a data file is recommended**.

**2.5 Sort Code (bank branch code)**

```regex
^\d{2}-\d{2}-\d{2}$
```

6 digits, usually written `12-34-56`. No check digit; must be validated together with the account number. Normalization: remove spaces and hyphens, then reorder as 2-2-2.

**2.6 UK VAT Number**

```regex
^(GB)?(\d{9}|\d{12})$
```

- Standard: `GB` + 9 digits (or 12 digits, including branch identifier)
- Special prefixes: `GD` (government dept), `HA` (health authority) — these two digits are **not** a country code and must be preserved
- Check digit: weighted sum of first 7 digits with weights `8,7,6,5,4,3,2`; compare `S mod 97` with the last 2 digits (a `+55` variant algorithm exists; most implementations use the basic version)

**2.7 Phone Number**

```regex
^\+44[1-9]\d{8,9}$
```

- Domestic format starts with `0` (`020 7946 0958`); E.164 requires dropping this `0`
- UK number length is not fixed (9–10 digits, excluding country code); cannot be hard-coded to 10 digits
- Starting with `07` is mobile, `01`/`02` is landline, `03` is service number, `08` is special rate, `09` is premium rate

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `AB123456C` | valid | first letter A and second letter B both allowed |
| `DA123456C` | reject | first letter D forbidden |
| `AO123456C` | reject | second letter O forbidden |
| `AB123456E` | reject | suffix can only be A–D |
| `ab123456c` | `AB123456C` | normalize to uppercase |
| `AB 12 34 56 C` | `AB123456C` | remove spaces |
| `SW1A 1AA` | valid | typical London postcode |
| `sw1a1aa` | `SW1A 1AA` | normalize + add space |
| `XX1 1AA` | warning | initial letter combination not in known set |
| `1234567890` → UTR | valid (structure only) | 10 digits |
| `SC123456` | valid | Scottish company |
| `12345678` | valid | ordinary company |
| `12-34-56` | valid | sort code |
| `123456` | `12-34-56` | normalize and add separator |
| `GB123456789` | valid | standard VAT |
| `GB 123 4567 89` | `GB123456789` | remove spaces |
| `GD123` | valid | government prefix |
| `020 7946 0958` | `+442079460958` | remove domestic leading 0 |
| `+44 (0)20 7946 0958` | `+442079460958` | remove `(0)` |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `NI Number`, `NINO`, `National Insurance` | `nino` | |
| `Postcode`, `Post Code`, `邮编` | `postcode` | UK uses postcode, not zip |
| `UTR`, `Unique Taxpayer Reference`, `Self Assessment UTR` | `utr` | different from VAT number |
| `Company Number`, `CRN`, `Company Registration Number` | `companies_house_no` | |
| `Sort Code`, `Bank Sort Code` | `sort_code` | |
| `VAT Number`, `VAT Reg No`, `VAT number` | `vat_gb` | |
| `County` | Note: UK counties largely ceased to be administrative entities after 1998 | retained but not used for validation |

> **needs human confirmation**: The UK postcode Outward initial-letter combination set and the Companies House prefix set both expand over time; maintaining them as a data file with a version date is recommended.
