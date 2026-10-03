# Petrophysics in Well(er) Logs

Well(er) Logs does a deterministic quick-look interpretation. Every equation is in
`app/js/petro.js` and unit-tested in `tests/petro.test.mjs`.
Parameters live in the **Interpretation** panel and are saved with the project. Computed curves are added to each
well with the mnemonics below, so they can be plotted, crossplotted, averaged and exported like any log.

| Curve | Meaning |
|---|---|
| `VSH_GR` | Shale volume from gamma ray |
| `PHID` | Density porosity |
| `PHIT_ND` | Total porosity (neutron-density) |
| `PHIE` | Effective porosity |
| `PHI_SW` | The porosity used for Sw (PHIT or PHIE, as chosen) |
| `SW` | Water saturation |
| `BVW` | Bulk volume water, `PHI_SW × SW` |
| `TOC_DLR` | Total organic carbon, Passey ΔlogR |
| `VSH_SP`, `PHIT` | Vshale from SP and total porosity from NMR, sonic or neutron, when GR or density is missing |
| `FLAG_WO`, `FLAG_BH`, `NET_RES`, `NET_PAY` | Washout, bad hole, net reservoir and net pay flags (0/1) |

## Equations

**Shale volume.** Gamma-ray index `IGR = (GR − GRclean) / (GRshale − GRclean)`, clipped to 0–1, then one of:
linear (`Vsh = IGR`), Larionov Tertiary `0.083 (2^(3.7 IGR) − 1)`, Larionov older rocks `0.33 (2^(2 IGR) − 1)`,
or Clavier `1.7 − √(3.38 − (IGR + 0.7)²)`.
Automatic baselines: clean is the 2nd percentile of the well's GR; shale is the 95th percentile after dropping samples
above `median + 2.5 × MAD`. That exclusion matters in organic or uranium-rich shales (Sharon Springs, Niobrara marls,
many source rocks), which read far above ordinary shale and would otherwise make real shale look clean. Set the
baselines per well in the panel when you know better.

**Porosity.** `PHID = (ρma − ρb) / (ρma − ρfl)`. Total porosity is the neutron-density average, or root-mean-square
`√((φN² + φD²)/2)` for gas-bearing rock, or density alone. `PHIE = PHIT × (1 − Vsh)`.
Matrix density "Match neutron" uses the matrix the neutron was recorded on (`MATR` in the LAS header): sandstone
2.65, limestone 2.71, dolomite 2.87 g/cc. Keeping both logs in the same matrix units is what makes the
neutron-density average close to lithology-independent.

**Water resistivity at depth.** Formation temperature is a linear gradient from the surface temperature to BHT at TD
(TVD in deviated wells). Rw is carried to that temperature with Arps: `Rw2 = Rw1 (T1 + 6.77)/(T2 + 6.77)` (°F).

**Water saturation.** Archie `Sw = (a Rw / (φ^m Rt))^(1/n)`, or Simandoux (n = 2) `1/Rt = φ^m Sw²/(a Rw) + Vsh Sw / Rsh`,
solved as a quadratic. Rsh is the median deep resistivity where Vsh > 0.8. Sw can use effective or total porosity:
effective suits shaly sands; total is the usual choice in organic mudrocks and chalk-marl systems, where GR-derived
Vsh overstates clay.

**TOC.** Passey et al. (1990), density form: `ΔlogR = log10(Rt/Rt_base) − 2.5 (ρb − ρb_base)` and
`TOC = ΔlogR × 10^(2.297 − 0.1688 LOM)`. The baseline is the median Rt and ρb of the chosen baseline zone (on
"Auto", the zone above the first top), or of the lower-resistivity half of the shaly samples when there are no
tops. TOC is left blank where the rock is not fine-grained (Vsh < 0.35 and PE < 3.5) and in bad hole, because
resistivity separation in a clean sand or chalk carrying oil or gas comes from the hydrocarbons, not organic matter.
Values are clipped at 20 wt%. LOM (level of organic metamorphism) should come from vitrinite reflectance or Tmax.

**Flags and cutoffs.** Washout: caliper more than 1 in over bit size (bit from the header, else the caliper's P10 as
gauge). Bad hole: washout, or |DRHO| > 0.15 g/cc. Net reservoir: `Vsh < cut`, porosity ≥ cut, not bad hole. Net pay:
net reservoir and `Sw ≤ cut`. The flags track also takes any log with a threshold (e.g. metal loss % for corrosion).

**Reduced log suites.** Older wells often have only GR or SP and one or more resistivities. The workflow uses what is
there:

| Missing | Fallback |
|---|---|
| GR | Vshale from SP between the clean-sand line (P2) and the shale baseline (P90): `(SP − SPsand) / (SPshale − SPsand)`. Rough where SP drifts or formation water is fresher than mud filtrate. |
| Density | Porosity from NMR total porosity (TCMR, MPHS…), else sonic by Raymer-Hunt-Gardner `φ = 0.625 (Δt − Δtma) / Δt` (Raymer et al., 1980), else apparent neutron porosity. |
| All porosity logs | Net sand from Vshale alone. Net pay where the resistivity index `Rt / R0` shows `Sw = (R0 / Rt)^(1/n) ≤ cut`, with R0 the P10 resistivity of the net sands. This assumes the well has some water-bearing sand; in a well that is pay throughout, R0 is too high and pay is under-called. |
| PE | Lithology track shows sandstone, siltstone and shale from Vshale only. |

The Notes button in the Interpretation panel lists which fallbacks each well used.

**Zone summations** (Zone stats tab). Zones run from each top to the next top. Thickness is true vertical in deviated
wells (from the survey). Per zone: gross, net reservoir, net-to-gross, net pay, average porosity over net reservoir,
average Sw over net pay, porosity-feet `Σ φ h` over net reservoir and hydrocarbon-feet `Σ φ (1 − Sw) h` over net pay.
Curve means are depth-weighted; resistivity, gas and permeability use geometric means.

## Display conventions

- **Density-neutron overlay.** The density scale follows the neutron's recorded matrix so the two curves overlay in
  clean matrix rock and crossover means the same thing in every well: limestone 1.95–2.95 g/cc, sandstone
  1.90–2.90 g/cc, dolomite 2.12–3.12 g/cc, all against neutron 0.45 to −0.15 v/v. The header shows which scale is in
  use. Editing the density limits by hand turns the matching off for that track.
- **Neutron-density crossplot.** The line for the neutron's calibration matrix is exact. The other two lithology
  lines are linear-mixing approximations of the service-company chartbook curves and are drawn dashed.
- **Pickett plot.** Log porosity against log deep resistivity with Archie Sw lines from the current a, m, n and Rw,
  corrected to the median formation temperature of the plotted points.
- **Curve families, aliases and colors** follow [petroplots](https://github.com/andymcdgeo/petroplots) so figures made
  in the app and in petroplots agree. One deliberate difference: petroplots' default density and neutron limits
  (1.9–2.9 g/cc against 0.45 to −0.05 v/v) do not overlay a limestone or sandstone matrix, so Weller keeps the
  matrix-matched scales above.

## Known limits

- GR-derived shale volume overstates clay where uranium or organic matter raises GR. Spectral GR (thorium and
  potassium) or a neutron-density clay volume would be better; neither is implemented yet.
- `PHIE = PHIT × (1 − Vsh)` is a simplification. There is no shale-porosity correction or clay-bound water model.
- The ΔlogR TOC is a screening estimate. Calibrate LOM and the baseline against core TOC before quoting numbers.
- There are no environmental corrections (borehole size, mud weight, temperature for the neutron).
- No depth matching between runs, or between core and log, yet.

## References

- Archie, G.E., 1942, The electrical resistivity log as an aid in determining some reservoir characteristics: Trans. AIME 146, 54–62.
- Arps, J.J., 1953, The effect of temperature on the density and electrical resistivity of sodium chloride solutions: Trans. AIME 198.
- Clavier, C., Hoyle, W., and Meunier, D., 1971, Quantitative interpretation of TDT logs: J. Petroleum Technology 23.
- Larionov, V.V., 1969, Borehole radiometry: Nedra, Moscow.
- Passey, Q.R., Creaney, S., Kulla, J.B., Moretti, F.J., and Stroud, J.D., 1990, A practical model for organic richness from porosity and resistivity logs: AAPG Bulletin 74(12), 1777–1794.
- Simandoux, P., 1963, Dielectric measurements on porous media, application to the measurement of water saturations: Revue de l'IFP 18.
- U.S. Geological Survey data release, doi:[10.5066/P14CRSQQ](https://doi.org/10.5066/P14CRSQQ): produced-water chemistry from Niobrara wells, Denver-Julesburg Basin, Weld County, Colorado. Source of the example's Rw: the maximum specific conductance, 61.3 mS/cm at 25 °C, is 0.16 Ω·m at 77 °F.
