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
    // Drag with a mouse or swipe with a finger to change slide (assets/swipe.js):
    // the slide and its neighbour follow the finger, then finish or snap back.
    window.zinaraSwipe?.(this, {
      onDrag: (dx) => this.drag(dx),
      onSwipe: (direction) => this.release(direction),
      onCancel: () => this.release(0),
    });
    // A slide that has finished moving drops its inline motion; one that is
    // not showing goes back out of sight, parked without animating, so it can
    // never sweep across the band on its way back (hero-banner.css).
    this.slides.forEach((slide) => {
      slide.addEventListener('transitionend', (event) => {
        if (event.target !== slide || event.propertyName !== 'transform') return;
        if (slide.classList.contains('is-active')) {
          slide.style.transition = '';
          return;
        }
        this.park(slide);
      });
    });
    // Later slides are lazy and now wait off to the side, so fetch them once
    // the page has loaded rather than letting one slide in still blank.
    // Decoded ahead too, so the first time each one slides in it doesn't
    // stall mid-move while the phone unpacks a large image.
    const loadAll = () =>
      this.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        img.loading = 'eager';
        img.decode?.().catch(() => {});
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

  /** Out of sight on the right, without animating (hero-banner.css). */
  park(slide) {
    slide.classList.remove('is-leaving', 'is-dragging');
    slide.style.transition = 'none';
    slide.style.transform = '';
    void slide.offsetWidth;
    slide.style.transition = '';
  }

  /** Mid-drag: the slide and the neighbour it reveals move with the finger. */
  drag(dx) {
    this.stopAutoplay();
    const count = this.slides.length;
    const dir = dx < 0 ? 1 : -1;
    const current = this.slides[this.currentIndex];
    const neighbour = this.slides[(this.currentIndex + dir + count) % count];
    // Changed direction mid-drag: the other neighbour goes back out of sight.
    if (this.dragNeighbour && this.dragNeighbour !== neighbour) this.park(this.dragNeighbour);
    this.dragNeighbour = neighbour;
    this.dragDir = dir;
    neighbour.classList.remove('is-leaving');
    neighbour.classList.add('is-dragging');
    current.style.transition = 'none';
    neighbour.style.transition = 'none';
    current.style.transform = `translateX(${dx}px)`;
    neighbour.style.transform = `translateX(calc(${dir * 100}% + ${dx}px))`;
  }

  /**
   * End of a drag: `direction` 1 / -1 finishes the move from where the finger
   * left it, 0 (too short) snaps back. A quick ease-out from there, not a
   * fresh full slide, so it carries on the finger's motion.
   */
  release(direction) {
    const neighbour = this.dragNeighbour;
    this.dragNeighbour = null;
    if (!neighbour) {
      if (direction) this.goTo(this.currentIndex + direction, true, direction);
      return;
    }
    const current = this.slides[this.currentIndex];
    const settle = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
    current.style.transition = settle;
    neighbour.style.transition = settle;
    if (direction && direction === this.dragDir) {
      neighbour.classList.remove('is-dragging');
      current.classList.add('is-leaving');
      this.setActive(this.slides.indexOf(neighbour));
      neighbour.style.transform = '';
      current.style.transform = `translateX(${direction * -100}%)`;
    } else {
      current.style.transform = '';
      neighbour.style.transform = `translateX(${this.dragDir * 100}%)`;
    }
    if (this.autoplay && !this.reducedMotion) this.startAutoplay();
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
    this.setActive(nextIndex);

    if (isManual) {
      this.stopAutoplay();
      if (this.autoplay && !this.reducedMotion) this.startAutoplay();
    }
  }

  /** Marks slide `index` as the one showing: classes, links, dots. */
  setActive(index) {
    this.currentIndex = index;
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
