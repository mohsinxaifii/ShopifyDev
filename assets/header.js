class HeaderComponent extends HTMLElement {
  connectedCallback() {
    this.menuToggle = this.querySelector('.header_wrapper_brand_menu-toggle');
    this.closeButton = this.querySelector('.header_drawer_header_close');
    this.overlay = this.querySelector('.header_drawer_overlay');
    this.drawer = this.querySelector('.header_drawer');
    this.searchToggle = this.querySelector('.header_wrapper_actions_search-toggle');
    this.isOpen = false;

    this.searchToggle?.addEventListener('click', () => this.toggleSearch());
    this.menuToggle?.addEventListener('click', () => this.open());
    this.closeButton?.addEventListener('click', () => this.close());
    this.overlay?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) this.close();
      if (event.key === 'Tab' && this.isOpen) this.trapFocus(event);
    });
  }

  /* Mobile only: the search icon reveals the header's search field under the bar. */
  toggleSearch() {
    const open = this.getAttribute('data-search-open') !== 'true';
    this.setAttribute('data-search-open', String(open));
    this.searchToggle.setAttribute('aria-expanded', String(open));
    if (open) this.querySelector('[data-suggest-input]')?.focus();
  }

  open() {
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
