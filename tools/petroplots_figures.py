"""Publication figures from a Well(er) Logs export, drawn with petroplots.

In Well(er) Logs, open Zone stats and press "Export for petroplots". Then:

    pip install petroplots
    python tools/petroplots_figures.py weller-curves-petroplots.csv --out figures

Writes, per well, a log plot (GR, resistivity, density-neutron crossover, PHIT and Sw, formations), and, for the
whole export, a density-neutron crossplot split by formation and colored by GR, and a porosity histogram by formation.
Curve families, scales and colors follow petroplots' conventions, so the figures match other petroplots work.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import pandas as pd
import petroplots as pp


# The same zone palette Well(er) Logs uses, in depth order, so a formation has one color in the app and in print.
ZONE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"]


def formation_scheme(data: pd.DataFrame) -> pp.FaciesScheme:
    order = data.groupby("FORMATION")["DEPTH"].median().sort_values().index.tolist()
    return pp.FaciesScheme({f: ZONE_COLORS[i] if i < len(ZONE_COLORS) else "#6C757D" for i, f in enumerate(order)}, name="formations")


def log_plot(df: pd.DataFrame, well: str, top: float | None, bottom: float | None, scheme: pp.FaciesScheme):
    have = lambda c: c in df and df[c].notna().any()
    plot = pp.LogPlot(df, depth="DEPTH", top=top, bottom=bottom, depth_units="ft").title(well)
    plot.add_depth(interval=50)
    if have("GR"):
        t = plot.add_track(label="GR")
        t.add_curve("GR", limits=(0, 200), units="API")
        t.fill(baseline=0, cmap="YlOrBr")
    res = [c for c in ("RDEEP", "RMED", "RSHAL") if have(c)]
    if res:
        t = plot.add_track(label="Resistivity", scale="log")
        for c in res:
            t.add_curve(c, limits=(0.2, 2000), units="ohm.m")
    if have("RHOB") and have("NPHI"):
        # Density scale matched to the neutron calibration so the crossover reads true (see app/methods.md).
        matrix = df["NEUTRON_MATRIX"].dropna().iloc[0] if df["NEUTRON_MATRIX"].notna().any() else "limestone"
        rho = {"sandstone": (1.90, 2.90), "dolomite": (2.12, 3.12)}.get(matrix, (1.95, 2.95))
        t = plot.add_track(label=f"Density-neutron ({matrix})")
        t.add_curve("RHOB", limits=rho, units="g/cc")
        t.add_curve("NPHI", limits=(0.45, -0.15), units="v/v")
        t.crossover()
    if have("PHIT"):
        t = plot.add_track(label="PHIT")
        t.add_curve("PHIT", limits=(0.5, 0.0), units="v/v")
    if have("SW"):
        t = plot.add_track(label="Sw")
        t.add_curve("SW", limits=(1.0, 0.0), units="v/v")
    if df["FORMATION"].notna().any():
        plot.add_zones("FORMATION", scheme=scheme)
    return plot.render(figsize=(12, 10))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", help="Well(er) Logs 'Export for petroplots' CSV")
    ap.add_argument("--out", default="figures", help="output folder")
    ap.add_argument("--top", type=float, help="top of the log plots (MD)")
    ap.add_argument("--bottom", type=float, help="bottom of the log plots (MD)")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    data = pd.read_csv(a.csv)
    scheme = formation_scheme(data)
    written = []
    for well, df in data.groupby("WELL", sort=False):
        df = pp.io.normalise(df.drop(columns="WELL").reset_index(drop=True), depth="DEPTH")
        res = log_plot(df, str(well), a.top, a.bottom, scheme)
        f = out / f"log_{str(well).replace(' ', '_').replace('/', '-')}.png"
        res.fig.savefig(f, dpi=150, bbox_inches="tight"); written.append(f)
    both = data.dropna(subset=["RHOB", "NPHI"])
    if len(both):
        order = list(dict.fromkeys(both["FORMATION"]))
        res = pp.crossplot(both, "NPHI", "RHOB", color="GR", color_limits=(0, 150), color_steps=6, by="FORMATION", order=order,
                           xlimits=(-0.15, 0.45), ylimits=(3.0, 1.9), size=6, alpha=0.5)
        f = out / "crossplot_nd_by_formation.png"; res.fig.savefig(f, dpi=150, bbox_inches="tight"); written.append(f)
    if data["PHIT"].notna().any():
        res = pp.histogram(data.dropna(subset=["PHIT"]), "PHIT", color="FORMATION", scheme=scheme, limits=(0, 0.4), bins=40)
        f = out / "histogram_phit_by_formation.png"; res.fig.savefig(f, dpi=150, bbox_inches="tight"); written.append(f)
    for f in written:
        print(f)


if __name__ == "__main__":
    main()
