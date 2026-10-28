/**
 * ZNow entry flow (snippets/znow-flow). Every link marked `data-znow-link`
 * (Shop by category's ZNow tile, the announcement bar's ZNow message) opens
 * through here:
 *
 * - in the same-day area already (zinaraLocation.get().znow): the link
 *   opens straight away - the ZNow collection plays the loader itself on
 *   arrival (intro, below), however the shopper got there;
 * - located outside the area: the dialog opens on "not available";
 * - anything else (location blocked, never asked, typed pincode outside):
 *   the dialog asks for a pincode or "Use my location".
 *
 * The "Deliver to" control in the header (snippets/delivery-location)
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
  if (!dialog) return;

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Re-fades text rewritten in place, so a change reads as one rather than a
     snap (.is-refreshed in znow.css / header.css). */
  const replay = (element) => {
    if (!element) return;
    element.classList.remove('is-refreshed');
    void element.offsetWidth;
    element.classList.add('is-refreshed');
  };
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
  let checking = false; // "Check availability": asks like a link, but only saves the pincode
  let busy = false;

  function say(text, isError = false) {
    const changed = status.textContent !== (text || '');
    status.textContent = text || '';
    status.classList.toggle('is-error', isError);
    if (changed && text) replay(status);
  }

  function view(name, options = {}) {
    const before = [title.textContent, subtitle.textContent];
    dialog.dataset.view = name;
    locate.disabled = name === 'checking';
    if (name === 'unavailable') {
      if (options.served === false) {
        // Not on the delivery list at all: no standard date to promise.
        title.textContent = `We don’t deliver to ${options.pincode} yet`;
        subtitle.textContent = 'Please try another pincode.';
      } else {
        title.textContent = 'Z-Now coming soon!';
        subtitle.textContent = `Get your favourite products by ${standardDate()}`;
      }
      say('');
    } else {
      title.textContent = target || checking ? defaults.title : 'Change delivery pincode';
      subtitle.textContent = defaults.subtitle;
    }
    if (name === 'checking') {
      pendingPincode.textContent = options.pincode || '';
      pendingArea.textContent = options.area ? `| ${options.area}` : '';
    }
    if (dialog.open) {
      if (title.textContent !== before[0]) replay(title);
      if (subtitle.textContent !== before[1]) replay(subtitle);
    }
  }

  function standardDate() {
    const date = new Date();
    date.setDate(date.getDate() + (Number(dialog.dataset.standardDays) || 3));
    return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function openDialog(state, options = {}) {
    busy = false;
    checking = Boolean(options.check);
    input.value = state.pincode || '';
    say('');
    // Following a ZNow link from outside the area: say so straight away
    // (not when the shopper asked to check - they get the question).
    if (!options.ask && target && state.source === 'gps' && state.status === 'granted' && !state.znow) {
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
    if (target) window.location.assign(target);
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
    const sameDay = window.zinaraLocation.isZnow(pincode);
    let delivered = true;
    if (!sameDay) {
      try {
        delivered = await window.zinaraLocation.serves(pincode);
      } catch (error) {
        delivered = true; // list unreachable: don't claim we never deliver there
      }
      if (!busy) return;
    }
    track('pincode_check', { pincode, serviceable: delivered, page_type: 'znow' });
    busy = false;
    if (sameDay) proceed();
    else view('unavailable', { pincode, served: delivered });
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
      const messages = {
        denied: 'Location is blocked for this site in your browser. Enter your pincode instead.',
        system: 'Location is turned off on this device. Turn it on in your device settings, or enter your pincode.',
        timeout: "Finding your location took too long. Try again, or enter your pincode.",
      };
      say(messages[error.code] || "We couldn't find your location. Enter your pincode instead.", true);
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

  /* On the ZNow collection only (snippets/znow-loader, first in the body so
     it already covers the page): one full pass, then it lifts off the
     collection. Whichever way the shopper arrived - a ZNow link, any other
     link, the address typed in. */
  async function intro() {
    const loader = document.querySelector('[data-znow-loader]');
    if (!loader) return;

    const ground = loader.querySelector('[data-znow-loader-ground]');
    const icon = loader.querySelector('[data-znow-loader-icon]');
    const message = loader.querySelector('[data-znow-loader-message]');
    const drop = loader.querySelector('.znow-loader_icon_drop');
    const line = loader.querySelector('.znow-loader_icon_line');
    const head = loader.querySelector('.znow-loader_icon_head');
    const animate = (element, keyframes, options) =>
      element.animate(keyframes, { fill: 'forwards', ...options }).finished.catch(() => {});

    // In the area: "Yay, Z-Now delivers to Saket!"; elsewhere it still plays,
    // without promising delivery to where the shopper is.
    const state = window.zinaraLocation?.get() || {};
    const text = state.znow
      ? `Yay, Z-Now delivers to ${state.city || state.pincode || 'you'}!`
      : 'Same-day delivery with Z-Now';
    text.split(' ').forEach((word, index) => {
      if (index) message.append(' ');
      const span = document.createElement('span');
      span.textContent = word;
      message.append(span);
    });
    const words = Array.from(message.querySelectorAll('span'));

    loader.classList.add('is-playing');
    track('znow_loader_view', { destination_url: window.location.pathname });

    if (reducedMotion()) {
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

      // One full pass of the route: drop, line, arrow head, hold, then wipe away.
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
      await Promise.all([
        animate(icon, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
        animate(message, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }),
      ]);
    }

    // Lift it off the collection.
    await animate(loader, [{ opacity: 1 }, { opacity: 0 }], { duration: reducedMotion() ? 150 : 350, easing: 'ease-out' });
    loader.remove();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', intro);
  else intro();

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
    if (state.znow) window.location.assign(target);
    else openDialog(state);
  });

  /* "Check availability" (data-znow-check, the ZNow showcase): the dialog
     every time, even for a shopper already known to be in the area - it asks
     rather than assumes. The page stays put (client, 26 Oct): a same-day
     answer just closes it, and the saved pincode updates the header's
     "Deliver to" and the showcase itself through 'zinara:location'. */
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-znow-check]');
    if (!link || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.Shopify?.designMode) return;
    event.preventDefault();
    target = null;
    openDialog(window.zinaraLocation?.get() || {}, { ask: true, check: true });
  });

  /* ---------------------------------------------------- deliver to (PLP) */

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-delivery-location]')) return;
    target = null;
    openDialog(window.zinaraLocation?.get() || {});
  });

  document.addEventListener('zinara:location', (event) => {
    const { city, pincode, source } = event.detail;
    // A location fix whose place isn't known yet still reads as located.
    const text = [city, pincode].filter(Boolean).join(' ') || (source === 'gps' ? 'Current location' : '');
    if (!text) return;
    document.querySelectorAll('[data-delivery-location-place]').forEach((place) => {
      if (place.textContent === text) return;
      place.textContent = text;
      replay(place);
    });
  });

  /* The ZNow showcase's in-area state (sections/znow-showcase): the pincode
     on its button, and "… at 110017." - the city, or "you", for a location
     fix whose pincode isn't known. */
  const fillPincode = () => {
    const { pincode, city } = window.zinaraLocation?.get() || {};
    document.querySelectorAll('[data-znow-pincode]').forEach((node) => {
      node.textContent = pincode || city || 'Your location';
    });
    document.querySelectorAll('[data-znow-place]').forEach((node) => {
      node.textContent = pincode || city || 'you';
    });
  };
  fillPincode();
  document.addEventListener('zinara:location', fillPincode);

  window.zinaraZnow = {
    open: (url) => ((target = url), openDialog(window.zinaraLocation?.get() || {})),
    // "Change delivery pincode" - no link to follow (the PDP's Change, the header's Deliver to).
    change: () => ((target = null), openDialog(window.zinaraLocation?.get() || {})),
  };
})();
