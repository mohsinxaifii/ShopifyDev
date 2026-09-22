import sys, json, os; sys.path.insert(0,'lib')
from sh import *
menus=json.load(open('export/menus.json'))
pmap=json.load(open('maps/products.json'))
cmap=json.load(open('maps/collections.json'))
pgmap=json.load(open('maps/pages.json'))
blogmap=json.load(open('maps/blogs.json')) if os.path.exists('maps/blogs.json') else {}
src_prod={p['id']:p['handle'] for p in json.load(open('export/products.json'))}
src_col={c['id']:c['handle'] for c in json.load(open('export/collections.json'))}
src_page={f"gid://shopify/Page/{p['id']}":p['handle'] for p in json.load(open('export/pages.json'))}
src_blog={f"gid://shopify/Blog/{b['id']}":b['handle'] for b in json.load(open('export/blogs.json'))}

def remap(rid, typ):
    if not rid: return None
    if rid.startswith('gid://shopify/Product/'):
        h=src_prod.get(rid); return pmap[h]['id'] if h in pmap else None
    if rid.startswith('gid://shopify/Collection/'):
        h=src_col.get(rid); return cmap[h]['id'] if h in cmap else None
    if rid.startswith('gid://shopify/Page/'):
        h=src_page.get(rid); return pgmap.get(h)
    if rid.startswith('gid://shopify/Blog/'):
        h=src_blog.get(rid); return blogmap.get(h)
    return None

dropped=[]
def conv(items):
    out=[]
    for it in items:
        d={"title":it['title'],"type":it['type']}
        rid=remap(it.get('resourceId'), it['type'])
        if it.get('resourceId'):
            if not rid:
                dropped.append((it['title'],it['type'],it.get('resourceId'))); continue
            d['resourceId']=rid
        elif it.get('url'): d['url']=it['url']
        if it.get('tags'): d['tags']=it['tags']
        sub=conv(it.get('items') or [])
        if sub: d['items']=sub
        out.append(d)
    return out

existing={m['handle']:m['id'] for m in dst_gql('{menus(first:50){nodes{id handle}}}')['menus']['nodes']}
C="""mutation($t:String!,$h:String!,$i:[MenuItemCreateInput!]!){menuCreate(title:$t,handle:$h,items:$i){menu{id handle} userErrors{field message}}}"""
U="""mutation($id:ID!,$t:String!,$h:String!,$i:[MenuItemUpdateInput!]!){menuUpdate(id:$id,title:$t,handle:$h,items:$i){menu{id handle} userErrors{field message}}}"""
ok=0; errs=[]
for m in menus:
    items=conv(m['items'])
    try:
        if m['handle'] in existing:
            r=dst_gql(U,{"id":existing[m['handle']],"t":m['title'],"h":m['handle'],"i":items})['menuUpdate']
        else:
            r=dst_gql(C,{"t":m['title'],"h":m['handle'],"i":items})['menuCreate']
    except Exception as e: errs.append((m['handle'],str(e)[:250])); continue
    if r['userErrors']: errs.append((m['handle'],json.dumps(r['userErrors'])[:250]))
    else: ok+=1; print(f"  menu {m['handle']}: {len(items)} top-level items")
print(f"menus ok={ok} errors={len(errs)}")
for h,e in errs: print("   FAIL",h,e[:200])
if dropped:
    print(f"dropped {len(dropped)} menu items (unresolved target):")
    for t,ty,r in dropped[:20]: print(f"   {t} [{ty}] {r}")
