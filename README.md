# Weller Logs

Desktop well-log viewer with correlation panels, aimed at Southern California work.
Opens LAS files, renders tracks on sensible default scales (log-scale resistivity,
reversed neutron/sonic, mud-log gas and drilling curves), correlates tops across wells,
and saves everything as a `.lasproj` file.

Status: **plan + interactive mockup**. See [docs/PLAN.md](docs/PLAN.md).

## Try the mockup

```
git clone <this repo>
cd weller-logs/mockup
python3 -m http.server 8080     # any static server works
# open http://localhost:8080
```

The mockup loads four synthetic LA Basin wells (Pico / Repetto / Puente tops).
Use **Open LAS…** to load your own files. Ctrl+scroll zooms depth. Pick tops by typing a
name, pressing **Pick on log**, and clicking a track. The correlation tab hangs wells on
measured depth, sea level, or any top.

Sample LAS files live in `samples/` and are regenerated with:

```
node scripts/make-sample-las.mjs
```

## Layout

```
docs/PLAN.md         architecture, phases, default scales, pitfalls, open questions
mockup/index.html    single-file mockup (D3 from cdnjs, no build step)
mockup/synth.js      synthetic well generator shared by the mockup and the sample script
samples/*.las        synthetic LAS 2.0 files (not real wells)
scripts/             utilities
```
