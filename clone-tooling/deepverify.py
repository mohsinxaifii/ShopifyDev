import sys, json, random; sys.path.insert(0,'lib')
from sh import *
src={p['handle']:p for p in json.load(open('export/products.json'))}
random.seed(7)
sample=random.sample(list(src), 40)
Q="""query($h:String!){productByIdentifier(identifier:{handle:$h}){
 handle title vendor productType tags status descriptionHtml templateSuffix
 seo{title description} category{id}
 options{name position values}
 media(first:60){nodes{__typename}}
 metafields(first:80){nodes{namespace key type value}}
 variants(first:100){nodes{sku title price compareAtPrice barcode taxable inventoryPolicy
   selectedOptions{name value} inventoryItem{tracked requiresShipping measurement{weight{value unit}}}
   metafields(first:40){nodes{namespace key type value}}}}}}"""
bad=[]; checked=0
SKIP_NS=lambda ns: ns.startswith('shopify--') or ns.startswith('app--') or ns=='shopify'
for h in sample:
    s=src[h]; d=dst_gql(Q,{"h":h})['productByIdentifier']
    if not d: bad.append((h,"MISSING")); continue
    checked+=1
    def cmp(field, a, b):
        if a!=b: bad.append((h,f"{field}: src={str(a)[:60]!r} dst={str(b)[:60]!r}"))
    cmp("title",s['title'],d['title']); cmp("vendor",s['vendor'],d['vendor'])
    cmp("productType",s['productType'],d['productType']); cmp("status",s['status'],d['status'])
    cmp("tags",sorted(s['tags']),sorted(d['tags']))
    cmp("descriptionHtml",s['descriptionHtml'],d['descriptionHtml'])
    cmp("category",(s.get('category') or {}).get('id'),(d.get('category') or {}).get('id'))
    cmp("options",[(o['name'],o['position'],o['values']) for o in s['options']],
                  [(o['name'],o['position'],o['values']) for o in d['options']])
    cmp("media count",len(s['media']['nodes']),len(d['media']['nodes']))
    sm={(m['namespace'],m['key']):m['value'] for m in s['metafields']['nodes'] if not SKIP_NS(m['namespace'])}
    dm={(m['namespace'],m['key']):m['value'] for m in d['metafields']['nodes'] if not SKIP_NS(m['namespace'])}
    for k,v in sm.items():
        if k not in dm:
            if v in ('[]','',None): continue          # empty in source: nothing to copy
            bad.append((h,f"metafield {k[0]}.{k[1]} MISSING (src={v[:50]})"))
        elif dm[k]!=v and not v.startswith('gid://') and not v.startswith('['):
            bad.append((h,f"metafield {k[0]}.{k[1]} value differs"))
    sv={(v['sku'] or v['title']):v for v in s['variants']['nodes']}
    dv={(v['sku'] or v['title']):v for v in d['variants']['nodes']}
    if set(sv)!=set(dv): bad.append((h,f"variant keys differ src={len(sv)} dst={len(dv)}"))
    for k in set(sv)&set(dv):
        a,b=sv[k],dv[k]
        for f in ('price','compareAtPrice','barcode','taxable','inventoryPolicy'):
            if a.get(f)!=b.get(f): bad.append((h,f"variant {k}.{f}: {a.get(f)!r} vs {b.get(f)!r}"))
        if sorted((x['name'],x['value']) for x in a['selectedOptions'])!=sorted((x['name'],x['value']) for x in b['selectedOptions']):
            bad.append((h,f"variant {k} options differ"))
        am={(m['namespace'],m['key']):m['value'] for m in a['metafields']['nodes'] if not SKIP_NS(m['namespace'])}
        bm={(m['namespace'],m['key']):m['value'] for m in b['metafields']['nodes'] if not SKIP_NS(m['namespace'])}
        if am!=bm: bad.append((h,f"variant {k} metafields differ ({len(am)} vs {len(bm)})"))
print(f"deep-checked {checked} products")
print(f"discrepancies: {len(bad)}")
for h,e in bad[:40]: print("   ",h,"|",e)
