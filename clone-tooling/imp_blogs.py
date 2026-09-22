import sys, json, os; sys.path.insert(0,'lib')
from sh import *
blogs=json.load(open('export/blogs.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_files=json.load(open('export/files_byid.json'))
pmap=json.load(open('maps/products.json'))
src_prod={p['id']:p['handle'] for p in json.load(open('export/products.json'))}
def bn(u): return u.split('?')[0].split('/')[-1] if u else None
bmap={}
existing={b['handle']:b['id'] for b in dst_all("blogs.json","blogs")}
for b in blogs:
    if b['handle'] in existing:
        bid=existing[b['handle']]; print("  blog exists:",b['handle'])
    else:
        r=dst("POST","blogs.json",{"blog":{"title":b['title'],"handle":b['handle'],
             "commentable":b.get('commentable','no'),"template_suffix":b.get('template_suffix')}})
        bid=r['blog']['id']; print("  created blog",b['handle'])
    bmap[b['handle']]=f"gid://shopify/Blog/{bid}"
    have={a['handle'] for a in dst_all(f"blogs/{bid}/articles.json","articles")}
    for a in b['_articles']:
        if a['handle'] in have: continue
        body={"article":{"title":a['title'],"handle":a['handle'],"body_html":a.get('body_html') or "",
              "summary_html":a.get('summary_html'),"author":a.get('author'),"tags":a.get('tags'),
              "published":bool(a.get('published_at')),"published_at":a.get('published_at')}}
        if a.get('image') and a['image'].get('src'): body['article']['image']={"src":a['image']['src'],"alt":a['image'].get('alt')}
        r=dst("POST",f"blogs/{bid}/articles.json",body)
        aid=r['article']['id']; print("   article:",a['handle'])
        mfs=[]
        for m in a.get('_mf') or []:
            if m['namespace'].startswith(('shopify--','app--')) or m['namespace']=='shopify': continue
            v=m['value']
            if m['type'] in ('file_reference','list.file_reference'):
                def one(g):
                    f=src_files.get(g); return dst_files.get(bn(f['url'])) if f and f.get('url') else None
                if m['type'].startswith('list.'):
                    arr=[one(g) for g in json.loads(v)]; arr=[x for x in arr if x]
                    if not arr: continue
                    v=json.dumps(arr)
                else:
                    v=one(v)
                    if not v: continue
            elif m['type'] in ('product_reference','list.product_reference'):
                def onep(g):
                    h=src_prod.get(g); return pmap[h]['id'] if h in pmap else None
                if m['type'].startswith('list.'):
                    arr=[onep(g) for g in json.loads(v)]; arr=[x for x in arr if x]
                    if not arr: continue
                    v=json.dumps(arr)
                else:
                    v=onep(v)
                    if not v: continue
            mfs.append({"namespace":m['namespace'],"key":m['key'],"type":m['type'],"value":v,
                        "ownerId":f"gid://shopify/Article/{aid}"})
        if mfs:
            r2=dst_gql("mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){userErrors{field message}}}",{"m":mfs})
            if r2['metafieldsSet']['userErrors']: print("     mf err",r2['metafieldsSet']['userErrors'])
json.dump(bmap,open('maps/blogs.json','w'),indent=1)
print("blogs done")
