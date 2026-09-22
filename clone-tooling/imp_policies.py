import sys, json; sys.path.insert(0,'lib')
from sh import *
pol=json.load(open('export/policies.json'))
TYPE={'Privacy policy':'PRIVACY_POLICY','Refund policy':'REFUND_POLICY','Terms of service':'TERMS_OF_SERVICE',
      'Shipping':'SHIPPING_POLICY','Shipping policy':'SHIPPING_POLICY','Contact':'CONTACT_INFORMATION',
      'Contact information':'CONTACT_INFORMATION','Legal notice':'LEGAL_NOTICE',
      'Terms of sale':'TERMS_OF_SALE','Subscription policy':'SUBSCRIPTION_POLICY'}
M="""mutation($p:ShopPolicyInput!){shopPolicyUpdate(shopPolicy:$p){shopPolicy{type} userErrors{field message}}}"""
for p in pol:
    t=TYPE.get(p['title'])
    if not t: print("  ? unknown policy:",p['title']); continue
    if not p.get('body'): continue
    r=dst_gql(M,{"p":{"type":t,"body":p['body']}})['shopPolicyUpdate']
    print(("  set " if not r['userErrors'] else "  FAIL ")+p['title']+("" if not r['userErrors'] else f" {r['userErrors']}"))
