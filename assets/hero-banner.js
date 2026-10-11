class HeroBannerSlideshow extends HTMLElement {
  connectedCallback() {
    this.slides = Array.from(this.querySelectorAll('.hero-banner_wrapper_track_slide'));
    this.dots = Array.from(this.querySelectorAll('.hero-banner_wrapper_dots_dot'));
    this.prevButton = this.querySelector('.hero-banner_wrapper_prev');
    this.nextButton = this.querySelector('.hero-banner_wrapper_next');
    this.currentIndex = 0;
    this.autoplay = this.dataset.autoplay === 'true';
    this.autoplaySpeed = Number(this.dataset.autoplaySpeed) || 6000;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.slides.length < 2) return;

    this.prevButton?.addEventListener('click', () => this.goTo(this.currentIndex - 1, true, -1));
    this.nextButton?.addEventListener('click', () => this.goTo(this.currentIndex + 1, true, 1));
    this.dots.forEach((dot, index) => {
      dot.addEventListener('click', () => this.goTo(index, true));
    });
    // Drag with a mouse or swipe with a finger to change slide (assets/swipe.js).
    window.zinaraSwipe?.(this, {
      onSwipe: (direction) => this.goTo(this.currentIndex + direction, true, direction),
    });
    // A slide that has finished leaving drops out of sight (hero-banner.css).
    this.slides.forEach((slide) => {
      slide.addEventListener('transitionend', (event) => {
        if (event.target === slide && event.propertyName === 'transform' && !slide.classList.contains('is-active')) {
          slide.classList.remove('is-leaving');
        }
      });
    });
    // Later slides are lazy and now wait off to the side, so fetch them once
    // the page has loaded rather than letting one slide in still blank.
    const loadAll = () =>
      this.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        img.loading = 'eager';
      });
    if (document.readyState === 'complete') loadAll();
    else window.addEventListener('load', loadAll, { once: true });
    this.addEventListener('mouseenter', () => this.stopAutoplay());
    this.addEventListener('mouseleave', () => this.startAutoplay());
    this.addEventListener('focusin', () => this.stopAutoplay());
    this.addEventListener('focusout', () => this.startAutoplay());

    if (this.autoplay && !this.reducedMotion) this.startAutoplay();
  }

  disconnectedCallback() {
    this.stopAutoplay();
  }

  /**
   * `direction` is 1 to slide in from the right, -1 from the left; left out,
   * it follows the order of the slides (dots). Autoplay always moves forward,
   * so the last slide hands over to the first in one step.
   */
  goTo(index, isManual = false, direction = 0) {
    const nextIndex = (index + this.slides.length) % this.slides.length;
    if (nextIndex !== this.currentIndex) {
      const dir = direction || (nextIndex > this.currentIndex ? 1 : -1);
      const incoming = this.slides[nextIndex];
      const outgoing = this.slides[this.currentIndex];

      // Park the incoming slide on the side it enters from, without animating.
      incoming.classList.remove('is-leaving');
      incoming.style.transition = 'none';
      incoming.style.transform = `translateX(${dir * 100}%)`;
      void incoming.offsetWidth;
      incoming.style.transition = '';
      incoming.style.transform = '';

      outgoing.classList.add('is-leaving');
      outgoing.style.transform = `translateX(${dir * -100}%)`;
    }
    this.currentIndex = nextIndex;
    this.slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === this.currentIndex);
      // The slide link and the button: only the visible slide's are tabbable.
      slide.querySelectorAll('a').forEach((link) => {
        link.tabIndex = i === this.currentIndex ? 0 : -1;
      });
    });
    this.dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === this.currentIndex);
      dot.setAttribute('aria-selected', String(i === this.currentIndex));
    });

    if (isManual) {
      this.stopAutoplay();
      if (this.autoplay && !this.reducedMotion) this.startAutoplay();
    }
  }

  startAutoplay() {
    if (!this.autoplay || this.reducedMotion || this.slides.length < 2) return;
    this.stopAutoplay();
    this.timer = window.setInterval(() => this.goTo(this.currentIndex + 1, false, 1), this.autoplaySpeed);
  }

  stopAutoplay() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

customElements.define('hero-banner-slideshow', HeroBannerSlideshow);
