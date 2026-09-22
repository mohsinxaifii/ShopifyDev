#!/usr/bin/env python3
"""Re-run after upgrading mohsinxaifi off the trial plan to upload the 7 videos
that Shopify rejected with UNACCEPTABLE_TRIAL_ASSET, then relink the 3 metafields
that point at them."""
import sys, json, os, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__),'lib'))
from sh import *
byid=json.load(open('export/files_byid.json'))
want=json.load(open('export/files_upload.json'))
fmap=json.load(open('maps/files.json'))
todo=[g for g in want if g not in fmap and byid[g]['type']=='Video']
print("videos to upload:",len(todo))
M="""mutation($f:[FileCreateInput!]!){fileCreate(files:$f){files{id fileStatus} userErrors{field message code}}}"""
for g in todo:
    url=byid[g]['url']
    d={"originalSource":url,"contentType":"VIDEO","filename":url.split('?')[0].split('/')[-1]}
    if byid[g].get('alt'): d['alt']=byid[g]['alt']
    r=dst_gql(M,{"f":[d]})['fileCreate']
    if r['userErrors']: print("  FAIL",d['filename'],r['userErrors'])
    else: fmap[g]={"id":r['files'][0]['id']}; print("  uploaded",d['filename'])
json.dump(fmap,open('maps/files.json','w'),indent=1)
print("\nnow re-run:  python3 reindex_files.py && python3 imp_deferred.py")
