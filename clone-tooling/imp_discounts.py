import sys, json, os; sys.path.insert(0,'lib')
from sh import *
prs=json.load(open('export/price_rules.json'))
pmap=json.load(open('maps/products.json'))
cmap=json.load(open('maps/collections.json'))
src_prod={int(p['id'].split('/')[-1]):p['handle'] for p in json.load(open('export/products.json'))}
src_col={int(c['id'].split('/')[-1]):c['handle'] for c in json.load(open('export/collections.json'))}
src_var={}
for p in json.load(open('export/products.json')):
    for v in p['variants']['nodes']:
        src_var[int(v['id'].split('/')[-1])]=(p['handle'], v.get('sku') or v['title'])

def nid(gid): return int(gid.split('/')[-1])
def m_prod(i):
    h=src_prod.get(i); return nid(pmap[h]['id']) if h in pmap else None
def m_col(i):
    h=src_col.get(i); return nid(cmap[h]['id']) if h in cmap else None
def m_var(i):
    t=src_var.get(i)
    if not t: return None
    h,sku=t
    e=pmap.get(h)
    if not e: return None
    vid=e['variants'].get(sku)
    return nid(vid) if vid else None

dmap=json.load(open('maps/discounts.json')) if os.path.exists('maps/discounts.json') else {}
ok=0; errs=[]; warn=[]
for p in prs:
    code=(p['_codes'][0]['code'] if p['_codes'] else p['title'])
    if code in dmap: continue
    body={"title":p['title'],"value_type":p['value_type'],"value":p['value'],
          "customer_selection":p['customer_selection'],"target_type":p['target_type'],
          "target_selection":p['target_selection'],"allocation_method":p['allocation_method'],
          "starts_at":p['starts_at']}
    for k in ("ends_at","usage_limit","allocation_limit","once_per_customer"):
        if p.get(k) is not None: body[k]=p[k]
    for src_key,fn in (("entitled_product_ids",m_prod),("entitled_variant_ids",m_var),
                       ("entitled_collection_ids",m_col),("prerequisite_product_ids",m_prod),
                       ("prerequisite_variant_ids",m_var),("prerequisite_collection_ids",m_col)):
        ids=p.get(src_key) or []
        if not ids: continue
        new=[fn(i) for i in ids]
        if any(x is None for x in new): warn.append((code,src_key,sum(1 for x in new if x is None),len(ids)))
        new=[x for x in new if x]
        if new: body[src_key]=new
    if p.get('entitled_country_ids'): body['entitled_country_ids']=p['entitled_country_ids']
    for k in ("prerequisite_subtotal_range","prerequisite_quantity_range","prerequisite_shipping_price_range"):
        if p.get(k): body[k]=p[k]
    r2=p.get('prerequisite_to_entitlement_quantity_ratio') or {}
    if r2.get('prerequisite_quantity') or r2.get('entitled_quantity'): body['prerequisite_to_entitlement_quantity_ratio']=r2
    r3=p.get('prerequisite_to_entitlement_purchase') or {}
    if r3.get('prerequisite_amount'): body['prerequisite_to_entitlement_purchase']=r3
    # target_selection entitled requires at least one entitlement
    if body['target_selection']=='entitled' and not any(k in body for k in
        ("entitled_product_ids","entitled_variant_ids","entitled_collection_ids")):
        errs.append((code,"entitled rule lost all targets (products/collections not imported)")); continue
    try:
        r=dst("POST","price_rules.json",{"price_rule":body})
    except Exception as e:
        errs.append((code,str(e)[:300])); continue
    prid=r['price_rule']['id']
    made=[]
    for c in p['_codes']:
        try:
            rc=dst("POST",f"price_rules/{prid}/discount_codes.json",{"discount_code":{"code":c['code']}})
            made.append(rc['discount_code']['code'])
        except Exception as e: errs.append((c['code'],"code: "+str(e)[:200]))
    dmap[code]={"price_rule":prid,"codes":made}; ok+=1
json.dump(dmap,open('maps/discounts.json','w'),indent=1)
print(f"discounts ok={ok} errors={len(errs)}")
for c,e in errs: print("   FAIL",c,str(e)[:200])
if warn:
    print("partial target remaps:")
    for c,k,miss,tot in warn: print(f"   {c}: {k} {miss}/{tot} unresolved")
