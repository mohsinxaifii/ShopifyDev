/**
 * Shopper location: the delivery pincode every ZNow / delivery feature reads.
 *
 * - The prompt (snippets/location-prompt) is shown once per browser, on the
 *   first page of the first visit, and never again whatever the answer - allow,
 *   block, "Not now", closing it, or leaving the page with it open.
 * - On the first page of every later visit the pincode is refreshed silently,
 *   but only when the browser already reports the permission as granted, so
 *   no browser ever re-asks (Safari would, if asked without that check).
 * - Coordinates become a pincode through a reverse-geocoding service, tried in
 *   order with a timeout each; any failure leaves the last pincode in place
 *   and the shopper can still type one.
 *
 * Other scripts read it through window.zinaraLocation:
 *   get()                 -> { pincode, city, state, source, status, updated } (a copy)
 *   set(pincode, extra)   -> saves a pincode the shopper typed (source 'manual' by default)
 *   detect()              -> asks the browser now (call only from a click)
 *   open()                -> shows the prompt again, e.g. from a "Change pincode" link
 *   and listen for the 'zinara:location' event on document (detail = get()).
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
    document.dispatchEvent(new CustomEvent('zinara:location', { detail: api.get() }));
    return api.get();
  }

  /* ------------------------------------------------------------ geocoding */

  function withTimeout(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
  }

  async function fetchJson(url) {
    const timeout = withTimeout(6000);
    try {
      const response = await fetch(url, { signal: timeout.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      timeout.done();
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

  function position() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation || !window.isSecureContext) {
        reject(Object.assign(new Error('Geolocation unavailable'), { code: 'unavailable' }));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 10 * 60 * 1000,
      });
    });
  }

  // 'granted' | 'denied' | 'prompt' | 'unknown' - never asks the shopper.
  async function permission() {
    if (!navigator.geolocation || !window.isSecureContext) return 'denied';
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
    detecting.finally(() => {
      detecting = null;
    }).catch(() => {});
    return detecting;
  }

  /* ------------------------------------------------------------------ api */

  const api = {
    get() {
      const { pincode = '', city = '', state: region = '', source = '', status = '', updated = 0 } = state;
      return { pincode, city, state: region, source, status, updated };
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
    open: () => prompt?.open(true),
  };
  window.zinaraLocation = api;

  /* --------------------------------------------------------------- prompt */

  const track = (action, extra) =>
    window.zinaraTrack?.('location_prompt', { action, page_type: config.pageType, ...extra });

  let prompt = null;

  function buildPrompt(root) {
    const views = root.querySelectorAll('[data-location-view]');
    const message = root.querySelector('[data-location-message]');
    const allow = root.querySelector('[data-location-allow]');
    const form = root.querySelector('[data-location-form]');
    const input = root.querySelector('[data-location-input]');
    const done = root.querySelector('[data-location-done]');
    let closeTimer;

    const view = (name) => views.forEach((node) => (node.hidden = node.dataset.locationView !== name));
    const say = (text, invalid = false) => {
      message.textContent = text || '';
      message.hidden = !text;
      message.classList.toggle('is-invalid', invalid);
    };

    function close(action) {
      clearTimeout(closeTimer);
      root.classList.remove('is-open');
      // Hidden once the slide-out ends; straight away with reduced motion.
      setTimeout(() => (root.hidden = true), 250);
      if (action) track(action);
    }

    function finish(result) {
      const where = [result.city, result.pincode].filter(Boolean).join(' - ');
      done.textContent = `${config.doneText || 'Delivering to'} ${where}`;
      view('done');
      closeTimer = setTimeout(() => close(), 2500);
    }

    function open(byShopper) {
      clearTimeout(closeTimer);
      say('');
      input.value = state.pincode || '';
      const canAsk = Boolean(navigator.geolocation && window.isSecureContext);
      allow.hidden = !canAsk;
      view('ask');
      root.hidden = false;
      requestAnimationFrame(() => root.classList.add('is-open'));
      if (byShopper) (canAsk ? allow : input).focus({ preventScroll: true });
      track('view', { trigger: byShopper ? 'shopper' : 'auto' });
    }

    allow.addEventListener('click', async () => {
      view('busy');
      try {
        const result = await detect();
        track('allow', { status: 'success' });
        finish(result);
      } catch (error) {
        view('ask');
        allow.hidden = error.code === 'denied' || error.code === 'unavailable';
        const text = {
          denied: config.deniedText || 'Location is blocked. Enter your pincode instead.',
          outside: config.outsideText || 'We deliver within India only. Enter an Indian pincode.',
        }[error.code];
        say(text || config.failedText || "We couldn't find your pincode. Please enter it.", true);
        track('allow', { status: error.code });
        input.focus({ preventScroll: true });
      }
    });

    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^0-9]/g, '').slice(0, 6);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = api.set(input.value, { status: state.status || 'manual' });
      if (!result) {
        say(config.invalidText || 'Please enter a valid 6-digit pincode.', true);
        return;
      }
      track('manual');
      finish(result);
    });

    root.querySelectorAll('[data-location-dismiss]').forEach((button) =>
      button.addEventListener('click', () => {
        if (!state.status) save({ status: 'dismissed' });
        close('dismiss');
      })
    );
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') root.querySelector('[data-location-dismiss]').click();
    });

    return { open, close };
  }

  /* ---------------------------------------------------------------- start */

  async function start() {
    const root = document.querySelector('[data-location-prompt]');
    if (root) prompt = buildPrompt(root);

    // Never in the theme editor, nor for automated browsers (Lighthouse, bots).
    if (window.Shopify?.designMode || navigator.webdriver) return;

    const firstPageOfVisit = !sessionStarted();
    const browser = await permission();

    if (!state.asked) {
      // First visit ever. Already granted (e.g. a returning shopper who cleared
      // storage): fetch quietly. Otherwise offer the prompt - the one time.
      if (browser === 'granted') {
        save({ asked: Date.now() });
        detect().catch(() => {});
        return;
      }
      if (!prompt || config.enabled === false) return;
      save({ asked: Date.now(), status: browser === 'denied' ? 'denied' : state.status || '' });
      setTimeout(() => prompt.open(false), Number(config.delay) || 1500);
      return;
    }

    if (firstPageOfVisit && browser === 'granted' && state.source !== 'manual') {
      detect().catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
