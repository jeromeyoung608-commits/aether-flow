---
id: term.healthcare
version: 1
scope: industry
field_types: [text, enum]
regions: [global]
industries: [healthcare]
severity: warning
direction: normalize
evidence: medium
source: ["SNOMED CT editorial conventions (public summary)", "HL7 FHIR terminology guidance", "ICD-10 index conventions"]
---

# Healthcare Terminology Normalization Pack

## 1. Applicable Scope

Variant folding for **free-text medical fields** such as diagnosis names, anatomical sites, laterality, and exam-result descriptions.

**Boundary statement (must comply)**: This pack only performs **orthographic variant normalization** (case, abbreviations, full/half-width, word order), and **does not** perform semantic mapping (e.g., mapping `心梗` to ICD-10 `I21.9`). Semantic mapping requires a licensed terminology server, beyond the capability of a local rule pack, and a wrong mapping could cause clinical misjudgment.

## 2. Validation / Normalization Logic

**2.1 Safely Normalizable Orthographic Variants (`severity: info`)**

| Category | Handling |
| :--- | :--- |
| Case | `DIABETES` / `Diabetes` / `diabetes` → unify to title case or all lowercase (workspace choice, pick one) |
| Full/half-width | `Ｄｉａｂｅｔｅｓ` → half-width |
| Extra whitespace | `Type  2   diabetes` → single space |
| Abbreviation expansion | `DM` → `diabetes mellitus` (**only when in an explicit abbreviation table and unambiguous**) |
| Hyphenation | `non-insulin-dependent` / `non insulin dependent` → unify (note: the `non` prefix is not recommended to take a hyphen) |
| Roman numerals | `Type II` / `Type 2` → unify to Arabic numerals (medical convention prefers `Type 2`) |
| Parenthetical content | `Diabetes (type 2)` → whether to merge the parenthetical into the main name requires a workspace convention |

**2.2 Common Abbreviation Table (Unambiguous Part)**

| Abbreviation | Full name | Auto-expandable? |
| :--- | :--- | :--- |
| `DM` | Diabetes Mellitus | Yes (but in ophthalmology/nephrology contexts it still means diabetes; safe) |
| `HTN` | Hypertension | Yes |
| `MI` | Myocardial Infarction | Yes (note: `MI` can mean other things in orthopedics; flag warning) |
| `COPD` | Chronic Obstructive Pulmonary Disease | Yes |
| `CKD` | Chronic Kidney Disease | Yes |
| `CHF` | Congestive Heart Failure | Yes |
| `UTI` | Urinary Tract Infection | Yes |
| `CVA` | Cerebrovascular Accident | Yes |
| `BMI` | Body Mass Index | Yes |
| `HbA1c` | Glycated hemoglobin | Yes |
| `BP` | Blood Pressure | Yes |
| `MS` | Multiple Sclerosis **or** Mitral Stenosis | **No — must be confirmed manually** |
| `PE` | Pulmonary Embolism **or** Physical Examination | **No** |
| `AF` | Atrial Fibrillation **or** Amniotic Fluid | **No** |
| `AS` | Aortic Stenosis **or** Ankylosing Spondylitis | **No** |

**Rule: ambiguous abbreviations are always flagged `needs_user_input` and not auto-expanded.** This is the most important design decision of this pack — a wrong expansion in medical text is far more harmful than no expansion.

**2.3 Laterality**

| Variant | Standard |
| :--- | :--- |
| `L`, `LT`, `left`, `左侧`, `左` | `left` |
| `R`, `RT`, `right`, `右侧`, `右` | `right` |
| `B`, `BL`, `bilateral`, `双侧`, `双` | `bilateral` |
| `UNK`, `unspecified`, `未指明` | `unspecified` |

**Laterality is a structured field.** Swapping `左` and `右` can cause wrong surgical-site errors, so laterality **may only be normalized in explicit enumeration columns and must not be inferred from free text**.

**2.4 Negation & Modifiers**

The most dangerous category in free medical text: `no fever`, `否认高血压`, `无药物过敏`.

Rule: descriptions containing negation words (`no` / `not` / `denies` / `without` / `negative for` / `否认` / `无` / `未见` / `排除`) **must not be treated as positive findings**.

- Do not remove negation words during normalization
- When structured extraction is needed, negation must be a separate boolean field (`present: false`) rather than rewriting the text
- `no known allergies` (NKDA) is a **distinct concept**, not equal to "empty allergy history"

**2.5 Result-Value Variants**

| Variant | Standard |
| :--- | :--- |
| `neg`, `negative`, `阴性`, `-` | `negative` |
| `pos`, `positive`, `阳性`, `+` | `positive` |
| `+`, `++`, `+++` | Graded positive, **must not be collapsed into the same positive** |
| `trace`, `微量` | `trace` (separate grade) |
| `N/A`, `not done`, `未做` | `not_performed` (completely different from `negative`) |

**`not done` ≠ `negative`** is the most common and most severe folding error in medical data.

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `DIABETES MELLITUS` | `Diabetes mellitus` | Case normalization |
| `Ｄｉａｂｅｔｅｓ` | `Diabetes` | Full-width normalization |
| `Type  2  Diabetes` | `Type 2 Diabetes` | Whitespace collapse |
| `Type II DM` | `Type 2 Diabetes mellitus` | Roman numeral + abbreviation (when both are unambiguous) |
| `MS` | **kept and flagged** | Ambiguous (multiple sclerosis / mitral stenosis) |
| `左膝` | `left` + `knee` | Store laterality and site separately |
| `Lt knee` | `left` + `knee` | |
| `双肺` | `bilateral` + `lung` | |
| `no fever` | `fever: present=false` | Negation structured, do not rewrite text |
| `否认高血压` | `hypertension: present=false` | Same as above |
| `NKDA` | `allergies: none_known` | Distinct concept |
| `未做` | `not_performed` | Must not be changed to negative |
| `阴性(-)` | `negative` | |
| `++` | `positive: 2+` | Grade must not be lost |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `糖尿病`, `DM`, `diabetes` | `diabetes_mellitus` | Only when unambiguous |
| `高血压`, `HTN`, `hypertension` | `hypertension` | |
| `心梗`, `MI`, `myocardial infarction` | `myocardial_infarction` | `MI` requires manual confirmation if the context is orthopedics |
| `慢阻肺`, `COPD` | `copd` | |
| `冠心病`, `CHD`, `CAD` | `coronary_artery_disease` | `CHD` can also mean congenital heart disease; needs confirmation |
| `肾功能不全`, `CKD`, `肾衰` | `chronic_kidney_disease` | Staging must not be lost |
| `发热`, `发烧`, `fever` | `fever` | |
| `无`, `未见`, `否认`, `(-)` | negation marker | Must be retained as structured false |
| `不详`, `未说明`, `unknown` | `unspecified` | |

> **needs human confirmation**: SNOMED CT / UMLS mapping requires licensing and version management; **insufficient evidence — manual enrichment suggested**; this pack does not provide it.
> **needs human confirmation**: The ambiguous-abbreviation table (`MS`, `PE`, `AF`, `AS`, `CHD`, etc.) needs to be subdivided by department context; it is recommended that the workspace expand it by specialty.
