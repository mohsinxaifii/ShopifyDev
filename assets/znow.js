/**
 * ZNow entry flow (snippets/znow-flow). Every link marked `data-znow-link`
 * (Shop by category's ZNow tile, the announcement bar's ZNow message) opens
 * through here:
 *
 * - in the same-day area already (zinaraLocation.get().znow): the loader
 *   plays once, start to finish, then the link opens - the page is
 *   prefetched meanwhile so it follows straight on;
 * - located outside the area: the dialog opens on "not available";
 * - anything else (location blocked, never asked, typed pincode outside):
 *   the dialog asks for a pincode or "Use my location".
 *
 * The "Deliver to" control on collection pages (snippets/delivery-location)
 * opens the same dialog to change the pincode: no link to follow, so a
 * served pincode just closes it, and the label updates from the
 * 'zinara:location' event.
 *
 * A pincode is checked against snippets/znow-pincodes (zinaraLocation.isZnow)
 * and saved as the shopper's pincode either way; a location fix is checked
 * against the area outline by assets/location.js.
 */
(() => {
  const dialog = document.querySelector('[data-znow-dialog]');
  const loader = document.querySelector('[data-znow-loader]');
  if (!dialog || !loader) return;

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const track = (event, params) => window.zinaraTrack?.(event, params);

  // The shortest the "checking" state shows, so it reads as a step and not a flicker.
  const CHECKING_MS = 700;

  /* -------------------------------------------------------------- dialog */

  const $ = (selector) => dialog.querySelector(selector);
  const form = $('[data-znow-form]');
  const input = $('[data-znow-input]');
  const status = $('[data-znow-status]');
  const title = $('[data-znow-title]');
  const subtitle = $('[data-znow-subtitle]');
  const locate = $('[data-znow-locate]');
  const pendingPincode = $('[data-znow-pending-pincode]');
  const pendingArea = $('[data-znow-pending-area]');
  const defaults = { title: title.textContent, subtitle: subtitle.textContent.trim() };

  let target = null; // the link's URL, opened once the shopper is in the area; null when changing the pincode
  let busy = false;

  function say(text, isError = false) {
    status.textContent = text || '';
    status.classList.toggle('is-error', isError);
  }

  function view(name, options = {}) {
    dialog.dataset.view = name;
    locate.disabled = name === 'checking';
    if (name === 'unavailable') {
      const where = options.pincode ? `at ${options.pincode}` : 'in your area';
      title.textContent = `Same-day isn’t available ${where} yet`;
      subtitle.textContent = `Standard delivery: ${standardDate()}`;
      say('');
    } else {
      title.textContent = target ? defaults.title : 'Change delivery pincode';
      subtitle.textContent = defaults.subtitle;
    }
    if (name === 'checking') {
      pendingPincode.textContent = options.pincode || '';
      pendingArea.textContent = options.area ? `| ${options.area}` : '';
    }
  }

  function standardDate() {
    const date = new Date();
    date.setDate(date.getDate() + (Number(dialog.dataset.standardDays) || 3));
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function openDialog(state) {
    busy = false;
    input.value = state.pincode || '';
    say('');
    // Following a ZNow link from outside the area: say so straight away.
    if (target && state.source === 'gps' && state.status === 'granted' && !state.znow) {
      view('unavailable', { pincode: state.pincode });
    } else {
      view('ask');
    }
    if (!dialog.open) {
      dialog.classList.remove('is-closing');
      dialog.showModal();
    }
    if (dialog.dataset.view === 'ask' && window.matchMedia('(min-width: 750px)').matches) input.focus();
    track('znow_dialog_open', { reason: dialog.dataset.view, page_type: window.zinaraLocationConfig?.pageType });
  }

  function closeDialog() {
    if (!dialog.open || dialog.classList.contains('is-closing')) return Promise.resolve();
    busy = false;
    dialog.classList.add('is-closing');
    return sleep(reducedMotion() ? 0 : 250).then(() => {
      dialog.classList.remove('is-closing');
      dialog.close();
    });
  }

  async function proceed() {
    await closeDialog();
    if (target) play(target);
  }

  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^0-9]/g, '').slice(0, 6);
    if (status.classList.contains('is-error')) say('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const pincode = input.value.trim();
    if (!window.zinaraLocation?.isValid(pincode)) {
      say('Enter a valid 6-digit pincode', true);
      input.focus();
      return;
    }

    busy = true;
    view('checking', { pincode });
    say(`Checking delivery to ${pincode}…`);
    await sleep(CHECKING_MS);
    if (!busy) return; // closed or changed meanwhile

    window.zinaraLocation.set(pincode, { source: 'manual' });
    const served = window.zinaraLocation.isZnow(pincode);
    track('pincode_check', { pincode, serviceable: served, page_type: 'znow' });
    busy = false;
    if (served) proceed();
    else view('unavailable', { pincode });
  });

  locate.addEventListener('click', async () => {
    if (busy || !window.zinaraLocation) return;
    busy = true;
    locate.disabled = true;
    say('Finding your location…');
    try {
      const result = await window.zinaraLocation.detect();
      if (!busy) return;
      busy = false;
      if (result.znow) proceed();
      else view('unavailable', { pincode: result.pincode });
    } catch (error) {
      if (!busy) return;
      busy = false;
      view('ask');
      say(
        error.code === 'denied'
          ? 'Location is blocked in your browser. Enter your pincode instead.'
          : "We couldn't find your location. Enter your pincode instead.",
        true
      );
      input.focus();
    }
  });

  // Change / Try another pincode: back to the field, ready to type.
  const retry = () => {
    busy = false;
    view('ask');
    say('');
    input.focus();
    input.select();
  };
  $('[data-znow-change]').addEventListener('click', retry);
  $('[data-znow-retry]').addEventListener('click', () => {
    input.value = '';
    retry();
  });

  dialog.querySelectorAll('[data-znow-close]').forEach((button) => button.addEventListener('click', closeDialog));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  // A click on the backdrop (the dialog element itself, outside the panel) closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  /* -------------------------------------------------------------- loader */

  const ground = loader.querySelector('[data-znow-loader-ground]');
  const icon = loader.querySelector('[data-znow-loader-icon]');
  const message = loader.querySelector('[data-znow-loader-message]');
  const drop = loader.querySelector('.znow-loader_icon_drop');
  const line = loader.querySelector('.znow-loader_icon_line');
  const head = loader.querySelector('.znow-loader_icon_head');
  let running = [];

  const animate = (element, keyframes, options) => {
    const animation = element.animate(keyframes, { fill: 'forwards', ...options });
    running.push(animation);
    return animation.finished.catch(() => {});
  };

  function resetLoader() {
    running.forEach((animation) => animation.cancel());
    running = [];
    loader.hidden = true;
    message.textContent = '';
    [icon, message, drop, head, line, ground].forEach((element) => element.removeAttribute('style'));
    document.documentElement.classList.remove('is-scroll-locked');
  }

  // One full pass of the route: drop, line, arrow head, hold, then wipe away.
  async function drawRoute() {
    animate(drop, [
      { transform: 'scale(0)', opacity: 1 },
      { transform: 'scale(1.25)', opacity: 1, offset: 0.6 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 150, easing: 'ease-out' });
    await sleep(150);
    animate(line, [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 900, easing: 'ease-in-out' });
    await sleep(900);
    animate(head, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], {
      duration: 200,
      easing: 'ease-out',
    });
    await sleep(600);
    animate(line, [{ strokeDashoffset: 0 }, { strokeDashoffset: -100 }], { duration: 600, easing: 'ease-in-out' });
    animate(drop, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 });
    animate(head, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, delay: 350 });
    await sleep(750);
  }

  function writeMessage() {
    const state = window.zinaraLocation?.get() || {};
    const place = state.city || state.pincode || 'you';
    message.textContent = '';
    `Yay, Z-Now delivers to ${place}!`.split(' ').forEach((word, index) => {
      if (index) message.append(' ');
      const span = document.createElement('span');
      span.textContent = word;
      message.append(span);
    });
  }

  async function play(url) {
    resetLoader();
    prefetch(url);
    writeMessage();
    loader.hidden = false;
    document.documentElement.classList.add('is-scroll-locked');
    track('znow_loader_view', { destination_url: url });

    const words = Array.from(message.querySelectorAll('span'));
    if (reducedMotion()) {
      animate(ground, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      ground.style.setProperty('--znow-reveal', '145%');
      icon.style.opacity = 1;
      [drop, head].forEach((part) => (part.style.opacity = 1));
      line.style.strokeDashoffset = 0;
      words.forEach((word) => animate(word, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }));
      await sleep(1400);
    } else {
      animate(ground, [{ '--znow-reveal': '0%' }, { '--znow-reveal': '145%' }], { duration: 600, easing: 'ease-out' });
      setTimeout(() => {
        words.forEach((word, index) =>
          animate(word, [
            { opacity: 0, transform: 'translateY(14px) scale(.94)' },
            { opacity: 1, transform: 'translateY(-3px) scale(1.02)', offset: 0.6 },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ], { duration: 560, delay: index * 70, easing: 'cubic-bezier(.34,1.56,.64,1)' })
        );
      }, 900);
      await sleep(600);
      icon.style.opacity = 1;
      await drawRoute();
      await Promise.all([
        animate(icon, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
        animate(message, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
      ]);
    }
    window.location.assign(url);
  }

  function prefetch(url) {
    try {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url;
      document.head.append(link);
    } catch (error) {
      /* the page simply loads after the loader */
    }
  }

  // Back from the collection (page restored from the back/forward cache): no loader left over.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) resetLoader();
  });

  /* --------------------------------------------------------------- links */

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-znow-link]');
    if (!link || event.defaultPrevented) return;
    // New tab / window: let the browser have it.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.Shopify?.designMode) return;
    event.preventDefault();

    target = link.href;
    const state = window.zinaraLocation?.get() || {};
    if (state.znow) play(target);
    else openDialog(state);
  });

  /* ---------------------------------------------------- deliver to (PLP) */

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-delivery-location]')) return;
    target = null;
    openDialog(window.zinaraLocation?.get() || {});
  });

  document.addEventListener('zinara:location', (event) => {
    const { city, pincode } = event.detail;
    const text = [city, pincode].filter(Boolean).join(' ');
    if (!text) return;
    document.querySelectorAll('[data-delivery-location-place]').forEach((place) => (place.textContent = text));
  });

  window.zinaraZnow = { open: (url) => ((target = url), openDialog(window.zinaraLocation?.get() || {})), play };
})();
