import pymupdf as fitz, json, collections
d=fitz.open('/root/.claude/uploads/14dc42b4-3207-59d6-805b-3d813a8a3e5f/6d8a3647-wsgs-web-prb-geologic-map.pdf');p=d[0]
dr=p.get_drawings()
sw=[g for g in dr if g.get('fill') and 25<g['rect'].width<45 and 10<g['rect'].height<22 and g['rect'].x0>2700]
print(len(sw))
words=p.get_text('words')
lines=p.get_text('dict')
out=[]
seen=set()
for g in sw:
    r=g['rect']; key=(round(r.x0),round(r.y0))
    if key in seen: continue
    seen.add(key)
    code=''.join(w[4] for w in words if r.contains(fitz.Rect(w[:4]).tl+(1,1)) and w[0]>=r.x0-1 and w[2]<=r.x1+1)
    # description: words to the right on same baseline
    desc=' '.join(w[4] for w in words if w[0]>r.x1 and w[0]<r.x1+260 and abs((w[1]+w[3])/2-(r.y0+r.y1)/2)<6)
    # all fills inside swatch
    inner=collections.Counter()
    for h in dr:
        if h.get('fill') and r.contains(h['rect'].tl) and h is not g:
            inner[tuple(round(c*255) for c in h['fill'])]+=1
    out.append(dict(code=code,desc=desc,rect=list(r),fill=[round(c*255) for c in g['fill']],inner=[list(k) for k,_ in inner.most_common(3)]))
out.sort(key=lambda o:(o['rect'][0]>3200,o['rect'][1]))
for o in out: print(o['code'],o['fill'],o['inner'],o['desc'][:50])
json.dump(out,open('legend.json','w'),indent=1)
