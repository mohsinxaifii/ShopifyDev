import sys, json; sys.path.insert(0,'lib')
from sh import *
rows=[]
def row(name, s, d, note=""):
    rows.append((name, s, d, "OK" if s==d else "DIFF", note))

# counts
row("products", src_gql('{productsCount{count}}')['productsCount']['count'],
                 dst_gql('{productsCount{count}}')['productsCount']['count'])
row("variants", src_gql('{productVariantsCount{count}}')['productVariantsCount']['count'],
                 dst_gql('{productVariantsCount{count}}')['productVariantsCount']['count'])
sc=len(src_all("custom_collections.json","custom_collections"))+len(src_all("smart_collections.json","smart_collections"))
dc=len(dst_all("custom_collections.json","custom_collections"))+len(dst_all("smart_collections.json","smart_collections"))
row("collections", sc, dc)
row("pages", src_get("pages/count.json")['count'], dst_get("pages/count.json")['count'])
sb=src_all("blogs.json","blogs"); db=dst_all("blogs.json","blogs")
row("blogs", len(sb), len(db))
row("articles", sum(src_get(f"blogs/{b['id']}/articles/count.json")['count'] for b in sb),
                sum(dst_get(f"blogs/{b['id']}/articles/count.json")['count'] for b in db))
row("menus", len(src_gql('{menus(first:50){nodes{handle}}}')['menus']['nodes']),
             len(dst_gql('{menus(first:50){nodes{handle}}}')['menus']['nodes']))
row("redirects", src_get("redirects/count.json")['count'], dst_get("redirects/count.json")['count'])
row("price rules", len(src_all("price_rules.json","price_rules")), len(dst_all("price_rules.json","price_rules")),
    "4 expired-2024 codes target deleted products")
# active discounts
def active(fn):
    d=fn('{discountNodes(first:250){nodes{discount{... on DiscountCodeBasic{status}}}}}')
    return sum(1 for x in d['discountNodes']['nodes'] if (x['discount'] or {}).get('status')=='ACTIVE')
row("ACTIVE discounts", active(src_gql), active(dst_gql))
# metafield defs
def mfdefs(fn):
    t=0
    for o in ["PRODUCT","PRODUCTVARIANT","COLLECTION","SHOP","ARTICLE","CUSTOMER","PAGE","BLOG"]:
        t+=len(fn('query($o:MetafieldOwnerType!){metafieldDefinitions(first:250,ownerType:$o){nodes{key}}}',{"o":o})['metafieldDefinitions']['nodes'])
    return t
row("metafield definitions", mfdefs(src_gql), mfdefs(dst_gql), "4 app-owned Search&Discovery defs need the app")
# metaobjects
def modefs(fn): return len(fn('{metaobjectDefinitions(first:200){nodes{type}}}')['metaobjectDefinitions']['nodes'])
row("metaobject definitions", modefs(src_gql), modefs(dst_gql), "shopify-- taxonomy defs auto-created")
def moent(fn, types):
    t=0
    for ty in types:
        cur=None
        while True:
            d=fn('query($t:String!,$c:String){metaobjects(type:$t,first:250,after:$c){nodes{id} pageInfo{hasNextPage endCursor}}}',{"t":ty,"c":cur})
            t+=len(d['metaobjects']['nodes'])
            if not d['metaobjects']['pageInfo']['hasNextPage']: break
            cur=d['metaobjects']['pageInfo']['endCursor']
    return t
custom=[t for t in json.load(open('export/metaobjects.json')) if not t.startswith('shopify--')]
row("metaobject entries (custom)", moent(src_gql,custom), moent(dst_gql,custom))
# shop metafields
row("shop metafields", len(src_gql('{shop{metafields(first:60){nodes{key}}}}')['shop']['metafields']['nodes']),
                        len(dst_gql('{shop{metafields(first:60){nodes{key}}}}')['shop']['metafields']['nodes']))
# theme
row("theme assets", len(src_get("themes/191188009144/assets.json")['assets']),
                    len(dst_get(f"themes/{json.load(open('maps/theme.json'))['id']}/assets.json")['assets']))
print(f"{'ITEM':<30}{'SOURCE':>9}{'DEST':>9}  {'':<6}NOTE")
print("-"*86)
for n,s,d,st,note in rows:
    print(f"{n:<30}{s:>9}{d:>9}  {st:<6}{note}")
