import sys, json; sys.path.insert(0,'lib')
from sh import *
prods=json.load(open('export/products.json'))
pmap=json.load(open('maps/products.json'))
loc=dst_gql("{locations(first:5){nodes{id name}}}")['locations']['nodes'][0]['id']
print("location:",loc)
# map dest variant gid -> inventoryItem id
want={}   # (handle, sku) -> qty
for p in prods:
    for v in p['variants']['nodes']:
        q=v.get('inventoryQuantity') or 0
        if q: want[(p['handle'], v.get('sku') or v['title'])]=q
print("variants needing qty:",len(want))
# fetch dest variants' inventory item ids
vid2item={}; cur=None
while True:
    d=dst_gql("""query($c:String){productVariants(first:250,after:$c){nodes{id sku
      product{handle} inventoryItem{id}} pageInfo{hasNextPage endCursor}}}""",{"c":cur})
    for n in d['productVariants']['nodes']:
        vid2item[(n['product']['handle'], n['sku'] or '')]=n['inventoryItem']['id']
    if not d['productVariants']['pageInfo']['hasNextPage']: break
    cur=d['productVariants']['pageInfo']['endCursor']
print("dest variants indexed:",len(vid2item))
quantities=[]; missing=0
for (h,sku),q in want.items():
    item=vid2item.get((h,sku))
    if not item: missing+=1; continue
    quantities.append({"inventoryItemId":item,"locationId":loc,"quantity":q})
print("resolved:",len(quantities),"missing:",missing)
M="""mutation($i:InventorySetQuantitiesInput!){inventorySetQuantities(input:$i){
 userErrors{field message code}}}"""
ok=0
for i in range(0,len(quantities),100):
    r=dst_gql(M,{"i":{"name":"available","reason":"correction","ignoreCompareQuantity":True,
                      "quantities":quantities[i:i+100]}})['inventorySetQuantities']
    if r['userErrors']: print("  errs:",json.dumps(r['userErrors'])[:300])
    else: ok+=len(quantities[i:i+100])
print("inventory set for",ok,"variants")
