/**
 * Shopper location: whether the shopper is in the ZNow (same-day) area, and
 * their delivery pincode.
 *
 * - The browser's own location prompt is raised once per browser, on the first
 *   page of the first visit, and never again whatever the answer - allow,
 *   block, closing it, or leaving the page before answering.
 * - On the first page of every later visit it is refreshed silently, but only
 *   when the browser already reports the permission as granted, so no browser
 *   ever re-asks (Safari would, if asked without that check).
 *
 * ZNow is decided from the coordinates themselves, with no service in between:
 * assets/znow-area.json holds the area's outline (Delhi, Gurugram, Faridabad,
 * Gautam Buddha Nagar, Ghaziabad - open it on geojson.io to see or edit it)
 * and the point is tested against it here. A pincode the shopper types instead
 * (e.g. the product page's delivery check) is tested against the list in
 * snippets/znow-pincodes. <html> carries "is-znow" while either says yes - set
 * before first paint by snippets/location, kept in step here.
 *
 * The pincode for a location is a best-effort extra from OpenStreetMap, for
 * prefilling pincode boxes; ZNow never waits on it, and a failed lookup only
 * leaves it blank.
 *
 * Other scripts read it through window.zinaraLocation:
 *   get()                 -> { pincode, city, state, source, status, updated, znow } (a copy)
 *   set(pincode, extra)   -> saves a pincode the shopper typed (source 'manual' by default)
 *   detect()              -> asks the browser now (from a click, e.g. "Use my location")
 *   permission()          -> 'granted' | 'denied' | 'prompt' | 'unknown', never asks
 *   isZnow(pincode)       -> whether a pincode gets same-day ZNow delivery
 *   serves(pincode)       -> Promise: whether it is delivered to at all
 *                            (ZNow pincodes at once, others by assets/pincodes.json)
 *   and listen for the 'zinara:location' event on document (detail = get()).
 */
(() => {
  if (window.zinaraLocation) return;

  const KEY = 'zinara_location';
  const SESSION_KEY = 'zinara_location_session';
  const PINCODE = /^[1-9][0-9]{5}$/;
  // A visit whose session flag cannot be kept still refreshes at most this often.
  const REFRESH_AFTER = 30 * 60 * 1000;
  // Within ~100m of the last fix nothing is looked up again.
  const SAME_PLACE = 0.001;

  const config = window.zinaraLocationConfig || {};
  const znowPincodes = new Set(config.znowPincodes || []);
  const pincodeIsZnow = (pincode) => znowPincodes.has(String(pincode || ''));

  /* -------------------------------------------------------------- storage */

  // localStorage first; a cookie as well, for browsers that refuse storage.
  function read() {
    try {
      const value = JSON.parse(window.localStorage.getItem(KEY));
      if (value && typeof value === 'object') return value;
    } catch (error) {
      /* storage blocked - try the cookie */
    }
    try {
      const match = document.cookie.match(new RegExp(`(?:^|; )${KEY}=([^;]*)`));
      if (match) return JSON.parse(decodeURIComponent(match[1])) || {};
    } catch (error) {
      /* unreadable cookie - start afresh */
    }
    return {};
  }

  function write(value) {
    const text = JSON.stringify(value);
    try {
      window.localStorage.setItem(KEY, text);
    } catch (error) {
      /* storage blocked - the cookie still holds it */
    }
    try {
      document.cookie = `${KEY}=${encodeURIComponent(text)}; path=/; max-age=31536000; SameSite=Lax`;
    } catch (error) {
      /* cookies blocked - nothing else to do */
    }
  }

  function sessionStarted() {
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return true;
      window.sessionStorage.setItem(SESSION_KEY, '1');
      return false;
    } catch (error) {
      const state = read();
      return Boolean(state.updated && Date.now() - state.updated < REFRESH_AFTER);
    }
  }

  let state = read();

  /* Same rule as the inline script in snippets/location: a typed pincode
     decides by the list; a location fix by the area. */
  function znowNow() {
    if (config.znowPreview) return true;
    if (state.source === 'gps' && typeof state.inZnowArea === 'boolean') return state.inZnowArea;
    return pincodeIsZnow(state.pincode);
  }

  function save(changes) {
    state = { ...state, ...changes, updated: Date.now() };
    write(state);
    document.documentElement.classList.toggle('is-znow', znowNow());
    document.dispatchEvent(new CustomEvent('zinara:location', { detail: api.get() }));
    return api.get();
  }

  /* ----------------------------------------------------------------- area */

  let area = null;

  // Fetched once per page, only when there is a fix to test; a failure is
  // retried on the next fix.
  function loadArea() {
    if (!area) {
      area = fetch(config.znowAreaUrl, { credentials: 'omit' })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          area = null;
          throw error;
        });
    }
    return area;
  }

  // Ray casting; GeoJSON rings are [lng, lat].
  function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const inPolygon = (lng, lat, rings) =>
    inRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lng, lat, hole));

  function inArea(lng, lat, collection) {
    return (collection.features || []).some(({ geometry }) => {
      if (!geometry) return false;
      if (geometry.type === 'Polygon') return inPolygon(lng, lat, geometry.coordinates);
      if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((rings) => inPolygon(lng, lat, rings));
      return false;
    });
  }

  /* -------------------------------------------------------------- pincode */

  // OpenStreetMap's free service: no key, open to browsers, ~1 request a
  // second for the whole site - which once a visit per shopper stays inside.
  async function lookupPincode(lat, lng) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`,
        { signal: controller.signal, credentials: 'omit' }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const address = (await response.json()).address || {};
      const pincode = String(address.postcode || '').replace(/\s+/g, '');
      return {
        pincode: address.country_code === 'in' && PINCODE.test(pincode) ? pincode : '',
        city: address.city || address.town || address.village || address.state_district || '',
        state: address.state || '',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------- geolocation */

  const canLocate = () => Boolean(navigator.geolocation && window.isSecureContext);

  // High accuracy: network-only fixes are often a few km out, enough to be on
  // the wrong side of the area's edge.
  function position() {
    return new Promise((resolve, reject) => {
      if (!canLocate()) {
        reject({ code: 2, message: 'Geolocation unavailable' });
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 10 * 60 * 1000,
      });
    });
  }

  async function permission() {
    if (!canLocate()) return 'denied';
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state;
    } catch (error) {
      return 'unknown';
    }
  }

  let detecting = null;

  /** Resolves with get() once the area is known (the pincode may still be
      blank); rejects with an Error whose `code` is 'denied', 'unavailable',
      'timeout' or 'area' (the outline could not be loaded). */
  function detect() {
    if (detecting) return detecting;
    detecting = (async () => {
      let coords;
      try {
        ({ coords } = await position());
      } catch (error) {
        // GeolocationPositionError: 1 denied, 2 unavailable, 3 timeout.
        const code = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        if (code === 'denied') save({ status: 'denied' });
        throw Object.assign(new Error(error.message || code), { code });
      }

      const lat = Number(coords.latitude.toFixed(4));
      const lng = Number(coords.longitude.toFixed(4));
      const samePlace =
        state.source === 'gps' &&
        typeof state.inZnowArea === 'boolean' &&
        Math.abs(state.lat - lat) < SAME_PLACE &&
        Math.abs(state.lng - lng) < SAME_PLACE;
      if (samePlace && state.pincode) return save({ status: 'granted' });

      let inZnowArea = samePlace ? state.inZnowArea : null;
      if (inZnowArea === null) {
        try {
          inZnowArea = inArea(lng, lat, await loadArea());
        } catch (error) {
          save({ status: 'granted' });
          throw Object.assign(new Error('ZNow area unavailable'), { code: 'area' });
        }
      }
      // The pincode belongs to the old fix, if any; replaced below when found.
      const result = save({
        status: 'granted',
        source: 'gps',
        inZnowArea,
        lat,
        lng,
        ...(samePlace ? {} : { pincode: '', city: '', state: '' }),
      });

      lookupPincode(lat, lng)
        .then((place) => {
          if (state.lat === lat && state.lng === lng && state.source === 'gps') save(place);
        })
        .catch(() => {});
      return result;
    })();
    detecting
      .finally(() => {
        detecting = null;
      })
      .catch(() => {});
    return detecting;
  }

  /* --------------------------------------------------------- delivered to */

  let served = null;

  // Fetched once, on first use; a failed fetch is retried next time.
  function serves(pincode) {
    const value = cleanPincode(pincode);
    if (!PINCODE.test(value)) return Promise.resolve(false);
    if (pincodeIsZnow(value)) return Promise.resolve(true);
    if (!served) {
      served = fetch(config.pincodesUrl, { credentials: 'omit' })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((list) => new Set(list.map(String)))
        .catch((error) => {
          served = null;
          throw error;
        });
    }
    return served.then((list) => list.has(value));
  }

  /* ------------------------------------------------------------------ api */

  const cleanPincode = (value) => String(value || '').replace(/\s+/g, '');

  const api = {
    get() {
      const { pincode = '', city = '', state: region = '', source = '', status = '', updated = 0 } = state;
      return { pincode, city, state: region, source, status, updated, znow: znowNow() };
    },
    set(pincode, extra = {}) {
      const value = cleanPincode(pincode);
      if (!PINCODE.test(value)) return null;
      // A typed pincode has no city attached unless the caller knows it.
      return save({ city: '', state: '', ...extra, pincode: value, source: extra.source || 'manual' });
    },
    detect,
    permission,
    isValid: (pincode) => PINCODE.test(cleanPincode(pincode)),
    isZnow: (pincode) => pincodeIsZnow(cleanPincode(pincode)),
    serves,
  };
  window.zinaraLocation = api;
  document.documentElement.classList.toggle('is-znow', znowNow());

  /* ---------------------------------------------------------------- start */

  const track = (status) => window.zinaraTrack?.('location_permission', { status, page_type: config.pageType });

  async function start() {
    // Switched off in theme settings, in the theme editor, or for automated
    // browsers (Lighthouse, bots): the API still works, nothing runs by itself.
    if (config.enabled === false || window.Shopify?.designMode || navigator.webdriver) return;

    const firstPageOfVisit = !sessionStarted();
    const browser = await permission();

    if (!state.asked) {
      // First visit ever: the one time the browser is asked. Marked before
      // asking, so a shopper who leaves without answering is not asked again.
      save({ asked: Date.now(), status: browser === 'denied' ? 'denied' : '' });
      if (browser === 'denied') return;
      detect()
        .then((result) => track(result.znow ? 'success_znow' : 'success'))
        .catch((error) => track(error.code));
      return;
    }

    // A pincode the shopper typed (e.g. on a product page) is kept - it may
    // be where they want delivery, not where they are.
    if (firstPageOfVisit && browser === 'granted' && (!state.source || state.source === 'gps')) {
      detect().catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
