---
id: region.cn
version: 1
scope: region
field_types: [identifier, phone, number]
regions: [CN]
industries: []
severity: error
direction: both
evidence: high
source: ["GB 11643-1999", "GB 32100-2015", "GB/T 2260", "MIIT numbering plan"]
---

# China Region Rule Pack

## 1. Applicable Scope

Workspaces declared as the mainland-China region. Covered fields: resident ID, corporate entities, mobile, landline, postcode, invoice codes, bank cards.

**Must be enabled by explicitly declaring `region: CN` at column or workspace level.** Applying this pack without that declaration misclassifies many non-Chinese numbers as errors.

## 2. Validation / Normalization Logic

**2.1 Resident ID number — 居民身份证号 (GB 11643-1999, 18 digits)**

Structure: 6-digit administrative division + 8-digit birth date + 3-digit sequence + 1 check digit.

```regex
^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$
```

Checksum algorithm:

```
weights W = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
S = Σ(first 17 digits × corresponding weight)
remainder r = S mod 11
check-digit table = "10X98765432"
the 18th digit must equal check-digit table[r]
```

Additional checks (flagged even if not failed):

- Digits 7–14 must be a **real date** (incl. leap-year check).
- The first 2 digits (province code) must be within the current valid GB/T 2260 range (11–82, plus 71/81/82/91).
- 17th digit odd = male, even = female (consistency reference only, not a hard check).
- Birth date must not be later than today and not earlier than 1900-01-01.

**2.2 Unified Social Credit Code — 统一社会信用代码 (GB 32100-2015, 18 digits)**

Structure: 1 digit registration authority + 1 digit entity type + 6 digits administrative division + 9 digits entity ID + 1 check digit.

Character set (**31 chars**): `0-9` and `A-H J-N P-R T-U W-Y` (**excluding I, O, S, V, Z**).

```regex
^[0-9A-HJ-NP-RT-UW-Y]{18}$
```

Checksum algorithm:

```
char values: 0-9 → 0-9; A=10,B=11,C=12,D=13,E=14,F=15,G=16,H=17,
        J=18,K=19,L=20,M=21,N=22,P=23,Q=24,R=25,T=26,U=27,W=28,X=29,Y=30
weights W[i] = 3^(i-1) mod 31, i = 1..17
   = [1,3,9,27,19,26,16,17,20,29,25,13,8,24,10,30,28]
S = Σ(first 17 char values × W[i])
r = S mod 31
check digit = (31 - r) mod 31; if the result is 31, use 0
the 18th digit must equal this value (digit 0-9 or the corresponding letter)
```

Common mistake: treating the legacy 9-digit "organization code" (组织机构代码) as this field. Its check rule differs (GB 11714) and it has been merged into USCC; prompt the user to use the 18-digit code.

**2.3 Mobile number — 手机号**

```regex
^1[3-9]\d{9}$
```

- Exclude numbers starting with `10`, `11`, `12` (landline/service ranges).
- IoT ranges starting with `14` exist but are rare in forms; flag `warning` rather than `error`.
- Number ranges change over time; **do not hardcode a specific range table** — only validate structure.

**2.4 Fixed-line telephone — 固话**

```regex
^(0\d{2,3}-?)?\d{7,8}(-\d{1,6})?$
```

Area code must start with `0`: Beijing `010`, Shenzhen `0755`, county-level cities may be `0xxx`. Extension separated by `-`.

**2.5 Postal code — 邮编**

```regex
^[1-9]\d{5}$
```

6 digits, first digit not 0. Historic 4-digit legacy codes exist and should be flagged `legacy_postcode` rather than hard-rejected.

**2.6 Invoice code and number — 发票**

| Field | Length | Note |
| :--- | :--- | :--- |
| 发票代码 | 10 or 12 digits | 10 digits = legacy; 12 digits = post fully-electronic-invoice reform |
| 发票号码 | 8 digits (legacy) or 20 digits (fully electronic) | Length varies greatly; must be distinguished by year/type |
| 纳税人识别号 | 15 / 18 / 20 digits | 15 digits = legacy tax reg no.; 18 digits = USCC; 20 digits = natural person / special entity |

> These rules depend on tax-system reform milestones; **they change often, marked `evidence: medium`, and should be manually reviewed after each tax-policy update.**

**2.7 Bank card number — 银行卡**

```regex
^62\d{14,18}$
```

`62` prefix = China UnionPay (中国银联). Validation uses the Luhn algorithm (see `industries/finance.md` 2.1). Length 16–19 digits.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `11010119900307123` (17 digits) | complete or reject | insufficient length |
| `110101199003071234` (bad check digit) | correct via algorithm or reject | check digit mismatch |
| `110101199002301234` | reject | Feb 30 does not exist |
| `11010119900307123X` | valid (if check passes) | `X` is a valid check digit; normalize case to uppercase |
| `91350100M000100Y43` | valid (if check passes) | USCC contains letters; do not treat as pure numeric |
| `91350100M000100I43` | reject | contains forbidden letter `I` |
| `1380013800` (10 digits) | reject | mobile must be 11 digits |
| `+86 138 0013 8000` | `13800138000` or `+8613800138000` | either form; must match the workspace convention |
| `0755-12345678` | `0755-12345678` | landline keeps area-code leading 0 (unlike E.164) |
| `7551234567` | `07551234567` | missing area-code leading 0; needs user confirmation |
| `518000` | `518000` | valid postcode |
| `018000` | reject | postcode first digit must not be 0 |
| `6222021234567890123` | valid (Luhn) | 19-digit UnionPay card |
| `组织机构代码 12345678-9` | prompt to switch to 18-digit USCC | legacy code, already merged |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `身份证`、`身份证号`、`ID` | `citizen_id` | field-name semantics normalized |
| `统一社会信用代码`、`信用代码`、`USCC`、`税号` | `uscc` | note: `税号` means the 15-digit legacy code in some contexts |
| `营业执照号`、`注册号` | `uscc` (needs confirmation) | registration number is a 15-digit legacy code, not equivalent to USCC |
| `手机`、`移动电话`、`联系电话` | `mobile` | |
| `座机`、`固话`、`办公电话` | `landline` | |
| `所在省`、`省份`、`省/直辖市` | `province` | |

> **needs human confirmation**: The provincial administrative-division code table (GB/T 2260) changes with administrative adjustments; the implementation should use dated data files rather than hardcoding the first-2-digit range.
