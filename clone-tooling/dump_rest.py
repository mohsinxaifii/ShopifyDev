import sys, json; sys.path.insert(0,'lib')
from sh import *
# metaobject entries
mo={}
for t in [d['type'] for d in json.load(open('export/metaobject_defs.json'))]:
    acc=[];cur=None
    while True:
        d=src_gql("""query($t:String!,$c:String){metaobjects(type:$t,first:100,after:$c){
          nodes{id handle displayName type fields{key value type} capabilities{publishable{status}}}
          pageInfo{hasNextPage endCursor}}}""",{"t":t,"c":cur})
        acc+=d['metaobjects']['nodes']
        if not d['metaobjects']['pageInfo']['hasNextPage']: break
        cur=d['metaobjects']['pageInfo']['endCursor']
    if acc: mo[t]=acc
json.dump(mo,open('export/metaobjects.json','w'),indent=1)
print("metaobject entries:",sum(len(v) for v in mo.values()))

# collections
cur=None; cols=[]
while True:
    d=src_gql("""query($c:String){collections(first:50,after:$c){nodes{
      id handle title descriptionHtml sortOrder templateSuffix
      seo{title description} image{url altText}
      ruleSet{appliedDisjunctively rules{column relation condition conditionObject{
        ... on CollectionRuleMetafieldCondition{metafieldDefinition{namespace key}}}}}
      metafields(first:30){nodes{namespace key type value}}
      products(first:250){nodes{id handle}}
    } pageInfo{hasNextPage endCursor}}}""",{"c":cur})
    cols+=d['collections']['nodes']
    if not d['collections']['pageInfo']['hasNextPage']: break
    cur=d['collections']['pageInfo']['endCursor']
json.dump(cols,open('export/collections.json','w'),indent=1)
print("collections:",len(cols),"smart:",sum(1 for c in cols if c.get('ruleSet')))

# pages
pages=src_all("pages.json","pages")
for p in pages:
    try: p['_mf']=src_gql('query($id:ID!){page(id:$id){metafields(first:30){nodes{namespace key type value}}}}',
                          {"id":f"gid://shopify/Page/{p['id']}"})['page']['metafields']['nodes']
    except: p['_mf']=[]
json.dump(pages,open('export/pages.json','w'),indent=1); print("pages:",len(pages))

# blogs + articles
blogs=src_all("blogs.json","blogs")
for b in blogs: b['_articles']=src_all(f"blogs/{b['id']}/articles.json","articles")
for b in blogs:
    for a in b['_articles']:
        try: a['_mf']=src_gql('query($id:ID!){article(id:$id){metafields(first:30){nodes{namespace key type value}}}}',
                              {"id":f"gid://shopify/Article/{a['id']}"})['article']['metafields']['nodes']
        except: a['_mf']=[]
json.dump(blogs,open('export/blogs.json','w'),indent=1)
print("blogs:",len(blogs),"articles:",sum(len(b['_articles']) for b in blogs))

# menus
menus=src_gql("""{menus(first:50){nodes{id handle title items{
 id title type url resourceId tags
 items{id title type url resourceId tags items{id title type url resourceId tags}}}}}}""")['menus']['nodes']
json.dump(menus,open('export/menus.json','w'),indent=1); print("menus:",len(menus))

# shop metafields
sm=src_gql('{shop{metafields(first:50){nodes{namespace key type value}}}}')['shop']['metafields']['nodes']
json.dump(sm,open('export/shop_metafields.json','w'),indent=1); print("shop metafields:",len(sm))

# policies
pol=src_get("policies.json").get("policies",[])
json.dump(pol,open('export/policies.json','w'),indent=1); print("policies:",len(pol))
