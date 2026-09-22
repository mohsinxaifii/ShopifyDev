import sys, json, os, time; sys.path.insert(0,'lib')
from sh import *

prods=json.load(open('export/products.json'))
dst_files=json.load(open('maps/dest_files_byname.json'))
src_byid=json.load(open('export/files_byid.json'))

DEFER={'product_reference','variant_reference','collection_reference','page_reference','metaobject_reference',
       'list.product_reference','list.variant_reference','list.collection_reference','list.page_reference',
       'list.metaobject_reference'}
FILEREF={'file_reference','list.file_reference'}
SKIP_NS=lambda ns: ns.startswith('shopify--') or ns.startswith('app--') or ns=='shopify'

def basename(u): return u.split('?')[0].split('/')[-1] if u else None

def map_fileref(val, typ):
    """rewrite source file GIDs -> dest file GIDs; return None if unresolvable"""
    def one(g):
        f=src_byid.get(g)
        if not f or not f.get('url'): return None
        return dst_files.get(basename(f['url']))
    if typ.startswith('list.'):
        try: arr=json.loads(val)
        except: return None
        new=[one(g) for g in arr]
        new=[x for x in new if x]
        return json.dumps(new) if new else None
    return one(val)

def clean_mf(nodes, deferred_out, owner_tag):
    keep=[]
    for m in nodes:
        ns,key,typ,val=m['namespace'],m['key'],m['type'],m['value']
        if SKIP_NS(ns): continue
        if typ in DEFER:
            deferred_out.append({"owner":owner_tag,"namespace":ns,"key":key,"type":typ,"value":val}); continue
        if typ in FILEREF:
            nv=map_fileref(val,typ)
            if nv: keep.append({"namespace":ns,"key":key,"type":typ,"value":nv})
            else: deferred_out.append({"owner":owner_tag,"namespace":ns,"key":key,"type":typ,"value":val})
            continue
        keep.append({"namespace":ns,"key":key,"type":typ,"value":val})
    return keep

M="""mutation($p:ProductSetInput!){productSet(synchronous:true,input:$p){
 product{id handle variants(first:100){nodes{id sku title}} media(first:60){nodes{id}}}
 userErrors{field message code}}}"""

def build(p, deferred):
    tag=p['handle']
    opts=[]
    for o in p['options']:
        opts.append({"name":o['name'],"position":o['position'],"values":[{"name":v} for v in o['values']]})
    files=[]
    for m in p['media']['nodes']:
        u=(m.get('image') or {}).get('url') or (m.get('originalSource') or {}).get('url')
        if m['__typename']=='ExternalVideo':
            u=m.get('originUrl'); ct="EXTERNAL_VIDEO"
        elif m['__typename']=='Video': ct="VIDEO"
        elif m['__typename']=='Model3d': ct="MODEL_3D"
        else: ct="IMAGE"
        if not u: continue
        f={"originalSource":u,"contentType":ct}
        if m.get('alt'): f['alt']=m['alt']
        files.append(f)
    variants=[]
    for v in p['variants']['nodes']:
        vd={"optionValues":[{"optionName":so['name'],"name":so['value']} for so in v['selectedOptions']],
            "price":v['price'],"taxable":v['taxable'],"inventoryPolicy":v['inventoryPolicy']}
        if v.get('compareAtPrice'): vd['compareAtPrice']=v['compareAtPrice']
        if v.get('barcode'): vd['barcode']=v['barcode']
        if v.get('taxCode'): vd['taxCode']=v['taxCode']
        ii=v.get('inventoryItem') or {}
        iid={"tracked":ii.get('tracked',True),"requiresShipping":ii.get('requiresShipping',True)}
        if v.get('sku'): iid['sku']=v['sku']
        meas=(ii.get('measurement') or {}).get('weight')
        if meas and meas.get('value') is not None:
            iid['measurement']={"weight":{"value":meas['value'],"unit":meas['unit']}}
        if ii.get('countryCodeOfOrigin'): iid['countryCodeOfOrigin']=ii['countryCodeOfOrigin']
        if ii.get('harmonizedSystemCode'): iid['harmonizedSystemCode']=ii['harmonizedSystemCode']
        vd['inventoryItem']=iid
        vmf=clean_mf(v['metafields']['nodes'], deferred, f"variant::{tag}::{v.get('sku') or v['title']}")
        if vmf: vd['metafields']=vmf
        vi=(v.get('image') or {}).get('url')
        if vi: vd['file']={"originalSource":vi,"contentType":"IMAGE"}
        variants.append(vd)
    inp={"handle":p['handle'],"title":p['title'],"descriptionHtml":p.get('descriptionHtml') or "",
         "vendor":p.get('vendor') or "","productType":p.get('productType') or "",
         "tags":p.get('tags') or [], "status":p['status'],
         "productOptions":opts,"variants":variants}
    if p.get('templateSuffix'): inp['templateSuffix']=p['templateSuffix']
    if p.get('category'): inp['category']=p['category']['id']
    seo=p.get('seo') or {}
    s={k:v for k,v in seo.items() if v}
    if s: inp['seo']=s
    if files: inp['files']=files
    pmf=clean_mf(p['metafields']['nodes'], deferred, f"product::{tag}")
    if pmf: inp['metafields']=pmf
    return inp

if __name__=="__main__":
    limit=int(sys.argv[1]) if len(sys.argv)>1 else len(prods)
    MAPF='maps/products.json'; DEFF='maps/deferred_mf.json'
    pmap=json.load(open(MAPF)) if os.path.exists(MAPF) else {}
    deferred=json.load(open(DEFF)) if os.path.exists(DEFF) else []
    done=0; fail=0; errors=[]
    todo=[p for p in prods if p['handle'] not in pmap][:limit]
    print("to import:",len(todo))
    for i,p in enumerate(todo,1):
        dd=[]
        try:
            r=dst_gql(M,{"p":build(p,dd)})['productSet']
        except Exception as e:
            fail+=1; errors.append((p['handle'],str(e)[:300])); continue
        if r['userErrors']:
            fail+=1; errors.append((p['handle'],json.dumps(r['userErrors'])[:400])); continue
        np=r['product']
        pmap[p['handle']]={"id":np['id'],"src":p['id'],
                           "variants":{v['sku'] or v['title']:v['id'] for v in np['variants']['nodes']}}
        deferred+=dd; done+=1
        if i%25==0:
            json.dump(pmap,open(MAPF,'w')); json.dump(deferred,open(DEFF,'w'))
            print(f"  {i}/{len(todo)} ok={done} fail={fail}", flush=True)
    json.dump(pmap,open(MAPF,'w')); json.dump(deferred,open(DEFF,'w'))
    print(f"DONE ok={done} fail={fail} deferred_mf={len(deferred)}")
    for h,e in errors[:15]: print("  FAIL",h,e[:250])
