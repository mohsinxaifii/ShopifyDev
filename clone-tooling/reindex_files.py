import sys, json; sys.path.insert(0,'lib')
from sh import *
cur=None; idx={}; n=0
while True:
    d=dst_gql("""query($c:String){files(first:250,after:$c){nodes{id
      ... on MediaImage{image{url}} ... on Video{originalSource{url}} ... on GenericFile{url}}
      pageInfo{hasNextPage endCursor}}}""",{"c":cur})
    for x in d['files']['nodes']:
        u=(x.get('image') or {}).get('url') or (x.get('originalSource') or {}).get('url') or x.get('url')
        if u: idx[u.split('?')[0].split('/')[-1]]=x['id']
    n+=len(d['files']['nodes'])
    if not d['files']['pageInfo']['hasNextPage']: break
    cur=d['files']['pageInfo']['endCursor']
json.dump(idx,open('maps/dest_files_byname.json','w'))
print("dest files:",n,"unique names:",len(idx))
