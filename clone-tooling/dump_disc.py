import sys, json; sys.path.insert(0,'lib')
from sh import *
pr=src_all("price_rules.json","price_rules")
for p in pr:
    try: p['_codes']=src_all(f"price_rules/{p['id']}/discount_codes.json","discount_codes")
    except Exception as e: p['_codes']=[]
json.dump(pr,open('export/price_rules.json','w'),indent=1)
print("price rules:",len(pr),"codes:",sum(len(p['_codes']) for p in pr))
from collections import Counter
print(Counter(p['target_type'] for p in pr))
print("entitlement types:",Counter(p['target_selection'] for p in pr))
# automatic discounts (GraphQL) - price_rules API only covers code discounts
d=src_gql("""{ automaticDiscountNodes(first:100){nodes{id automaticDiscount{__typename
  ... on DiscountAutomaticBasic{title status startsAt endsAt}
  ... on DiscountAutomaticBxgy{title status startsAt endsAt}
  ... on DiscountAutomaticFreeShipping{title status startsAt endsAt}
  ... on DiscountAutomaticApp{title status}}}}}""")
json.dump(d['automaticDiscountNodes']['nodes'],open('export/auto_discounts.json','w'),indent=1)
print("automatic discounts:",len(d['automaticDiscountNodes']['nodes']))
