/**
 * Shopper location: the delivery pincode every ZNow / delivery feature reads.
 *
 * - The browser's own location prompt is raised once per browser, on the first
 *   page of the first visit, and never again whatever the answer - allow,
 *   block, closing it, or leaving the page before answering.
 * - On the first page of every later visit the pincode is refreshed silently,
 *   but only when the browser already reports the permission as granted, so
 *   no browser ever re-asks (Safari would, if asked without that check).
 * - Coordinates become a pincode through a reverse-geocoding service, tried in
 *   order with a timeout each; any failure leaves the last pincode in place.
 *   A shopper who blocks location can still type a pincode where one is asked
 *   for (the product page's delivery check), which is saved here too.
 *
 * Other scripts read it through window.zinaraLocation:
 *   get()                 -> { pincode, city, state, source, status, updated, znow } (a copy)
 *   set(pincode, extra)   -> saves a pincode the shopper typed (source 'manual' by default)
 *   detect()              -> asks the browser now (from a click, e.g. "Use my location")
 *   permission()          -> 'granted' | 'denied' | 'prompt' | 'unknown', never asks
 *   isZnow(pincode)       -> whether a pincode gets same-day ZNow delivery
 *   and listen for the 'zinara:location' event on document (detail = get()).
 *
 * ZNow: snippets/znow-pincodes lists the same-day pincodes; <html> carries
 * "is-znow" while the shopper's pincode is one of them (set early by
 * snippets/location, kept in step here).
 */
(() => {
  if (window.zinaraLocation) return;

  const KEY = 'zinara_location';
  const SESSION_KEY = 'zinara_location_session';
  const PINCODE = /^[1-9][0-9]{5}$/;
  // A visit whose session flag cannot be kept still refreshes at most this often.
  const REFRESH_AFTER = 30 * 60 * 1000;
  // Within ~100m of the last fix the pincode is reused without a lookup.
  const SAME_PLACE = 0.001;

  const config = window.zinaraLocationConfig || {};
  const znowPincodes = new Set(config.znowPincodes || []);
  const isZnow = (pincode) => znowPincodes.has(String(pincode || ''));

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

  function save(changes) {
    state = { ...state, ...changes, updated: Date.now() };
    write(state);
    markZnow();
    document.dispatchEvent(new CustomEvent('zinara:location', { detail: api.get() }));
    return api.get();
  }

  /* ------------------------------------------------------------ geocoding */

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

  const cleanPincode = (value) => String(value || '').replace(/\s+/g, '');

  // Each returns { pincode, city, state, country } or throws.
  const PROVIDERS = [
    async (lat, lng) => {
      const data = await fetchJson(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
      );
      return {
        pincode: cleanPincode(data.postcode),
        city: data.city || data.locality || '',
        state: data.principalSubdivision || '',
        country: (data.countryCode || '').toUpperCase(),
      };
    },
    async (lat, lng) => {
      const data = await fetchJson(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`
      );
      const address = data.address || {};
      return {
        pincode: cleanPincode(address.postcode),
        city: address.city || address.town || address.village || address.state_district || '',
        state: address.state || '',
        country: (address.country_code || '').toUpperCase(),
      };
    },
  ];

  async function reverseGeocode(lat, lng) {
    let outside = null;
    for (const provider of PROVIDERS) {
      try {
        const place = await provider(lat, lng);
        if (place.country && place.country !== 'IN') {
          outside = place;
          continue;
        }
        if (PINCODE.test(place.pincode)) return place;
      } catch (error) {
        /* this service failed - try the next */
      }
    }
    if (outside) return { ...outside, pincode: '' };
    throw new Error('No pincode for this location');
  }

  /* ---------------------------------------------------------- geolocation */

  const canLocate = () => Boolean(navigator.geolocation && window.isSecureContext);

  // High accuracy: network-only fixes in Indian cities are often a few km
  // out, enough to land in the neighbouring pincode.
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

  /** Resolves with get(); rejects with an Error whose `code` is 'denied',
      'unavailable', 'timeout', 'outside' or 'lookup'. */
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

      const lat = Number(coords.latitude.toFixed(3));
      const lng = Number(coords.longitude.toFixed(3));
      if (
        state.source === 'gps' &&
        PINCODE.test(state.pincode || '') &&
        Math.abs(state.lat - lat) < SAME_PLACE &&
        Math.abs(state.lng - lng) < SAME_PLACE
      ) {
        return save({ status: 'granted' });
      }

      let place;
      try {
        place = await reverseGeocode(lat, lng);
      } catch (error) {
        save({ status: 'granted' });
        throw Object.assign(error, { code: 'lookup' });
      }
      if (!place.pincode) {
        save({ status: 'granted', country: place.country });
        throw Object.assign(new Error('Outside India'), { code: 'outside' });
      }
      return save({
        status: 'granted',
        source: 'gps',
        pincode: place.pincode,
        city: place.city,
        state: place.state,
        country: 'IN',
        lat,
        lng,
      });
    })();
    detecting
      .finally(() => {
        detecting = null;
      })
      .catch(() => {});
    return detecting;
  }

  /* ------------------------------------------------------------------ api */

  const api = {
    get() {
      const { pincode = '', city = '', state: region = '', source = '', status = '', updated = 0 } = state;
      return { pincode, city, state: region, source, status, updated, znow: isZnow(pincode) };
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
    isZnow: (pincode) => isZnow(cleanPincode(pincode)),
  };
  window.zinaraLocation = api;

  function markZnow() {
    document.documentElement.classList.toggle('is-znow', Boolean(config.znowPreview) || isZnow(state.pincode));
  }
  markZnow();

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
        .then(() => track('success'))
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
