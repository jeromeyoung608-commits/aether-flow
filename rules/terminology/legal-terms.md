---
id: term.legal
version: 1
scope: industry
field_types: [text, enum]
regions: [global]
industries: [legal]
severity: warning
direction: normalize
evidence: medium
source: ["China court cause-of-action regulations", "ECLI standard", "Commonwealth court document conventions"]
---

# Legal Terminology Normalization Pack

## 1. Applicable Scope

Text fields in case-management systems, contract ledgers, and law-firm systems: party designations, court names, cause of action, document types.

**Core risk**: "synonyms" in legal text are often **legally distinct** concepts. `判决书` (judgment) and `裁定书` (ruling) are not the same instrument; `原告` (plaintiff) and `申请人` (claimant) cannot be interchanged across procedures. The default strategy is therefore **conservative normalization + mandatory human confirmation for high-risk items**.

## 2. Validation / Normalization Logic

**2.1 Party designations (procedure-specific; do not merge across procedures)**

| Procedure | Chinese | English | Note |
| :--- | :--- | :--- | :--- |
| Civil litigation, first instance | 原告 / 被告 | Plaintiff / Defendant | |
| Civil litigation, second instance | 上诉人 / 被上诉人 | Appellant / Appellee | Commonwealth uses Respondent |
| Arbitration | 申请人 / 被申请人 | Claimant / Respondent | note: differs from litigation |
| Administrative litigation | 原告 / 被告 | Plaintiff / Defendant | defendant is an administrative authority |
| Enforcement | 申请执行人 / 被执行人 | Applicant / Person Subject to Enforcement | |
| Bankruptcy | 申请人 / 债务人 / 管理人 | Petitioner / Debtor / Administrator | |

**Rule**: normalize only **within the same procedure** (`原告` ↔ `Plaintiff`), **never across procedures** (`原告` ≠ `申请人`).

**2.2 Court names**

Normalization target: administrative division + court tier + "People's Court" (人民法院).

Example: `北京市朝阳区人民法院` (Beijing Chaoyang District People's Court).

| Variant | Note |
| :--- | :--- |
| `朝阳法院` | tier & division omitted; needs completion |
| `北京市朝阳区法院` | omits "People's" (人民) |
| `北京朝阳法院` | omits "City" (市) / "District" (区) |
| `Beijing Chaoyang District People's Court` | English form |

**Do not**: store `北京市高级人民法院` simplified to `北京高院`. An abbreviation can mean different things in different contexts (`高院` appears at both provincial and municipal level). Abbreviations are for display/search only.

**2.3 Cause of action (案由)**

Cause of action is hierarchical (level-1 → level-2 → level-3) and **versions differ between old and new**. Examples:

- `劳动争议` (level-1) → `劳动合同纠纷` (level-2)
- `买卖合同纠纷` → `房屋买卖合同纠纷` (sub-division)

Rules:

- Only normalize aliases **within the same level** (`劳动纠纷` → `劳动争议`).
- Do not merge across levels (keep fine granularity).
- Cause-of-action version must be declared (e.g. "per the 2020 cause-of-action rules"); otherwise the same name means different things in different years.

**2.4 Document types**

| Standard | Variant | Note |
| :--- | :--- | :--- |
| `判决书` | `Judgment`, `民事判决书`, `刑事判决书` | disposes of the merits |
| `裁定书` | `Order`, `Ruling` | procedural matters |
| `调解书` | `Mediation Agreement`, `Settlement` | **enforceable**; differs from a settlement agreement |
| `决定书` | `Decision` | |
| `通知书` | `Notice` | |
| `起诉状` | `Complaint`, `Petition` | filed by a party, not a court document |

**`判决书` ≠ `裁定书` ≠ `调解书`** — their legal effects differ; do not collapse them into `judgment`.

**2.5 Contract types**

| Standard | Variant |
| :--- | :--- |
| `服务合同` | `Service Agreement`, `服务协议`, `技术服务合同` |
| `买卖合同` | `Sales Contract`, `Purchase Agreement`, `购销合同` |
| `租赁合同` | `Lease`, `Lease Agreement`, `房屋租赁合同` |
| `借款合同` | `Loan Agreement`, `借贷合同` |
| `保密协议` | `NDA`, `Non-Disclosure Agreement`, `保密协定` |

**Note**: `采购合同` (purchase) and `销售合同` (sales) are the two ends of one transaction, **not synonyms**. The same contract is called "purchase" in the buyer's system and "sales" in the seller's; merging them creates double counting.

**2.6 Amount and currency expressions**

Amounts in legal text often appear both as Chinese capital figures (`人民币壹佰贰拾万元整`) and Arabic numerals.

- Capital figures are used on instruments and contracts; **do not auto-generate** (requires a strict capitalization algorithm).
- On validation: if both capital and Arabic forms exist, perform a **consistency check** (they must be equal); on mismatch flag `error`.
- Normalization only handles the Arabic form; the capital form is kept as-is.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `劳动纠纷` | `劳动争议` | same-level alias |
| `劳动合同纠纷` → `劳动争议` | keep fine granularity; add parent field | cross-level; do not merge |
| `朝阳法院` | `北京市朝阳区人民法院` | needs completion; do not guess omitted parts |
| `BEIJING CHAOYANG DISTRICT PEOPLE'S COURT` | `Beijing Chaoyang District People's Court` | case normalization |
| `判决书` ←→ `裁定书` | reject merge | different legal effect |
| `调解书` → `Settlement` | `Mediation Agreement` | Settlement often means a standalone accord; the two differ |
| `原告` ←→ `申请人` | reject merge | different procedure |
| `NDA` | `Non-Disclosure Agreement` | abbreviation expansion |
| `采购合同` ←→ `销售合同` | reject merge | different perspective, not the same concept |
| capital `壹佰万元整` vs Arabic `1000000` | consistent | needs consistency check |
| capital `壹佰万元整` vs Arabic `100000` | `error` | one zero short; must raise error |
| `本院` | replace with the actual court | template residue |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `原告`, `Plaintiff`, `原诉人` | `plaintiff` | civil litigation only |
| `被告`, `Defendant` | `defendant` | |
| `上诉人`, `Appellant` | `appellant` | |
| `被上诉人`, `Appellee`, `Respondent` | `appellee` | |
| `申请人`, `Claimant`, `Petitioner` | `claimant` (arbitration) / `petitioner` (other) | distinguish by procedure |
| `第三人` | `third_party` | |
| `被执行人` | `enforcement_target` | |
| `案由`, `案件类型` | `cause_of_action` | note: `案件类型` means civil/criminal in some systems |
| `民事` / `刑事` / `行政` / `执行` | `civil` / `criminal` / `administrative` / `enforcement` | top-level classification |
| `一审` / `二审` / `再审` | `first_instance` / `second_instance` / `retrial` | procedural stage |

> **needs human confirmation**: court full names, cause-of-action hierarchy, and document types strongly depend on jurisdiction and year/version; **insufficient evidence — manual enrichment suggested** for the complete mapping of the target jurisdiction.
> **needs human confirmation**: the generation and validation algorithm for Chinese capital amounts (handling of "零", consecutive zeros, 万/亿 carry) should be an independent implementation tested separately; this rule pack only describes the consistency requirement.
