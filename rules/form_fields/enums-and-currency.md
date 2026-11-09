---
id: form.enums-currency
version: 1
scope: field
field_types: [enum, currency, number]
regions: [global]
industries: []
severity: info
direction: normalize
evidence: high
source: ["ISO 4217:2015", "CLDR", "Unicode CLDR boolean vocabulary"]
---

# Enums & Currency Rule Pack

## 1. Applicable Scope

Three highly isomorphic sub-problems are merged into one pack because they share the same mechanism: **folding free-form input into a limited set of standard values**.

- Currency fields (currency code, amount, currency symbol)
- Boolean fields (是/否, enabled/disabled)
- Status/type enums (active/inactive, 草稿/已发布/已归档)

## 2. Validation / Normalization Logic

**2.1 Currency Codes**

The standard form is the ISO 4217 three-letter uppercase code: `USD`, `CNY`, `EUR`, `JPY`.

```
^[A-Z]{3}$
```

and must exist in the current ISO 4217 list (about 180). Three high-frequency traps:

| Trap | Note |
| :--- | :--- |
| `RMB` | not an ISO code; `CNY` is. But systems within China heavily use `RMB`; map rather than error |
| `CNH` | offshore RMB, not an ISO 4217 code, but a market convention; treat as `CNY` and flag |
| `BTC` / `USDT` | not an ISO 4217 legal-tender code. In financial scenarios keep the original value and flag `non_iso_currency` |

**2.2 Binding Amounts to Currencies**

The amount column must appear paired with a currency column. If an amount column exists but no currency column:
- Column name or header contains a symbol (`$`, `¥`, `€`) → extract the symbol as the currency
- No clue at all → `warning: currency_unspecified`, **do not default to USD**

Parsing order for amounts with symbols:

```
1. Extract symbol: $ € £ ¥ ₩ ₹ ₽ ₺ ₪ ₫ ₴ ₦ ₱ ฿
2. Disambiguate '$': USD / CAD / AUD / HKD / SGD / NZD / MXN all use '$'
   → Cannot be determined from '$' alone; must combine with region or user declaration
3. Extract code: 3 letters before or after the number
4. Extract parentheses / trailing minus → symbol
5. Parse the remainder per the numbers-and-text pack
```

`¥` is also ambiguous (CNY / JPY); must be judged by region, do not default.

**2.3 Boolean Vocabulary (multi-language folding)**

| True values | False values |
| :--- | :--- |
| `true` `True` `TRUE` `yes` `Yes` `Y` `y` `1` `on` `ON` `enabled` `active` | `false` `False` `FALSE` `no` `No` `N` `n` `0` `off` `OFF` `disabled` `inactive` |
| `是` `真` `启用` `有效` `开` `有` | `否` `假` `停用` `无效` `关` `无` |
| `ja` `si` | `nein` `ne` |
| `oui` `vrai` | `non` `faux` |

**Do not accept**: `maybe`, `unknown`, `待定`, `null` as boolean values → convert to empty and flag. A third value appearing in a binary field indicates a faulty field-semantics definition; it should be flagged rather than forcibly folded.

**2.4 Standard Skeleton for Status Enums**

Most business status fields can be grouped into a few skeletons; the concrete values are declared by the workspace:

| Skeleton | Typical values | Note |
| :--- | :--- | :--- |
| Lifecycle | `draft` → `pending` → `approved` → `active` → `archived` | order is meaningful and can be used for consistency checks |
| Enabled state | `active` / `inactive` / `disabled` / `suspended` | do not compress three-or-more states into a boolean |
| Payment state | `unpaid` / `partial` / `paid` / `refunded` / `void` | core of financial reconciliation |
| Fulfillment state | `pending` / `shipped` / `delivered` / `returned` / `cancelled` | logistics core |

**Key rule**: the status-enum mapping table must be **workspace-overridable data**, not hard-coded. Different organizations' `approved` and `verified` may be semantically opposite.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `rmb` | `CNY` (and mark source as `RMB`) | non-ISO code |
| `RMB 1,234.00` | `CNY` + `1234.00` | code and amount separated |
| `¥1,234` (no region) | TBD + warning | ¥ can be CNY or JPY |
| `$` (no region) | TBD + warning | $ corresponds to at least 7 currencies |
| `1234` (no currency column) | `1234` + `currency_unspecified` | do not default to USD |
| `USD1,234.56` | `USD` + `1234.56` | code stuck together |
| `1.234,56 EUR` | `EUR` + `1234.56` | code suffixed + European decimal |
| `EURO`, `欧元`, `€` | `EUR` | name/symbol → code |
| `Yes` → boolean | `true` | vocabulary folding |
| `是` → boolean | `true` | Chinese vocabulary |
| `maybe` → boolean | empty + flag | third value, semantic error |
| `ACTIVE` | `active` | case normalization (confirm workspace convention) |
| `已审批` / `Approved` / `APPROVED` | `approved` | multi-language + case |
| `N/A` → boolean | empty (null) | placeholder is not false |
| `-1` → boolean | empty + flag | some systems use -1 to mean true; confirm with user |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `RMB`, `人民币`, `元`, `￥`, `¥` (China context) | `CNY` | symbol ambiguity resolved by region |
| `US$`, `$USD`, `美元`, `美金` | `USD` | |
| `EURO`, `EUR€`, `欧罗` | `EUR` | |
| `日元`, `円`, `JPY` | `JPY` | if `¥` under CNY context also appears, it must be distinguished |
| `HK$`, `港币`, `HKD` | `HKD` | |
| `NT$`, `新台币` | `TWD` | note: unrelated to any political sensitivity of CNY; this is purely a code mapping |
| `真`/`是`/`Y` | `true` | |
| `假`/`否`/`N` | `false` | |
| `待定`/`TBD`/`unknown` | empty (null) | |

> **needs human confirmation**: the ISO 4217 list is periodically amended/retired (e.g. `HRK` was replaced by `EUR` in 2023); it is recommended that the implementation layer maintain a code table with effective dates, rather than writing the full table into Markdown.
