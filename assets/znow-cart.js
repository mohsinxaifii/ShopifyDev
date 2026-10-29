/**
 * ZNow in KwikCart (Figma 8470:85436 / 86144 / 86857).
 *
 * KwikCart is GoKwik's Svelte app inside an open shadow root
 * (<shadow-dom-container>). Its tiles belong to Svelte, so nothing of
 * GoKwik's is moved or rewritten: the list becomes a flex column and each
 * tile gets an `order`, and ZNow's own pieces (.zk-*, data-zk) sit beside
 * them -
 *   - "Delivering to 110017, Saket · Change" under the title;
 *   - for a shopper in the ZNow area: "Delivery 1 of 2 · Now · Today by
 *     9 PM" over the lines with stock (free gifts ride along), "Delivery 2 of
 *     2 · Made to order · By 12 Nov" over the rest, the cut-off notice past
 *     2 PM, and "Z-Now · Free" in place of "FREE shipping included";
 *   - anywhere else, or with no pincode: "Ready to ship · By 1 Nov" and
 *     "Made to order · By 12 Nov" bands the same way, by each line's stock
 *     (a cart of one kind gets "Delivery 1 of 1");
 *   - outside it, with a pincode known and stock in the cart: "Z-Now isn't
 *     available at 122018 yet".
 * Re-applied whenever KwikCart redraws, the cart changes, the pincode
 * changes or the cut-off passes. If GoKwik's markup changes so the hooks
 * aren't found, nothing is added and the cart works as GoKwik built it.
 *
 * Styles: snippets/znow-cart-css, injected as a <style>.
 * Which lines have stock comes from sections/znow-cart-data (inventory is
 * not in /cart.js); tiles are matched to lines by title and options.
 */
(() => {
  const config = window.zinaraKwikCart;
  if (!config) return;

  const html = document.documentElement;
  let root = null;
  let lines = null; // [{ title, options, free, inStock, quantity }]
  let loading = null;
  let tileSignature = '';
  let scheduled = false;

  /* ---------------------------------------------------------------- data */

  function loadLines() {
    if (loading) return loading;
    loading = fetch(`${config.root}?sections=znow-cart-data`, { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((sections) => {
        const markup = sections['znow-cart-data'] || '';
        const match = markup.match(/<script[^>]*data-znow-cart-data[^>]*>([\s\S]*?)<\/script>/);
        lines = match ? JSON.parse(match[1]) : [];
      })
      .catch(() => {
        lines = null;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  /* --------------------------------------------------------------- dates */

  const IST = { timeZone: 'Asia/Kolkata' };
  const inDays = (days) => new Date(Date.now() + days * 86400000);
  const dayMonth = (days) => {
    const date = inDays(days);
    return `${date.toLocaleDateString('en-GB', { ...IST, day: 'numeric' })} ${date.toLocaleDateString('en-GB', { ...IST, month: 'short' })}`;
  };
  const weekdayDate = (days) => {
    const date = inDays(days);
    const part = (options) => date.toLocaleDateString('en-GB', { ...IST, ...options });
    return `${part({ weekday: 'short' })}, ${part({ day: 'numeric' })} ${part({ month: 'short' })}`;
  };

  /* ------------------------------------------------------------- helpers */

  function make(tag, className, html_) {
    const node = document.createElement(tag);
    node.className = className;
    node.dataset.zk = '';
    if (html_ != null) node.innerHTML = html_;
    return node;
  }

  const setHTML = (node, value) => {
    if (node.innerHTML !== value) node.innerHTML = value;
  };

  const escape = (text) =>
    String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const normalise = (text) =>
    String(text || '')
      .replace(/^[^\p{L}\p{N}]+/u, '') // a leading 🎁
      .toLowerCase()
      .trim();

  /* GoKwik's tiles, each matched to its cart line: same free/paid kind,
     title, and the options its selects show. */
  function readTiles(list) {
    const tiles = Array.from(list.querySelectorAll(':scope > .product-tile-wrapper'));
    const used = new Set();
    return tiles.map((tile) => {
      const title = normalise(tile.querySelector('.sidecart-product-title')?.textContent);
      const options = Array.from(tile.querySelectorAll('.variant-selector select')).map((select) => select.value);
      const free = Boolean(tile.querySelector('.free-product'));
      const candidates = (lines || [])
        .map((line, index) => ({ line, index }))
        .filter(({ line, index }) => !used.has(index) && line.free === free);
      const byTitle = candidates.filter(({ line }) => {
        const name = normalise(line.title);
        return title === name || title.startsWith(name) || name.startsWith(title);
      });
      const exact = byTitle.find(({ line }) => options.length && options.every((value, i) => line.options[i] === value));
      const pick = exact || byTitle[0] || null;
      if (pick) used.add(pick.index);
      return { tile, line: pick?.line || null, free };
    });
  }

  /* ----------------------------------------------------------- the parts */

  // A full row of its own across the header, after the title and the ✕.
  function deliverLine(sr, state) {
    const sub = sr.querySelector('.side-cart-header');
    if (!sub) return;
    let line = sub.querySelector(':scope > .zk-deliver');
    if (!line) {
      line = make(
        'div',
        'zk-deliver',
        `<span class="zk-deliver_icon" aria-hidden="true">${config.icons.pin}</span>
         <span class="zk-deliver_label"></span>
         <span class="zk-deliver_place"></span>
         <button type="button" class="zk-deliver_change">Change</button>`,
      );
      line.querySelector('.zk-deliver_change').addEventListener('click', (event) => {
        event.stopPropagation();
        window.zinaraZnow?.change();
      });
      sub.append(line);
    }
    // Being located: the place shimmers (zinara-locating, snippets/znow-cart-css).
    const locating = !state.pincode && Boolean(state.locating);
    const place = locating ? 'Locating…' : [state.pincode, state.city].filter(Boolean).join(', ');
    const label = line.querySelector('.zk-deliver_label');
    const value = line.querySelector('.zk-deliver_place');
    const button = line.querySelector('.zk-deliver_change');
    if (label.textContent !== (place ? 'Delivering to' : 'Check same-day delivery')) {
      label.textContent = place ? 'Delivering to' : 'Check same-day delivery';
    }
    if (value.textContent !== place) value.textContent = place;
    value.classList.toggle('zinara-locating', locating);
    if (button.textContent !== (place ? 'Change' : 'Add pincode')) button.textContent = place ? 'Change' : 'Add pincode';
  }

  function groupHeader(list, id, order) {
    let header = list.querySelector(`:scope > .zk-group[data-zk-group="${id}"]`);
    if (!header) {
      header = make('div', 'zk-group');
      header.dataset.zkGroup = id;
      list.prepend(header);
    }
    header.style.order = order;
    return header;
  }

  function notice(container, id, order, icon, title, body) {
    let node = container.querySelector(`:scope > .zk-notice[data-zk-notice="${id}"]`);
    if (!node) {
      node = make('div', 'zk-notice');
      node.dataset.zkNotice = id;
      container.prepend(node);
    }
    node.style.order = order;
    setHTML(
      node,
      `<span class="zk-notice_icon" aria-hidden="true">${icon}</span>
       <span class="zk-notice_text">${title ? `<span class="zk-notice_title">${escape(title)}</span>` : ''}<span class="zk-notice_body">${escape(body)}</span></span>`,
    );
    return node;
  }

  const removeAll = (scope, selector) => scope.querySelectorAll(selector).forEach((node) => node.remove());

  function footerChip(sr, show) {
    const chips = sr.querySelector('.price-chips');
    if (!chips) return;
    let chip = chips.querySelector(':scope > .zk-chip');
    if (show && !chip) {
      chip = make('span', 'zk-chip', `${config.icons.truck}<span>Z-Now · Free</span>`);
      chips.prepend(chip);
    } else if (!show && chip) {
      chip.remove();
    }
    // It takes the place of GoKwik's "FREE shipping included" (Figma 8470:74438 /
    // 74586). Found by its words, not a class - GoKwik's class names change.
    Array.from(chips.children).forEach((node) => {
      if (node === chip) return;
      const freeShipping = /free shipping/i.test(node.textContent);
      node.toggleAttribute('data-zk-hidden', Boolean(show && freeShipping));
    });
  }

  /* ---------------------------------------------------------------- apply */

  function apply() {
    const sr = root;
    if (!sr) return;
    const list = sr.querySelector('.item-list-wrapper');
    const state = window.zinaraLocation?.get() || {};
    const time = window.zinaraZnowTime;
    const afterCutoff = html.classList.contains('znow-after-cutoff');

    deliverLine(sr, state);
    if (!list) return;

    // GoKwik pads its list; the headers and notices run edge to edge across
    // it (Figma's full-width bands), so they borrow its padding as negative
    // margins - read live, whatever GoKwik sets.
    const pad = getComputedStyle(list);
    const set = (name, value) => {
      if (list.style.getPropertyValue(name) !== value) list.style.setProperty(name, value);
    };
    set('--zk-pad-left', pad.paddingLeft);
    set('--zk-pad-right', pad.paddingRight);
    set('--zk-pad-top', pad.paddingTop);

    const tiles = readTiles(list);
    const known = tiles.every((entry) => entry.line); // every tile matched to a line
    const stocked = tiles.filter((entry) => entry.line?.inStock && !entry.free);
    const others = tiles.filter((entry) => !entry.free && !entry.line?.inStock);
    const gifts = tiles.filter((entry) => entry.free);
    const quantity = (group) => group.reduce((sum, entry) => sum + (entry.line?.quantity || 1), 0);
    const items = (n) => `${n} item${n === 1 ? '' : 's'}`;

    // In the area: ZNow lines (with any free gifts) first, the rest after.
    // Outside it, or with no pincode yet: ready-to-ship lines (with the gifts)
    // first, made-to-order after, each by its standard date.
    const znowGrouped = state.znow && known && stocked.length > 0;
    const groups = [];
    if (known && tiles.length) {
      if (znowGrouped || stocked.length) groups.push([...stocked, ...gifts]);
      if (others.length) groups.push(groups.length ? others : [...others, ...gifts]);
    }
    const grouped = groups.length > 0;

    if (!grouped) {
      removeAll(list, ':scope > .zk-group');
      tiles.forEach(({ tile }) => tile.style.removeProperty('order'));
    }
    if (!znowGrouped) removeAll(list, ':scope > .zk-notice[data-zk-notice="cutoff"]');

    // Moved out of the area (a ZNow pincode changed to one outside it), with
    // stock in the cart: say so once. Never in the area, nothing to say.
    const unavailable = state.leftZnow && state.pincode && known && stocked.length > 0;
    if (unavailable) {
      const n = quantity(stocked);
      notice(
        list,
        'unavailable',
        -1,
        config.icons.info,
        `Z-Now isn’t available at ${state.pincode} yet`,
        `We’ve moved ${items(n)} to standard delivery. ${n === 1 ? 'It' : 'They'} now arrive${n === 1 ? 's' : ''} ${weekdayDate(config.standardDays)}. Change pincode to check Z-Now availability.`,
      );
    } else {
      removeAll(list, ':scope > .zk-notice[data-zk-notice="unavailable"]');
    }

    footerChip(sr, znowGrouped);
    if (!grouped) return;

    const total = groups.length;

    groups.forEach((group, index) => {
      const base = index * 1000;
      const isZnow = znowGrouped && index === 0;
      const isStock = index === 0 && stocked.length > 0;
      // Ids by place, not kind: the first band ('znow') starts the list (CSS).
      const header = groupHeader(list, index === 0 ? 'znow' : 'standard', base);
      header.classList.toggle('zk-group--znow', isZnow);
      const by = isZnow
        ? `<span class="zk-group_pill">${config.icons.znow}<span>·</span><span>${
            afterCutoff ? `Tomorrow by ${escape(time?.tomorrowBy || '1 PM')}` : `Today by ${escape(time?.todayBy || '9 PM')}`
          }</span></span>`
        : `<span class="zk-group_when">${isStock ? 'Ready to ship' : 'Made to order'} · By ${dayMonth(
            isStock ? config.standardDays : config.madeDays,
          )}</span>`;
      setHTML(
        header,
        `<span class="zk-group_label"><span class="zk-group_check" aria-hidden="true">${config.icons.checkOn}</span><span class="zk-group_title">Delivery ${index + 1} of ${total}</span><span class="zk-group_count">· ${items(quantity(group))}</span></span>${by}`,
      );
      group.forEach(({ tile }, i) => {
        if (tile.style.order !== String(base + 2 + i)) tile.style.order = base + 2 + i;
      });
    });
    if (total === 1) removeAll(list, ':scope > .zk-group[data-zk-group="standard"]');

    // Past the cut-off: the notice under the ZNow header.
    if (znowGrouped && afterCutoff) {
      notice(
        list,
        'cutoff',
        1,
        config.icons.clock,
        '',
        `It’s past ${time?.cutoffLabel || '2 PM'}, so Z-Now items now arrive tomorrow by ${time?.tomorrowBy || '1 PM'}.`,
      );
    } else {
      removeAll(list, ':scope > .zk-notice[data-zk-notice="cutoff"]');
    }
  }

  /* ------------------------------------------------------------ plumbing */

  // Re-read the lines when the tiles themselves change (added, removed, a
  // variant switched), then apply; otherwise just re-apply.
  async function sync() {
    scheduled = false;
    if (!root) return;
    const list = root.querySelector('.item-list-wrapper');
    const signature = list
      ? Array.from(list.querySelectorAll(':scope > .product-tile-wrapper'))
          .map((tile) => tile.querySelector('.sidecart-product-title')?.textContent + '|' +
            Array.from(tile.querySelectorAll('select')).map((s) => s.value).join('/'))
          .join(';')
      : '';
    if (signature !== tileSignature || !lines) {
      tileSignature = signature;
      await loadLines();
    }
    try {
      apply();
    } catch (error) {
      /* GoKwik changed its markup - leave its cart as it is */
    }
  }

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => sync());
  };

  const ours = (node) => node.nodeType === 1 && (node.hasAttribute('data-zk') || node.closest?.('[data-zk]'));

  function watch(shadow) {
    if (root === shadow) return;
    root = shadow;
    if (!shadow.querySelector('style[data-zk-style]')) {
      const style = document.createElement('style');
      style.dataset.zkStyle = '';
      style.textContent = config.css || '';
      shadow.append(style);
    }
    new MutationObserver((records) => {
      // Our own insertions don't count - only GoKwik's redraws.
      const foreign = records.some(
        (record) =>
          !ours(record.target) &&
          [...record.addedNodes, ...record.removedNodes].some((node) => !ours(node)),
      );
      if (foreign) schedule();
    }).observe(shadow, { childList: true, subtree: true });
    // A variant switched in a tile's select changes the line underneath.
    shadow.addEventListener('change', () => setTimeout(() => {
      tileSignature = '';
      schedule();
    }, 600));
    schedule();
  }

  function findHost() {
    const host = document.querySelector('shadow-dom-container');
    if (host?.shadowRoot) {
      watch(host.shadowRoot);
      hostWatcher?.disconnect();
    }
  }

  // GoKwik mounts its container once, wherever it likes; look again only
  // when an element is added, until it's found.
  const hostWatcher = new MutationObserver((records) => {
    if (root) return;
    if (records.some((record) => [...record.addedNodes].some((node) => node.nodeType === 1))) findHost();
  });
  hostWatcher.observe(document.body, { childList: true, subtree: true });
  findHost();

  ['zinara:location', 'zinara:znow-cutoff'].forEach((type) => document.addEventListener(type, schedule));
  document.addEventListener('cart:updated', () => {
    tileSignature = '';
    schedule();
  });
})();
