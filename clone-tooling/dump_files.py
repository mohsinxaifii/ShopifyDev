import sys, json, time; sys.path.insert(0,'lib')
from sh import *
Q="""query($c:String){files(first:250,after:$c,sortKey:CREATED_AT){nodes{
 __typename id fileStatus alt createdAt
 ... on MediaImage{ image{url width height} mimeType originalSource{fileSize} }
 ... on Video{ originalSource{url fileSize mimeType} filename }
 ... on GenericFile{ url mimeType originalFileSize }
} pageInfo{hasNextPage endCursor}}}"""
out=[]; cur=None; page=0
while True:
    d=src_gql(Q,{"c":cur}); page+=1
    out+=d['files']['nodes']
    if page%20==0: print(f"  page {page} total {len(out)}", flush=True)
    if not d['files']['pageInfo']['hasNextPage']: break
    cur=d['files']['pageInfo']['endCursor']
json.dump(out,open('export/files_all.json','w'))
print("TOTAL",len(out))
