"""Shopify helper. HARD GUARD: source store is read-only, always."""
import json, os, time, urllib.request, urllib.error, sys

SRC = ("432866-5c.myshopify.com", os.environ.get("SRC_TOKEN", ""))
DST = ("mohsinxaifi.myshopify.com", os.environ.get("DST_TOKEN", ""))
VER = "2025-07"

class SourceWriteBlocked(Exception): pass

def _req(store, token, method, path, body=None, full_url=None, raw=False):
    if store == SRC[0] and method.upper() not in ("GET", "HEAD"):
        raise SourceWriteBlocked(f"BLOCKED {method} {path} on SOURCE store")
    url = full_url or f"https://{store}/admin/api/{VER}/{path.lstrip('/')}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method.upper())
    req.add_header("X-Shopify-Access-Token", token)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = r.read()
                link = r.headers.get("Link", "")
                if raw: return payload, link
                return (json.loads(payload) if payload else {}), link
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:2000]
            if e.code in (429, 502, 503, 504):
                wait = float(e.headers.get("Retry-After", 2 + attempt * 2))
                time.sleep(wait); continue
            raise RuntimeError(f"HTTP {e.code} {method} {url}\n{err}") from None
        except urllib.error.URLError:
            time.sleep(2 + attempt * 2); continue
    raise RuntimeError(f"giving up after retries: {method} {url}")

def src_get(path, **kw):  return _req(SRC[0], SRC[1], "GET", path, **kw)[0]
def dst_get(path, **kw):  return _req(DST[0], DST[1], "GET", path, **kw)[0]
def dst(method, path, body=None): return _req(DST[0], DST[1], method, path, body)[0]

def _paged(store, token, path, key):
    out, url = [], None
    first = True
    while True:
        if first:
            sep = "&" if "?" in path else "?"
            data, link = _req(store, token, "GET", f"{path}{sep}limit=250")
            first = False
        else:
            data, link = _req(store, token, "GET", None, full_url=url)
        out.extend(data.get(key, []))
        url = None
        for part in link.split(","):
            if 'rel="next"' in part:
                url = part.split(";")[0].strip().strip("<>")
        if not url: return out

def src_all(path, key): return _paged(SRC[0], SRC[1], path, key)
def dst_all(path, key): return _paged(DST[0], DST[1], path, key)

def _gql(store, token, query, variables=None, readonly=False):
    if store == SRC[0] and not readonly:
        low = query.lower()
        if "mutation" in low: raise SourceWriteBlocked("BLOCKED GraphQL mutation on SOURCE")
    url = f"https://{store}/admin/api/{VER}/graphql.json"
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("X-Shopify-Access-Token", token)
    req.add_header("Content-Type", "application/json")
    for attempt in range(10):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.loads(r.read())
            if "errors" in d:
                msg = json.dumps(d["errors"])[:1500]
                if "THROTTLED" in msg.upper():
                    time.sleep(3 + attempt * 2); continue
                raise RuntimeError(f"GraphQL errors: {msg}")
            return d["data"]
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:1500]
            if e.code in (429, 502, 503, 504):
                time.sleep(2 + attempt * 2); continue
            raise RuntimeError(f"HTTP {e.code} gql {store}\n{err}") from None
        except urllib.error.URLError:
            time.sleep(2 + attempt * 2); continue
    raise RuntimeError("gql retries exhausted")

def src_gql(q, v=None):
    if "mutation" in q.lower(): raise SourceWriteBlocked("BLOCKED mutation on SOURCE")
    return _gql(SRC[0], SRC[1], q, v, readonly=True)
def dst_gql(q, v=None): return _gql(DST[0], DST[1], q, v)

def j(o): print(json.dumps(o, indent=2, default=str)[:6000])
