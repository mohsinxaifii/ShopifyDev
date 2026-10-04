class HeaderComponent extends HTMLElement {
  connectedCallback() {
    this.menuToggle = this.querySelector('.header_wrapper_brand_menu-toggle');
    this.closeButton = this.querySelector('.header_drawer_header_close');
    this.overlay = this.querySelector('.header_drawer_overlay');
    this.drawer = this.querySelector('.header_drawer');
    this.searchToggle = this.querySelector('.header_wrapper_actions_search-toggle');
    this.isOpen = false;

    this.bindNavGroups();
    this.setupSticky();

    this.searchToggle?.addEventListener('click', () => this.toggleSearch());
    this.menuToggle?.addEventListener('click', () => this.open());
    this.closeButton?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
      if (event.key === 'Tab' && this.isOpen) this.trapFocus(event);
    });
  }

  /* Sticky header (theme setting "Sticky header"; CSS in header.css).

     The announcement bar above the header and the category bar below it move
     with it as one block. "always" just sticks. "scroll-up" behaves like
     Shopify's own themes: the block scrolls away with the page, slides out of
     view while the shopper scrolls down, and slides back in on any scroll up.
     It is never hidden while the menu drawer or the search field is open.

     On <html>: --announcement-height and --header-height stack the three
     sections; --header-group-height is how far they move to hide;
     --header-sticky-offset is the height on screen right now (0 when hidden),
     for other sticky elements - the PDP gallery - to sit below. */
  setupSticky() {
    const mode = this.dataset.sticky;
    this.section = this.closest('.shopify-section');
    if (!this.section || (mode !== 'scroll-up' && mode !== 'always')) return;

    const root = document.documentElement;
    // Found by their own class, not by being next to the header, so nothing
    // an app inserts in between can drop one of them from the block.
    const bar = document.querySelector('.shopify-section--announcement-bar');
    const nav = document.querySelector('.shopify-section--category-nav');
    const group = [bar, this.section, nav].filter(Boolean);
    if (bar) bar.dataset.stickyPart = 'bar';
    this.section.dataset.stickyPart = 'header';
    if (nav) nav.dataset.stickyPart = 'nav';

    // Ignore jitter (trackpads, iOS bounce) so the block does not flicker.
    const THRESHOLD = 6;
    let lastY = Math.max(0, window.scrollY);
    let ticking = false;

    const isBusy = () =>
      this.isOpen ||
      this.getAttribute('data-search-open') === 'true' ||
      root.classList.contains('search-suggest-open') ||
      group.some((section) => section.contains(document.activeElement));

    // Where the block starts before it sticks: below whatever visible element
    // precedes it (normally nothing - it opens the page). Sticky elements report
    // their stuck position, so the measurement is taken from outside the block.
    const naturalTop = (y) => {
      for (let prev = group[0].previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.offsetHeight > 0) return Math.max(0, prev.getBoundingClientRect().bottom + y);
      }
      return 0;
    };

    const update = () => {
      ticking = false;
      const y = Math.max(0, window.scrollY);
      // offsetHeight is 0 for a section that is display: none (the category
      // bar on phones), so it simply drops out of the sums.
      const barHeight = bar ? bar.offsetHeight : 0;
      const headerHeight = this.section.offsetHeight;
      const total = group.reduce((sum, section) => sum + section.offsetHeight, 0);
      const top = naturalTop(y);
      const stuck = y > top;

      let hidden = this.section.classList.contains('is-header-hidden');
      if (mode === 'always' || !stuck || isBusy()) {
        hidden = false;
      } else if (y - lastY > THRESHOLD && y > top + total) {
        hidden = true;
      } else if (lastY - y > THRESHOLD) {
        hidden = false;
      }
      if (Math.abs(y - lastY) > THRESHOLD || !stuck) lastY = y;

      group.forEach((section) => section.classList.toggle('is-header-hidden', hidden));
      root.style.setProperty('--announcement-height', `${barHeight}px`);
      root.style.setProperty('--header-height', `${headerHeight}px`);
      root.style.setProperty('--header-group-height', `${total}px`);
      root.style.setProperty('--header-sticky-offset', stuck && !hidden ? `${total}px` : '0px');
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Heights change without a scroll too (the phone search field, a wrapping
    // announcement), so the stacking offsets are re-measured when they do.
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(onScroll);
      group.forEach((section) => observer.observe(section));
    }
    // Tabbing into a hidden block should bring it back.
    const reveal = () => {
      group.forEach((section) => section.classList.remove('is-header-hidden'));
      onScroll();
    };
    group.forEach((section) => section.addEventListener('focusin', reveal));
    update();
  }

  /* Any menu item with children collapses into an accordion (Figma 7930:109338
     shows one open, 7930:109352 one closed). The caret is a single right-facing
     chevron that rotates down when the panel opens. */
  bindNavGroups() {
    this.querySelectorAll('[data-nav-toggle]').forEach((toggle) => {
      const group = toggle.closest('[data-nav-group]');
      const panel = group?.querySelector('[data-nav-panel]');
      if (!panel) return;

      // Open the branch the shopper is already inside.
      if (toggle.classList.contains('is-current')) this.setGroup(toggle, panel, true);

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        this.setGroup(toggle, panel, !open);
      });
    });
  }

  setGroup(toggle, panel, open) {
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    toggle.closest('[data-nav-group]')?.classList.toggle('is-open', open);
  }

  /* Mobile only: the search icon reveals the header's search field under the bar. */
  toggleSearch() {
    const open = this.getAttribute('data-search-open') !== 'true';
    this.setAttribute('data-search-open', String(open));
    this.searchToggle.setAttribute('aria-expanded', String(open));
    if (open) this.querySelector('[data-suggest-input]')?.focus();
  }

  /* Figma Mobile 8106:54336: the menu opens under the announcement bar, which
     stays in view. The bar scrolls with the page, so the drawer starts wherever
     its bottom edge is right now - flush to the top once it has scrolled off. */
  syncDrawerTop() {
    const bar = document.querySelector('.announcement-bar');
    const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
    this.style.setProperty('--header-drawer-top', `${top}px`);
  }

  /* The overlay and the drawer are popovers (sections/header.liquid): shown,
     they sit in the browser's top layer, above anything on the page whatever
     its z-index - so nothing can cover the open menu. The overlay goes in
     first, so the drawer stacks over it. Browsers without popovers keep the
     plain fixed positioning. */
  setTopLayer(on) {
    [this.overlay, this.drawer].forEach((element) => {
      if (typeof element?.showPopover !== 'function') return;
      const showing = element.matches(':popover-open');
      try {
        if (on && !showing) element.showPopover();
        else if (!on && showing) element.hidePopover();
      } catch (error) {
        // Already in the requested state.
      }
    });
  }

  open() {
    window.zinaraTrack?.('sidenav_open');
    this.syncDrawerTop();
    this.setTopLayer(true);
    this.isOpen = true;
    this.setAttribute('data-drawer-open', 'true');
    this.menuToggle?.setAttribute('aria-expanded', 'true');
    this.drawer.removeAttribute('inert');
    this.overlay.removeAttribute('inert');
    document.body.style.overflow = 'hidden';

    if (window.gsap) {
      gsap.set(this.overlay, { visibility: 'visible' });
      gsap.to(this.overlay, { opacity: 1, duration: 0.3, ease: 'power1.out' });
      gsap.to(this.drawer, { x: 0, duration: 0.45, ease: 'power3.out' });
    } else {
      this.drawer.style.transform = 'translateX(0)';
      this.overlay.style.opacity = '1';
      this.overlay.style.visibility = 'visible';
    }

    window.setTimeout(() => {
      this.drawer.querySelector('a, button')?.focus();
    }, 300);
  }

  close() {
    this.isOpen = false;
    this.setAttribute('data-drawer-open', 'false');
    this.menuToggle?.setAttribute('aria-expanded', 'false');
    this.drawer.setAttribute('inert', '');
    this.overlay.setAttribute('inert', '');
    document.body.style.overflow = '';

    if (window.gsap) {
      gsap.to(this.overlay, {
        opacity: 0,
        duration: 0.25,
        ease: 'power1.in',
        onComplete: () => gsap.set(this.overlay, { visibility: 'hidden' }),
      });
      gsap.to(this.drawer, {
        x: '-100%',
        duration: 0.35,
        ease: 'power3.in',
        // Out of the top layer once it has slid away - unless it was reopened.
        onComplete: () => {
          if (!this.isOpen) this.setTopLayer(false);
        },
      });
    } else {
      this.drawer.style.transform = 'translateX(-100%)';
      this.overlay.style.opacity = '0';
      this.overlay.style.visibility = 'hidden';
      this.setTopLayer(false);
    }

    this.menuToggle?.focus();
  }

  trapFocus(event) {
    const focusable = Array.from(this.drawer.querySelectorAll('a, button')).filter(
      (el) => el.offsetParent !== null,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

customElements.define('header-component', HeaderComponent);
