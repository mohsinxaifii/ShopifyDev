import sys, json, time; sys.path.insert(0,'lib')
from sh import *
pubs=dst_gql("{publications(first:20){nodes{id name}}}")['publications']['nodes']
targets=[p for p in pubs if p['name'] in ('Online Store','Point of Sale')]
print("publishing to:",[p['name'] for p in targets])
M="""mutation($id:ID!,$in:[PublicationInput!]!){publishablePublish(id:$id,input:$in){userErrors{field message}}}"""
inp=[{"publicationId":p['id']} for p in targets]

def pub_all(kind, gids):
    ok=err=0
    for i,g in enumerate(gids,1):
        try:
            r=dst_gql(M,{"id":g,"in":inp})['publishablePublish']
            if r['userErrors']: err+=1
            else: ok+=1
        except Exception as e: err+=1
        if i%100==0: print(f"  {kind} {i}/{len(gids)} ok={ok} err={err}",flush=True)
    print(f"{kind}: published={ok} errors={err}")

# products
gids=[]; cur=None
while True:
    d=dst_gql("query($c:String){products(first:250,after:$c){nodes{id} pageInfo{hasNextPage endCursor}}}",{"c":cur})
    gids+=[n['id'] for n in d['products']['nodes']]
    if not d['products']['pageInfo']['hasNextPage']: break
    cur=d['products']['pageInfo']['endCursor']
pub_all("products",gids)
# collections
gids=[]; cur=None
while True:
    d=dst_gql("query($c:String){collections(first:250,after:$c){nodes{id} pageInfo{hasNextPage endCursor}}}",{"c":cur})
    gids+=[n['id'] for n in d['collections']['nodes']]
    if not d['collections']['pageInfo']['hasNextPage']: break
    cur=d['collections']['pageInfo']['endCursor']
pub_all("collections",gids)
