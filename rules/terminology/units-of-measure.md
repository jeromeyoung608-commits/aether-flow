---
id: term.units
version: 1
scope: industry
field_types: [number, text]
regions: [global]
industries: [logistics, healthcare, retail]
severity: warning
direction: both
evidence: high
source: ["SI Brochure 9th edition", "NIST SP 811", "UCUM specification", "ISO 80000"]
---

# Units of Measure Rule Pack

## 1. Applicable Scope

Fields where quantity + unit appear in pairs: weight, length, volume, temperature, pressure, energy, data volume.

**Core principle: the unit is part of the semantics, not formatting.** `5` alone is meaningless; `5 kg` and `5 lb` differ by 2.2×. Therefore the first rule of this pack is: **a bare number with no unit is flagged `unit_unspecified`; do not guess.**

## 2. Validation / Normalization Logic

**2.1 Unit Spelling Normalization (`severity: info`)**

| Category | Variant | Standard |
| :--- | :--- | :--- |
| Weight | `kg` `KG` `Kg` `千克` `公斤` `kgs` | `kg` |
| Weight | `g` `G` `gram` `克` `gms` | `g` |
| Weight | `t` `T` `吨` `MT` `metric ton` | `t` (metric ton, 1000 kg) |
| Weight | `lb` `lbs` `pound` `磅` | `lb` |
| Weight | `oz` `ounce` `盎司` | `oz` |
| Length | `m` `M` `meter` `metre` `米` | `m` |
| Length | `cm` `CM` `厘米` | `cm` |
| Length | `mm` `MM` `毫米` | `mm` |
| Length | `in` `inch` `"` `英寸` | `in` |
| Length | `ft` `foot` `feet` `'` `英尺` | `ft` |
| Volume | `L` `l` `liter` `litre` `升` | `L` |
| Volume | `mL` `ml` `毫升` | `mL` |
| Volume | `m3` `m³` `cbm` `CBM` `立方米` | `m3` |
| Temperature | `C` `°C` `摄氏度` | `Cel` |
| Temperature | `F` `°F` `华氏度` | `[degF]` |
| Pressure | `bar` `巴` | `bar` |
| Pressure | `psi` `PSI` | `[psi]` |

**Dangerous normalizations (must reject or warn)**:

- `t` in English context may be short ton (907 kg) or metric tonne (1000 kg) → **warn, do not auto-equal metric ton**
- `gal` may be US gallon (3.785 L) or imperial gallon (4.546 L) → **must be declared by the workspace**
- `oz` may be a mass ounce or a fluid ounce (fl oz) → **by context; warn if uncertain**
- `MM` in some industry codes means "million", not millimeter → judge together with the value magnitude
- `"` and `'` as inch/foot symbols are easily confused with quotation marks in CSV

**2.2 Exact Conversion Factors (Only Exact Values Listed)**

| From | To | Factor | Precision |
| :--- | :--- | :--- | :--- |
| `in` | `mm` | 25.4 | Exact (defined value) |
| `ft` | `m` | 0.3048 | Exact (defined value) |
| `yd` | `m` | 0.9144 | Exact |
| `mi` | `km` | 1.609344 | Exact |
| `lb` | `kg` | 0.45359237 | Exact (defined value) |
| `oz` | `g` | 28.349523125 | Exact (defined value) |
| `gal (US)` | `L` | 3.785411784 | Exact |
| `gal (imp)` | `L` | 4.54609 | Exact (defined value) |
| `bbl (oil)` | `L` | 158.987294928 | Exact |
| `t (metric)` | `kg` | 1000 | Exact |
| `short ton` | `kg` | 907.18474 | Exact |
| `long ton` | `kg` | 1016.0469088 | Exact |
| `psi` | `Pa` | 6894.757293168 | Exact |
| `bar` | `Pa` | 100000 | Exact |
| `atm` | `Pa` | 101325 | Exact (defined value) |
| `kcal` | `kJ` | 4.184 | Exact (thermochemical definition) |

Temperature is an **affine transformation**, not a ratio:

```
°F → °C:  (°F − 32) × 5/9
°C → °F:  °C × 9/5 + 32
°C → K:   °C + 273.15
```

**Common error**: treating temperature as a ratio conversion (`25 × 1.8 = 45` instead of `77`).

**2.3 Conversion Strategy**

- **By default, do not convert; only annotate.** Keep the original value + original unit, and store the standard-unit value separately.
- Conversion is performed only when the user explicitly chooses it, and the **original value must be retained** (conversion is irreversible; rounding accumulates error).
- Before summing/averaging, you must confirm the same column uses consistent units; a mixed-unit column must be normalized first, otherwise the result is wrong but looks plausible.

**2.4 Significant Figures & Precision**

- After conversion, do not add false precision: `5 lb` → `2.26796185 kg` is pseudo-precision; keep the number of digits matching the original significant figures (`2.27 kg`).
- Rounding rules for amounts and quantities must be explicitly declared (round half up / banker's rounding / truncation).

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `5 KG` | `5 kg` | Case normalization |
| `5 公斤` | `5 kg` | Chinese unit |
| `5` (no unit) | `unit_unspecified` + warning | Do not guess when uncertain |
| `5 t` (English context) | `5 t` + warning "metric ton / short ton to be confirmed" | Ambiguous `t` |
| `1 gal` | declare US or imperial | Differs by 20% |
| `25°C` → `°F` | `77°F` | Affine transform, not ×1.8 |
| `25°C` → `°F` miscalc | `45` (wrong) | Typical error |
| `5 lb` → `kg` | `2.268 kg` | Keep reasonable precision |
| `5 lb` → `2.26796185 kg` | pseudo-precision | Should round to match the source |
| `1000 MM` | confirm millimeter or million | Symbol conflict |
| `5'11"` | `1.803 m` (if height) or split feet/inches | Symbol easily confused with quotation marks |
| `3 m + 2 ft` added directly | unify units first | Mixed-unit summation |
| `5kg3g` | `5.003 kg` or two fields | Compound unit |
| `0 K` | valid | Absolute zero |
| `-5 K` | reject | Physically impossible below absolute zero (note: `-5°C` is valid) |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `CBM` | `m3` | Cubic meter (logistics) |
| `MT` | `t`(confirm metric ton) | Metric Ton |
| `KGS` | `kg` | |
| `LBS` | `lb` | |
| `TEU` | `container_20ft_equiv` | Not a unit of measure; a container equivalent (20 ft) |
| `FEU` | `container_40ft_equiv` | 40 ft equivalent |
| `MB` / `MiB` | decimal 10⁶ / binary 2²⁰ | **The two differ by 4.86%**; must be distinguished |
| `GB` / `GiB` | 10⁹ / 2³⁰ | Same as above, differs by 7.4% |

> **needs human confirmation**: The full UCUM code table (hundreds of entries) should be introduced as a data file; this pack only covers high-frequency units and conversion factors.
> **needs human confirmation**: Industry-specific non-SI units (e.g., the drug unit `IU` / International Unit, blood-pressure `mmHg`, radiation-dose `mSv`) need to be supplemented by industry, and some unit conversions depend on substance properties (e.g., `IU` is not equivalent across different vitamins).
