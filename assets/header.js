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

     "always" just sticks. "scroll-up" behaves like Shopify's own themes: the
     header scrolls away with the page, slides out of view while the shopper
     scrolls down, and slides back in on any scroll up. It is never hidden
     while the menu drawer or the search field is open.

     --header-sticky-offset on <html> is the header's height whenever it is
     stuck and on screen, 0 otherwise, for other sticky elements to sit below. */
  setupSticky() {
    const mode = this.dataset.sticky;
    this.section = this.closest('.shopify-section');
    if (!this.section || (mode !== 'scroll-up' && mode !== 'always')) return;

    const root = document.documentElement;
    // Ignore jitter (trackpads, iOS bounce) so the header does not flicker.
    const THRESHOLD = 6;
    let lastY = Math.max(0, window.scrollY);
    let ticking = false;

    const isBusy = () =>
      this.isOpen ||
      this.getAttribute('data-search-open') === 'true' ||
      root.classList.contains('search-suggest-open') ||
      this.contains(document.activeElement);

    const update = () => {
      ticking = false;
      const y = Math.max(0, window.scrollY);
      const height = this.section.offsetHeight;
      // Where the header sits in the page before it sticks: below the
      // announcement bar, which scrolls away normally.
      const previous = this.section.previousElementSibling;
      const naturalTop = previous ? Math.max(0, previous.getBoundingClientRect().bottom + y) : 0;
      const stuck = y > naturalTop;

      let hidden = this.section.classList.contains('is-header-hidden');
      if (mode === 'always' || !stuck || isBusy()) {
        hidden = false;
      } else if (y - lastY > THRESHOLD && y > naturalTop + height) {
        hidden = true;
      } else if (lastY - y > THRESHOLD) {
        hidden = false;
      }
      if (Math.abs(y - lastY) > THRESHOLD || !stuck) lastY = y;

      this.section.classList.toggle('is-header-hidden', hidden);
      root.style.setProperty('--header-sticky-offset', stuck && !hidden ? `${height}px` : '0px');
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Tabbing into a hidden header should bring it back.
    this.addEventListener('focusin', () => {
      this.section.classList.remove('is-header-hidden');
      onScroll();
    });
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

  open() {
    this.syncDrawerTop();
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
      gsap.to(this.drawer, { x: '-100%', duration: 0.35, ease: 'power3.in' });
    } else {
      this.drawer.style.transform = 'translateX(-100%)';
      this.overlay.style.opacity = '0';
      this.overlay.style.visibility = 'hidden';
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
