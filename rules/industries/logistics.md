---
id: industry.logistics
version: 1
scope: industry
field_types: [identifier, code, number]
regions: [global]
industries: [logistics]
severity: error
direction: both
evidence: medium
source: ["ISO 6346:2022", "IATA Resolution 762", "ICAO Annex 14", "UNECE UN/LOCODE", "GS1 General Specifications"]
---

# Logistics Industry Rule Pack

## 1. Applicable Scope

Identifier fields in containers, waybills, ports/airports, and consignment notes.

## 2. Validation / Normalization Logic

**2.1 ISO 6346 Container Number (11 digits)**

```regex
^[A-Z]{4}\d{7}$
```

Structure: `3-digit owner code` (Owner Code) + `1-digit equipment category identifier` + `6-digit serial number` + `1 check digit`.

Equipment category identifier (4th character): `U` (freight container), `J` (detachable equipment), `Z` (trailer/chassis).

Check digit algorithm (ISO 6346 Annex A):

```
1. Letter values: start at A=10, skipping multiples of 11
   A=10  B=12  C=13  D=14  E=15  F=16  G=17  H=18  I=19  J=20
   K=21  L=23  M=24  N=25  O=26  P=27  Q=28  R=29  S=30  T=31
   U=32  V=34  W=35  X=36  Y=37  Z=38
   (skipped: 11, 22, 33)
2. Digits keep their own value
3. Multiply the first 10 chars (4 letters + 6 digits) by weights 2^0 to 2^9 in order
   i.e. 1, 2, 4, 8, 16, 32, 64, 128, 256, 512
4. Sum into S
5. Check digit = S mod 11; if the result is 10, use 0
6. The 11th digit must equal this value
```

**2.2 Air Waybill Number (AWB, 11 digits)**

```regex
^\d{11}$
```

Structure: `3-digit airline prefix` (IATA-assigned) + `7-digit waybill serial` + `1 check digit`.

Validation:

```
Multiply the first 7 digits (serial) left-to-right by weights 7,6,5,4,3,2,1
S = Σ(digit × weight)
Check digit = S mod 7
```

**Note:** Within the full 11 digits, the first 3 digits (the "airline prefix") are IATA-assigned and are not part of the check. A common mistake is to apply the weights to all 11 digits.

**2.3 IATA Airport Code / Airline Code**

```regex
Airport: ^[A-Z]{3}$
Airline: ^[A-Z]{2}$ (two digits, or three-digit ICAO)
```

- IATA airport code: 3 letters (`PEK`, `PVG`, `LAX`, `LHR`)
- ICAO airport code: 4 letters (`ZBAA`, `ZSPD`, `KLAX`) — the first 1–2 characters are the regional prefix
- IATA airline code: 2 letters (`CA`, `MU`); ICAO airline code: 3 letters (`CCA`, `CES`)
- **Three-letter codes collide between airports and airlines**, so the field name must be explicit (`airport` vs `airline`)

**2.4 UN/LOCODE**

See `regions/international-codes.md` 2.6. In logistics scenarios, port names are often written interchangeably with their codes (`Shanghai` / `CNSHA` / `CN SHA`) and must be normalized.

**2.5 Ocean Bill of Lading Number / Express Tracking Number**

**insufficient evidence — manual enrichment suggested.** The bill of lading number (B/L) is encoded independently by each shipping line (e.g. Maersk's 9-digit, MSC's format), and the express tracking number is defined by each carrier (SF Express, DHL, UPS differ in length and check rules). **There is no universal rule**, and hard-coding a regex would only produce false positives.

Recommended approach: maintain a `carrier → regex` mapping table per carrier; leave unrecognized numbers as-is and flag `unknown_carrier` rather than rejecting them.

**2.6 Weight & Volume**

- Weight units must be explicit: `kg`, `g`, `lb`, `oz`, `t` (metric ton vs short ton vs long ton, **must be distinguished**)
- Volume: `m³`, `cbm`, `ft³`, `CBF`
- Chargeable weight = `max(actual weight, volumetric weight)`; the volumetric divisor varies by carrier (commonly 6000 / 5000 / 167)
- **Unit conversion see `terminology/units-of-measure.md`**

## 3. Bad & Good Examples

| Bad | Good | Note |
| :--- | :--- | :--- |
| `MSCU1234567` | valid (if check digit passes) | 11 digits; requires algorithm verification |
| `MSCU1234568` | reject | check digit error |
| `mscu1234567` | `MSCU1234567` | normalize to uppercase |
| `MSCU 123456 7` | `MSCU1234567` | remove spaces |
| `MSC1234567` | reject | owner code must be 4 chars (3 letters + 1 category identifier) |
| `MSCU12345678` | reject | 12 digits; too long |
| `999-12345675` | valid (if mod 7 passes) | AWB is 11 digits (strip hyphens first) |
| `PEK` | valid | Capital Airport IATA |
| `ZBAA` | valid | Capital Airport ICAO |
| `Shanghai` | `CNSHA` | port name → LOCODE |
| `5 KG` | `5 kg` | unit normalization (case conventions see units pack) |
| `1000 t` | confirm metric ton | `t` is ambiguous |
| `1,000 lbs` | `453.592 kg` or keep `lb` + converted value | do not auto-convert; keep both values |

## 4. Term / Enum Mapping

| Non-standard form | Standard value | Note |
| :--- | :--- | :--- |
| `货柜号`, `箱号`, `Container No.` | `container_no` | ISO 6346 |
| `AWB`, `Air Waybill`, `空运单` | `awb` | |
| `B/L`, `Bill of Lading`, `提单` | `bl_no` | no universal format |
| `港口`, `Port`, `Port of Loading` | `pol` | pairs with `pod` (port of discharge) |
| `IATA`, `机场三字码` | `iata_airport` | |
| `卸货港` / `装货港` | `pod` / `pol` | semantics are opposite; a wrong mapping reverses the whole table |
| `CBM`, `立方` | `m3` | cubic meter |
| `毛重` / `净重` | `gross_weight` / `net_weight` | the two are not interchangeable |

> **needs human confirmation**: The per-carrier numbering rules, port alias tables, and the full IATA/ICAO code lists (tens of thousands of entries) must be maintained as data files; this pack only defines algorithms and structure.
