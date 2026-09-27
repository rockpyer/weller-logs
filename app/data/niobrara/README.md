# Denver Basin Niobrara example logs

Real wireline and MWD logs used as the app's default example.

| File | Well | API | Location | Logs |
|---|---|---|---|---|
| 2120933C.las | Mattson 12-32 | 49-021-20933 | Laramie County, WY | Schlumberger PEX/AIT triple combo, 2013 |
| 2121022A.las | Fornstrom 13-32A | 49-021-21022 | Laramie County, WY | triple combo |
| 2121034E.las | Marquardt 43 31 | 49-021-21034 | Laramie County, WY | triple combo |
| 2121035D.las | McGahan Farms 42-31 | 49-021-21035 | Laramie County, WY | triple combo |
| 2121038B.las | Marquardt 44-31 | 49-021-21038 | Laramie County, WY | triple combo |
| 2121045D.las | McGahan Farms 32 31 | 49-021-21045 | Laramie County, WY | triple combo with sonic |
| 2121046D.las | Marquardt 34-31 | 49-021-21046 | Laramie County, WY | triple combo with sonic |
| 400709586.las | Horsetail 02D-00204 (Whiting) | not in header | Weld County, CO | MWD gamma ray in a Niobrara horizontal, with directional survey |

**Source.** The seven Laramie County files are Wyoming Oil and Gas Conservation Commission (WOGCC) public records,
redistributed in [jessepisel/5minutesofpython](https://github.com/jessepisel/5minutesofpython) (public domain,
Unlicense). The Weld County horizontal comes from the same repository. The Laramie County wells sit in the northern
Denver-Julesburg Basin, about 25 miles north of the Colorado line, in the same Niobrara play as Weld County.

**What was changed.** The seven wireline files were cut to 5,500 ft to TD and to the core curves (GR, SP, HCAL, RHOZ,
HDRA, TNPH, NPHI, PEFZ, AT10, AT30, AT90, DT) with `scripts/subset_las.py`. Header lines are unchanged, including
their quirks, so the parser is tested on real files: LAS 1.2 headers with the label before the value, elevations filed
in `~Parameter`, a KB of 10,594 ft on a 5,291 ft ground level (Marquardt 34-31), neutron recorded on a sandstone matrix.

**Tops.** `tops.csv` holds first-pass picks made by `scripts/pick_niobrara_tops.py` from repeatable log rules (see
the script). They are interpretive and unreviewed: Sharon Springs, Niobrara, Lower Niobrara (a strong PE drop inside
the Niobrara), Carlile, Greenhorn and D Sandstone in the verticals; Sharon Springs and Niobrara in the horizontal,
picked on GR against TVD. Check them against your own picks before using them for anything.
