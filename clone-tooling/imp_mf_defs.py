import sys, json; sys.path.insert(0,'lib')
from sh import *
defs=json.load(open('export/metafield_defs.json'))
src_mo={d['id']:d['type'] for d in json.load(open('export/metaobject_defs.json'))}
dst_mo=json.load(open('maps/metaobject_defs.json'))

def remap(name,val):
    if 'metaobject_definition_id' not in name: return val
    def one(g):
        t=src_mo.get(g); return dst_mo.get(t) if t else None
    if val.strip().startswith('['):
        arr=json.loads(val); new=[one(g) for g in arr]
        return json.dumps(new) if all(new) else None
    return one(val)

M="""mutation($d:MetafieldDefinitionInput!){metafieldDefinitionCreate(definition:$d){
 createdDefinition{id namespace key} userErrors{field message code}}}"""
created=skipped=failed=0; fails=[]
for owner, lst in defs.items():
    have={(d['namespace'],d['key']) for d in dst_gql(
        'query($o:MetafieldOwnerType!){metafieldDefinitions(first:250,ownerType:$o){nodes{namespace key}}}',
        {"o":owner})['metafieldDefinitions']['nodes']}
    for d in lst:
        ns,key=d['namespace'],d['key']
        if (ns,key) in have: skipped+=1; continue
        # app/Shopify-reserved namespaces cannot be created by us
        if ns.startswith('shopify--') or ns=='shopify' or ns.startswith('app--'):
            skipped+=1; fails.append((owner,f"{ns}.{key}","reserved-namespace (Shopify/app-managed)")); continue
        inp={"name":d['name'],"namespace":ns,"key":key,"type":d['type']['name'],"ownerType":owner}
        if d.get('description'): inp['description']=d['description']
        vs=[]; bad=False
        for x in (d.get('validations') or []):
            v=remap(x['name'],x['value'])
            if v is None: bad=True; continue
            vs.append({"name":x['name'],"value":v})
        if vs: inp['validations']=vs
        if d.get('pinnedPosition') is not None: inp['pin']=True
        caps=d.get('capabilities') or {}
        cin={}
        if (caps.get('smartCollectionCondition') or {}).get('enabled'): cin['smartCollectionCondition']={"enabled":True}
        if (caps.get('adminFilterable') or {}).get('enabled'): cin['adminFilterable']={"enabled":True}
        if (caps.get('uniqueValues') or {}).get('enabled'): cin['uniqueValues']={"enabled":True}
        if cin: inp['capabilities']=cin
        try:
            r=dst_gql(M,{"d":inp})['metafieldDefinitionCreate']
        except Exception as e:
            failed+=1; fails.append((owner,f"{ns}.{key}",str(e)[:150])); continue
        if r['userErrors']:
            failed+=1; fails.append((owner,f"{ns}.{key}",json.dumps(r['userErrors'])[:200]))
        else: created+=1
print(f"created={created} skipped={skipped} failed={failed}")
for o,k,e in fails: print(f"   {o:<14} {k:<52} {e[:120]}")
