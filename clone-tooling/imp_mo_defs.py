import sys, json; sys.path.insert(0,'lib')
from sh import *
defs=json.load(open('export/metaobject_defs.json'))
M="""mutation($d:MetaobjectDefinitionCreateInput!){metaobjectDefinitionCreate(definition:$d){
 metaobjectDefinition{id type} userErrors{field message code}}}"""
existing={d['type']:d['id'] for d in dst_gql('{metaobjectDefinitions(first:200){nodes{id type}}}')['metaobjectDefinitions']['nodes']}
idmap=dict(existing); created=skipped=failed=0
# create non-shopify defs first, then shopify-- (they may be referenced)
order=sorted(defs,key=lambda d: d['type'].startswith('shopify--'))
for d in order:
    t=d['type']
    if t in existing: print(f"  exists {t}"); skipped+=1; continue
    if t.startswith('shopify--'):
        print(f"  SKIP (Shopify-managed) {t}"); skipped+=1; continue
    fields=[]
    for f in d['fieldDefinitions']:
        fd={"key":f['key'],"name":f['name'],"type":f['type']['name'],"required":f['required']}
        if f.get('description'): fd['description']=f['description']
        v=[{"name":x['name'],"value":x['value']} for x in (f.get('validations') or [])]
        if v: fd['validations']=v
        fields.append(fd)
    inp={"type":t,"name":d['name'],"fieldDefinitions":fields}
    if d.get('description'): inp['description']=d['description']
    if d.get('displayNameKey'): inp['displayNameKey']=d['displayNameKey']
    caps={}
    c=d.get('capabilities') or {}
    if (c.get('publishable') or {}).get('enabled'): caps['publishable']={"enabled":True}
    if (c.get('translatable') or {}).get('enabled'): caps['translatable']={"enabled":True}
    if (c.get('renderable') or {}).get('enabled'):
        rd=c['renderable'].get('data') or {}
        caps['renderable']={"enabled":True,"data":{k:v for k,v in rd.items() if v}}
    if (c.get('onlineStore') or {}).get('enabled'):
        od=c['onlineStore'].get('data') or {}
        caps['onlineStore']={"enabled":True,"data":{k:v for k,v in od.items() if v}}
    if caps: inp['capabilities']=caps
    acc=d.get('access') or {}
    a={}
    adm={'PUBLIC_READ_WRITE':'MERCHANT_READ_WRITE','MERCHANT_READ_WRITE':'MERCHANT_READ_WRITE',
         'PUBLIC_READ':'MERCHANT_READ','MERCHANT_READ':'MERCHANT_READ'}.get(acc.get('admin'))
    if acc.get('storefront'): a['storefront']=acc['storefront']
    if a: inp['access']=a
    r=dst_gql(M,{"d":inp})['metaobjectDefinitionCreate']
    if r['userErrors']:
        print(f"  FAIL {t}: {r['userErrors']}"); failed+=1
    else:
        idmap[t]=r['metaobjectDefinition']['id']; created+=1; print(f"  created {t}")
json.dump(idmap,open('maps/metaobject_defs.json','w'),indent=1)
print(f"\ncreated={created} skipped={skipped} failed={failed}")
