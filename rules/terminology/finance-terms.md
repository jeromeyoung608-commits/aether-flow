---
id: term.finance
version: 1
scope: industry
field_types: [text, enum]
regions: [global]
industries: [finance]
severity: info
direction: normalize
evidence: medium
source: ["IFRS taxonomy labels", "ISO 20022 message element names", "common corporate entity suffix conventions"]
---

# Finance Terminology Normalization Pack

## 1. Applicable Scope

Alias folding for **text fields** such as account names, counterparty names, debit/credit direction, and fiscal periods.

This pack addresses the problem of "the same concept having ten spellings in an exported file" — it is the largest hidden cost in financial data consolidation and often surfaces only during month-end reconciliation.

## 2. Validation / Normalization Logic

**2.1 Account Aliases (High-frequency Core Accounts)**

| Standard name | Common variants |
| :--- | :--- |
| `Accounts Receivable` | `AR`、`A/R`、`Receivables`、`应收账款`、`应收帐款` (variant character 「帐」)、`应收` |
| `Accounts Payable` | `AP`、`A/P`、`Payables`、`应付账款`、`应付帐款` |
| `Cash and Cash Equivalents` | `Cash`、`现金及现金等价物`、`货币资金`、`银行存款` |
| `Inventory` | `Stock`、`存货`、`库存`、`原材料`、`在制品` |
| `Fixed Assets` | `PP&E`、`Property Plant and Equipment`、`固定资产` |
| `Revenue` | `Sales`、`Turnover`、`营业收入`、`主营业务收入`、`销售收入` |
| `Cost of Goods Sold` | `COGS`、`Cost of Sales`、`营业成本`、`销售成本` |
| `Operating Expenses` | `OPEX`、`OpEx`、`期间费用`、`营业费用` |
| `Retained Earnings` | `未分配利润`、`留存收益` |
| `Equity` | `Owner's Equity`、`Shareholders' Equity`、`所有者权益`、`股东权益` |

**Key rule: alias mapping must be unidirectional (variant → standard), and the mapping table must be overridable by the workspace.** Because `Revenue` and `Turnover` have different scopes under some standards (Turnover sometimes means net amount), automatic merging causes reporting-scope drift.

**2.2 Legal Entity Suffixes**

| Standard suffix | Variant | Jurisdiction |
| :--- | :--- | :--- |
| `Co., Ltd.` | `Company Limited`、`有限公司`、`有限责任公司`、`Ltd`、`LTD` | China / Commonwealth |
| `Inc.` | `Incorporated`、`Corp.`、`Corporation` | United States |
| `LLC` | `L.L.C.`、`Limited Liability Company` | United States |
| `GmbH` | `Gesellschaft mit beschränkter Haftung` | Germany |
| `S.A.` | `Société Anonyme`、`S.A.` | France / Spain / Latin America |
| `B.V.` | `Besloten Vennootschap` | Netherlands |
| `Pte. Ltd.` | `Private Limited` | Singapore |
| `股份有限公司` | `股份公司`、`Co., Ltd.` (often misused in Chinese context) | China |
| `PLC` | `Public Limited Company` | United Kingdom |

**Do not rewrite entity names uniformly.** `XX有限公司` and `XX股份有限公司` are two different legal entities; rewriting would break entity recognition. Only perform **auxiliary normalization during deduplication comparison** (ignore the suffix when comparing) and keep the original value for display.

**2.3 Debit / Credit Direction**

| Variant | Standard |
| :--- | :--- |
| `Debit`、`DR`、`Dr`、`借`、`借方`、`D` | `debit` |
| `Credit`、`CR`、`Cr`、`贷`、`贷方`、`C` | `credit` |

**Directional semantics must not be lost**: storing both `debit` and `credit` as positive numbers with a separate field for direction is the only correct approach; storing credit as a negative number causes errors in multi-standard consolidation.

**2.4 Fiscal Periods**

| Variant | Standard |
| :--- | :--- |
| `FY2024`、`FY24`、`2024财年`、`2024年度` | `FY2024` |
| `Q1 2024`、`2024Q1`、`2024年一季度` | `2024-Q1` |
| `H1 2024`、`2024上半年` | `2024-H1` |
| `2024-01`、`202401`、`2024年1月` | `2024-01` |

**Key trap**: a fiscal year is not the same as a calendar year. For most companies `FY2024` is 2023-04 to 2024-03 or 2023-07 to 2024-06. **The mapping between the "FY" label and the concrete date range must be declared by the workspace; the rule pack cannot assume it.**

**2.5 Counterparty Names**

Normalization order (for deduplication comparison only, does not change the display value):

```
1. Full-width → half-width
2. Trim leading/trailing whitespace, collapse consecutive spaces
3. Normalize parentheses to half-width
4. Strip legal suffixes (see 2.2)
5. Strip common prefixes: The / municipal/province prefixes such as 「XX市」「XX省」
6. Case-fold Latin letters to uppercase
```

**Do not**: remove words like `集团`, `控股`, `科技`, `实业`. They are part of entity differentiation (`XX集团` and `XX科技` are two different companies).

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `应收帐款` | `应收账款` | Variant character 帐 → 账 |
| `A/R` | `Accounts Receivable` | Abbreviation expansion |
| `AR` (in medical column) | kept | Context mismatch; must be declared per industry |
| `主营业务收入` → `Revenue` | keep `主营业务收入` | Only add a `standard_name: Revenue` auxiliary field; do not change the original value |
| `XX有限公司` → `XX股份有限公司` | not rewritten | Different legal entities |
| `XX CO LTD` | normalized to `XX` during comparison | Only during deduplication |
| `Dr` / `借` | `debit` | |
| `-100` (means 贷方) | `100` + `credit` | Separate direction from amount |
| `FY24` | `FY2024` | |
| `2024年一季度` | `2024-Q1` | |
| `202401` | `2024-01` | |
| `Turnover` → `Revenue` | flag as needs confirmation | Scope may differ |
| `The ABC Company` | `ABC` during comparison | Remove article |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `COGS`, `Cost of Sales` | `cost_of_goods_sold` | |
| `OPEX`, `OpEx` | `operating_expenses` | |
| `PP&E` | `fixed_assets` | |
| `EBITDA` | kept | Large differences in calculation scope; do not expand |
| `应收账款周转天数`, `DSO` | `days_sales_outstanding` | |
| `应付账款周转天数`, `DPO` | `days_payable_outstanding` | |
| `现金循环周期`, `CCC` | `cash_conversion_cycle` | |
| `预收账款` / `合同负债` | different standards; **do not auto-merge** | IFRS 15 vs. legacy-standard difference |
| `其他应收款` / `其他应付款` | `other_receivables` / `other_payables` | Opposite direction; must not be mixed |

> **needs human confirmation**: The account-alias table heavily depends on accounting standards (CAS / IFRS / US GAAP) and industry; **insufficient evidence — manual enrichment suggested** for the account mapping table of each target market.
> **needs human confirmation**: The scope relationship of `Revenue` / `Turnover` / `Net Sales` must be confirmed against the standard before deciding whether to merge.
