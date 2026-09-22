import sys, json, re; sys.path.insert(0,'lib')
from sh import *
src_defs=json.load(open('export/metaobject_defs.json'))
src_gid2type={d['id']:d['type'] for d in src_defs}
dst_type2gid={d['type']:d['id'] for d in dst_gql('{metaobjectDefinitions(first:200){nodes{id type}}}')['metaobjectDefinitions']['nodes']}
json.dump(dst_type2gid,open('maps/metaobject_defs.json','w'),indent=1)

def remap(val):
    """rewrite source metaobject-definition GIDs to destination ones"""
    def one(g):
        t=src_gid2type.get(g)
        return dst_type2gid.get(t) if t else None
    if val.startswith('['):
        try: arr=json.loads(val)
        except: return val
        new=[one(g) or g for g in arr]
        if any(one(g) is None for g in arr): return None
        return json.dumps(new)
    r=one(val)
    return r

M="""mutation($d:MetaobjectDefinitionCreateInput!){metaobjectDefinitionCreate(definition:$d){
 metaobjectDefinition{id type} userErrors{field message code}}}"""
missing=[d for d in src_defs if not d['type'].startswith('shopify--') and d['type'] not in dst_type2gid]
print("still missing:",[d['type'] for d in missing])
for d in missing:
    fields=[]
    ok=True
    for f in d['fieldDefinitions']:
        fd={"key":f['key'],"name":f['name'],"type":f['type']['name'],"required":f['required']}
        if f.get('description'): fd['description']=f['description']
        vs=[]
        for x in (f.get('validations') or []):
            v=x['value']
            if 'metaobject_definition_id' in x['name']:
                v=remap(v)
                if v is None: print(f"   ! {d['type']}.{f['key']} -> unresolved metaobject ref, dropping validation"); continue
            vs.append({"name":x['name'],"value":v})
        if vs: fd['validations']=vs
        fields.append(fd)
    inp={"type":d['type'],"name":d['name'],"fieldDefinitions":fields}
    if d.get('description'): inp['description']=d['description']
    if d.get('displayNameKey'): inp['displayNameKey']=d['displayNameKey']
    caps={}; c=d.get('capabilities') or {}
    for k in ('publishable','translatable'):
        if (c.get(k) or {}).get('enabled'): caps[k]={"enabled":True}
    if caps: inp['capabilities']=caps
    acc=d.get('access') or {}
    if acc.get('storefront'): inp['access']={"storefront":acc['storefront']}
    r=dst_gql(M,{"d":inp})['metaobjectDefinitionCreate']
    if r['userErrors']: print(f"  FAIL {d['type']}: {r['userErrors']}")
    else:
        dst_type2gid[d['type']]=r['metaobjectDefinition']['id']; print(f"  created {d['type']}")
json.dump(dst_type2gid,open('maps/metaobject_defs.json','w'),indent=1)
print("dest metaobject defs now:",len(dst_type2gid))
