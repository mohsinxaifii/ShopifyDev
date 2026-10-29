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
 * - Except on phones, where a prompt left unanswered is raised again on each
 *   later visit until it is answered - see start().
 *
 * ZNow is decided from the coordinates themselves, with no service in between:
 * assets/znow-area.json holds the area's outline (Delhi, Gurugram, Faridabad,
 * Gautam Buddha Nagar, Ghaziabad - open it on geojson.io to see or edit it)
 * and the point is tested against it here. A pincode the shopper types instead
 * (e.g. the product page's delivery check) is tested against the list in
 * snippets/znow-pincodes. <html> carries "is-znow" while either says yes - set
 * before first paint by snippets/location, kept in step here.
 *
 * The pincode for a location comes from NCR's pincode outlines
 * (assets/ncr-pincodes.json), tested here like the area, or from
 * OpenStreetMap outside them - for the header and prefilling pincode boxes;
 * ZNow never waits on it, and a failed lookup only leaves it blank.
 *
 * Other scripts read it through window.zinaraLocation:
 *   get()                 -> { pincode, city, state, source, status, updated, znow, leftZnow, locating }
 *                            (a copy; leftZnow: moved from a ZNow pincode to one outside the
 *                            area; locating: a location fix whose pincode is still being found)
 *   set(pincode, extra)   -> saves a pincode the shopper typed (source 'manual' by default)
 *   detect()              -> asks the browser now (from a click, e.g. "Use my location")
 *   permission()          -> 'granted' | 'denied' | 'prompt' | 'unknown', never asks
 *   isZnow(pincode)       -> whether a pincode gets same-day ZNow delivery
 *   serves(pincode)       -> Promise: whether it is delivered to at all
 *                            (ZNow pincodes at once, others by assets/pincodes.json)
 *   deliveryDays(pincode) -> Promise: { ready, made } days to delivery there, by
 *                            Shiprocket's earliest courier, or null (use fixed days)
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

  /* Same rule as the inline script in snippets/location. The pincode list
     (snippets/znow-pincodes) decides: a typed pincode by the list alone; a
     location fix has to be inside the area AND, once its pincode is known,
     on the list too - the outline alone decides only while no pincode has
     been found for it. */
  function znowNow() {
    if (config.znowPreview) return true;
    if (state.source === 'gps' && typeof state.inZnowArea === 'boolean') {
      return state.inZnowArea && (!state.pincode || pincodeIsZnow(state.pincode));
    }
    return pincodeIsZnow(state.pincode);
  }

  /* A ZNow change on an open page: <html> carries "znow-switching" for a
     moment, so everything that swaps with it (card bars, the header chip,
     the PDP pills) fades in rather than snapping - and only then, not on
     every page load. */
  let switching;
  function setZnow(on) {
    const root = document.documentElement;
    if (root.classList.contains('is-znow') === on) return;
    root.classList.add('znow-switching');
    root.classList.toggle('is-znow', on);
    clearTimeout(switching);
    switching = setTimeout(() => root.classList.remove('znow-switching'), 400);
  }

  function save(changes) {
    const wasZnow = znowNow();
    state = { ...state, ...changes, updated: Date.now() };
    // A shopper moved out of the area (ZNow pincode -> one outside it) is
    // remembered, for the cart's "Z-Now isn't available" notice; moving back
    // in clears it. Never in the area to begin with, it stays unset.
    if (wasZnow !== znowNow()) state.leftZnow = wasZnow;
    write(state);
    setZnow(znowNow());
    announce();
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

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // NCR's pincode boundaries (assets/ncr-pincodes.json - Department of Posts
  // data, simplified): the pincode whose outline holds the point, with no
  // service in between, so it is exact where ZNow is decided and never rate
  // limited. Fetched once, on the first fix; a failure is retried next time.
  let pincodeAreas = null;
  function loadPincodeAreas() {
    if (!pincodeAreas) {
      pincodeAreas = fetchJson(config.ncrPincodesUrl).catch((error) => {
        pincodeAreas = null;
        throw error;
      });
    }
    return pincodeAreas;
  }

  async function lookupNcr(lat, lng) {
    const { features = [] } = await loadPincodeAreas();
    const match = features.find((feature) => inArea(lng, lat, { features: [feature] }));
    if (!match) return null;
    const { pincode, city, state: region } = match.properties;
    return { pincode, city, state: region };
  }

  // OpenStreetMap's free service: no key, open to browsers, ~1 request a
  // second for the whole site - which once a visit per shopper stays inside.
  async function lookupOsm(lat, lng) {
    const address =
      (
        await fetchJson(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`
        )
      ).address || {};
    const pincode = String(address.postcode || '').replace(/\s+/g, '');
    const city = address.city || address.town || address.village || address.state_district || '';
    if (address.country_code !== 'in') {
      // Outside India there is no pincode to show: the area and city instead,
      // e.g. "Deira, Dubai" (client, 29 Oct).
      const area = address.suburb || address.neighbourhood || address.quarter || address.city_district || '';
      const place = [area, city || address.state].filter(Boolean).filter((part, i, all) => all.indexOf(part) === i);
      return { pincode: '', city: place.join(', '), state: address.state || '' };
    }
    return { pincode: PINCODE.test(pincode) ? pincode : '', city, state: address.state || '' };
  }

  // The pincode and city for the saved location fix, when it has none yet -
  // from its coordinates, so the browser is never asked again. Run after each
  // fix, and on every page while one is missing: a lookup cut short (the
  // shopper moved on mid-way) or failed is finished on the next page, rather
  // than leaving the header on "Current location" (client, 29 Oct). A fix
  // replaced meanwhile drops the answer.
  // "Locating" - every pincode on the page shimmers (zinara-locating, in
  // snippets/location) - while no place is known yet but one is on its way:
  // the browser is finding the shopper (detect), or a fix's place is being
  // looked up. A lookup that came back empty ends it, so nothing loads
  // forever: the pincode fields offer themselves instead.
  let placeFailedFor = '';
  let detectingNow = false;
  const fixKey = () => `${state.lat},${state.lng}`;
  const isLocating = () =>
    !state.pincode &&
    !state.city &&
    (detectingNow || (state.source === 'gps' && typeof state.lat === 'number' && placeFailedFor !== fixKey()));
  // <html> classes for pieces picked by CSS (the ZNow showcase): has-pincode
  // - a pincode, or outside India the place found for a location fix - and
  // is-locating; then the event everything else listens to.
  const announce = () => {
    const root = document.documentElement;
    root.classList.toggle('has-pincode', Boolean(state.pincode || state.city));
    root.classList.toggle('is-locating', isLocating());
    document.dispatchEvent(new CustomEvent('zinara:location', { detail: api.get() }));
  };

  function fillPlace() {
    const { lat, lng } = state;
    if (state.source !== 'gps' || typeof lat !== 'number' || !isLocating()) return;
    const key = fixKey();
    const current = () => state.lat === lat && state.lng === lng && state.source === 'gps';
    lookupPincode(lat, lng)
      .then((place) => {
        if (!current()) return;
        // A pincode, or outside India the place's name ("Deira, Dubai").
        if (place.pincode || place.city) {
          save(place);
          return;
        }
        throw new Error('no place');
      })
      .catch(() => {
        if (!current()) return;
        placeFailedFor = key;
        announce();
      });
  }

  // NCR's own boundaries first; OpenStreetMap outside them, or if the file
  // fails to load.
  async function lookupPincode(lat, lng) {
    try {
      const place = await lookupNcr(lat, lng);
      if (place) return place;
    } catch (error) {
      /* fall through to OpenStreetMap */
    }
    return lookupOsm(lat, lng);
  }

  /* ---------------------------------------------------------- geolocation */

  const canLocate = () => Boolean(navigator.geolocation && window.isSecureContext);

  // High accuracy: network-only fixes are often a few km out, enough to be on
  // the wrong side of the area's edge.
  //
  // Some scripts on the store wrap the browser's geolocation and answer
  // "denied" first, then pass on the real position a moment later (seen
  // 29 Oct: ERR 1 then OK from one call). So an error on a site that is
  // allowed location waits a little for a real answer before it counts.
  const LATE_ANSWER_MS = 8000;
  function position() {
    return new Promise((resolve, reject) => {
      if (!canLocate()) {
        reject({ code: 2, message: 'Geolocation unavailable' });
        return;
      }
      let settled = false;
      let pending = null;
      const succeed = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(pending);
        resolve(result);
      };
      const fail = (error) => {
        if (settled || pending) return;
        permission().then((state) => {
          if (settled) return;
          const finish = () => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          if (state === 'granted') pending = setTimeout(finish, LATE_ANSWER_MS);
          else finish();
        });
      };
      navigator.geolocation.getCurrentPosition(succeed, fail, {
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
      blank); rejects with an Error whose `code` is 'denied' (this site is
      blocked), 'system' (the site is allowed but the device has location
      off), 'unavailable', 'timeout' or 'area' (the outline could not load). */
  function detect() {
    if (detecting) return detecting;
    detectingNow = true;
    if (isLocating()) announce();
    detecting = (async () => {
      let coords;
      try {
        ({ coords } = await position());
      } catch (error) {
        // GeolocationPositionError: 1 denied, 2 unavailable, 3 timeout.
        let code = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        // Denied although this site is allowed: the device itself has location
        // off (Windows / macOS / Android settings) - the site setting is fine.
        if (code === 'denied' && (await permission()) === 'granted') code = 'system';
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

      fillPlace();
      return result;
    })();
    detecting
      .finally(() => {
        detecting = null;
        detectingNow = false;
        announce();
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

  /* ------------------------------------------------------- delivery dates */

  // Days to delivery at a pincode from Shiprocket's earliest courier (the
  // zinara-edd service): { ready, made } - courier days plus the theme's
  // extra days - or null with no service, no courier, or no answer, where
  // callers keep their fixed days. One request per pincode per tab.
  const EDD_KEY = 'zinara_edd';
  const eddAnswers = new Map();
  function deliveryDays(pincode) {
    const value = cleanPincode(pincode);
    if (!config.eddUrl || !PINCODE.test(value)) return Promise.resolve(null);
    if (!eddAnswers.has(value)) {
      let saved = null;
      try {
        saved = JSON.parse(window.sessionStorage.getItem(EDD_KEY) || '{}')[value];
      } catch (error) {
        /* storage blocked - ask */
      }
      const answer =
        saved !== undefined && saved !== null
          ? Promise.resolve(saved)
          : fetchJson(`${config.eddUrl}${config.eddUrl.includes('?') ? '&' : '?'}pincode=${value}`).then((body) => {
              const days = body.serviceable && body.days > 0 ? Number(body.days) : 0;
              try {
                const all = JSON.parse(window.sessionStorage.getItem(EDD_KEY) || '{}');
                all[value] = days;
                window.sessionStorage.setItem(EDD_KEY, JSON.stringify(all));
              } catch (error) {
                /* storage blocked - asked again next page */
              }
              return days;
            });
      // A failed request is forgotten, so the next caller asks again.
      eddAnswers.set(value, answer.catch(() => (eddAnswers.delete(value), 0)));
    }
    return eddAnswers.get(value).then((days) =>
      days > 0 ? { ready: days + Number(config.eddReadyExtra ?? 1), made: days + Number(config.eddMadeExtra ?? 21) } : null
    );
  }

  /* ------------------------------------------------------------------ api */

  const cleanPincode = (value) => String(value || '').replace(/\s+/g, '');

  const api = {
    get() {
      const { pincode = '', city = '', state: region = '', source = '', status = '', updated = 0 } = state;
      const znow = znowNow();
      return {
        pincode,
        city,
        state: region,
        source,
        status,
        updated,
        znow,
        leftZnow: !znow && Boolean(state.leftZnow),
        locating: isLocating(),
      };
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
    deliveryDays,
  };
  window.zinaraLocation = api;
  document.documentElement.classList.toggle('is-znow', znowNow());

  /* ---------------------------------------------------------------- start */

  const track = (status) => window.zinaraTrack?.('location_permission', { status, page_type: config.pageType });

  async function start() {
    // Switched off in theme settings, in the theme editor, or for automated
    // browsers (Lighthouse, bots): the API still works, nothing runs by itself.
    if (config.enabled === false || window.Shopify?.designMode || navigator.webdriver) {
      // Nothing will finish a place lookup here: drop the first paint's
      // shimmer (snippets/location, delivery-location) rather than leave it.
      if (isLocating()) {
        placeFailedFor = fixKey();
        announce();
      }
      return;
    }

    fillPlace();
    const firstPageOfVisit = !sessionStarted();
    const browser = await permission();

    // Access granted mid-visit - from the address bar's location icon or site
    // settings rather than our prompt - is picked up at once, not next visit.
    // (Our own prompt's answer lands here too; detect() runs only once.)
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        status.addEventListener('change', () => {
          if (status.state === 'granted' && (!state.source || state.source === 'gps')) detect().catch(() => {});
        });
      })
      .catch(() => {});

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

    // Phones: a prompt that went unanswered - dismissed, or hidden as Chrome's
    // quiet address-bar chip - leaves the browser on 'prompt', so it is raised
    // again on the first page of each later visit until the shopper answers.
    // Never once blocked ('denied'), and not over a pincode they typed.
    if (
      firstPageOfVisit &&
      browser === 'prompt' &&
      !state.source &&
      window.matchMedia('(max-width: 749px)').matches
    ) {
      detect()
        .then((result) => track(result.znow ? 'success_znow' : 'success'))
        .catch((error) => track(error.code));
      return;
    }

    // A pincode the shopper typed (e.g. on a product page) is kept - it may
    // be where they want delivery, not where they are. Refreshed on the first
    // page of a visit, and on any page while the fix still has no place (its
    // lookup failed or never ran) - the same place is not tested again, only
    // looked up.
    if (
      browser === 'granted' &&
      (!state.source || state.source === 'gps') &&
      (firstPageOfVisit || (!state.pincode && !state.city))
    ) {
      detect().catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
