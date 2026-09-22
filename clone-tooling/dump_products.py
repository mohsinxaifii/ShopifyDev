import sys, json; sys.path.insert(0,'lib')
from sh import *
Q="""query($c:String){products(first:15,after:$c,sortKey:ID){nodes{
 id handle title descriptionHtml vendor productType tags status templateSuffix
 requiresSellingPlan giftCardTemplateSuffix
 seo{title description}
 category{id}
 options{name position values}
 media(first:50){nodes{ __typename alt mediaContentType
   ... on MediaImage{ id image{url} }
   ... on Video{ id originalSource{url} }
   ... on ExternalVideo{ id originUrl }
   ... on Model3d{ id originalSource{url} } }}
 metafields(first:80){nodes{namespace key type value}}
 variants(first:100){nodes{
   id title sku price compareAtPrice barcode position taxable taxCode
   inventoryPolicy inventoryQuantity
   selectedOptions{name value}
   image{url}
   inventoryItem{ sku tracked requiresShipping measurement{weight{value unit}} countryCodeOfOrigin harmonizedSystemCode }
   metafields(first:40){nodes{namespace key type value}} }}
} pageInfo{hasNextPage endCursor}}}"""
out=[];cur=None;n=0
while True:
    d=src_gql(Q,{"c":cur}); out+=d['products']['nodes']; n+=1
    if n%10==0: print(f"  {len(out)} products", flush=True)
    if not d['products']['pageInfo']['hasNextPage']: break
    cur=d['products']['pageInfo']['endCursor']
json.dump(out,open('export/products.json','w'))
print("TOTAL products:",len(out))
print("variants:",sum(len(p['variants']['nodes']) for p in out))
print("media:",sum(len(p['media']['nodes']) for p in out))
print("metafields:",sum(len(p['metafields']['nodes']) for p in out))
