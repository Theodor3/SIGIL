# CSX annual field consistency and boundary report

Checked 53 cached 2025-dated workbooks: 22 commodity label/code pairs (Carloadings B/C9:30) and ten terminal names (Rail Service A17:26) agree with the first workbook. All selected numeric values are finite and nonnegative: system speed B13, system dwell B27, ten terminal dwells B17:26, and 44 originated/received values D/E9:30. No violations found. These checks establish schema consistency and basic numeric validity, not economic accuracy or signal quality.

System speed ranges 21.858563 to 26.309631 mph; system dwell 17.97 to 29.63 hours. Containers and Trailers remain separate categories; units are not inferred from the generic carloadings heading. Fertilizer remains a non-additive subgroup.

Downloaded the index-listed January 7, 2026 workbook. Its E3/E4 reporting period is December 27, 2025 through January 2, 2026, contiguous with the previous report. Calendar-year 2025 is covered by overlapping weekly observations, but cross-year weeks must stay explicitly labeled; no prorating or timing convention chosen automatically.

Evidence: conversation outputs/csx-evidence/2025/field-audit.json; csx-2026-01-07.xlsx with source receipt and decoded cells. Read-only research helper work/check-csx-fields.ps1. No application or trading execution. Original public-availability times and intermodal unit convention still require a reviewed conclusion before modeling. No market-predictive claim.
