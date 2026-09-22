/**
 * Seamless, never-ending video carousel.
 *
 * The block list is repeated on both sides of the real set so the track can keep
 * travelling in one direction forever. Before every move the track is silently
 * repositioned onto an identical-looking copy, so the animation itself is always
 * a plain one-step slide and the loop has no visible seam.
 */
class VideoShowcase extends HTMLElement {
  connectedCallback() {
    this.viewport = this.querySelector('[data-viewport]');
    this.track = this.querySelector('[data-track]');
    this.dotsContainer = this.querySelector('[data-dots]');
    if (!this.viewport || !this.track) return;

    this.originals = Array.from(this.track.querySelectorAll('[data-slide]'));
    this.count = this.originals.length;
    if (this.count === 0) return;

    this.fallbackDuration = (parseFloat(this.dataset.fallbackDuration) || 6) * 1000;
    this.isVisible = true;
    this.isPaused = false;

    this.buildLoop();
    this.buildDots();
    this.measure();

    this.index = this.offset;
    this.setActiveVisual(this.index);
    this.applyTransform();

    this.bindEvents();
    this.observeVisibility();

    // Wait for layout to settle (fonts/images) before trusting the measurement.
    requestAnimationFrame(() => {
      this.measure();
      this.applyTransform();
      this.startSlide(this.index);
    });
  }

  disconnectedCallback() {
    this.stopTicker();
    this.detachVideo();
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  /* ---------------------------------------------------------------- setup */

  buildLoop() {
    // Enough copies on each side that the peeking cards never run out.
    const copies = Math.max(1, Math.ceil(4 / this.count));
    const before = document.createDocumentFragment();
    const after = document.createDocumentFragment();

    for (let set = 0; set < copies; set += 1) {
      this.originals.forEach((slide) => {
        before.appendChild(this.cloneSlide(slide));
        after.appendChild(this.cloneSlide(slide));
      });
    }

    this.track.insertBefore(before, this.track.firstChild);
    this.track.appendChild(after);

    this.offset = this.count * copies;
    this.slides = Array.from(this.track.querySelectorAll('[data-slide]'));
  }

  cloneSlide(slide) {
    const clone = slide.cloneNode(true);
    clone.setAttribute('data-clone', '');
    clone.removeAttribute('id');
    clone.removeAttribute('data-shopify-editor-block');
    return clone;
  }

  buildDots() {
    if (!this.dotsContainer) return;
    this.dotsContainer.innerHTML = '';
    if (this.count <= 1) return;

    this.dots = this.originals.map((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'scroll-carousel_dot';
      dot.setAttribute('aria-label', `Go to video ${i + 1}`);
      dot.addEventListener('click', () => this.goTo(this.nearestIndexFor(i)));
      this.dotsContainer.appendChild(dot);
      return dot;
    });
  }

  bindEvents() {
    this.querySelector('[data-prev]')?.addEventListener('click', () => this.goTo(this.index - 1));
    this.querySelector('[data-next]')?.addEventListener('click', () => this.goTo(this.index + 1));

    this.slides.forEach((slide, i) => {
      slide.addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        if (i === this.index) this.togglePlayback();
        else this.goTo(i);
      });
    });

    this.onVisibilityChange = () => {
      if (document.hidden) this.pauseCurrent();
      else this.resumeCurrent();
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => {
        this.measure();
        this.withoutTransition(() => this.applyTransform());
      });
      this.resizeObserver.observe(this.viewport);
    }

    this.addEventListener('shopify:block:select', (event) => {
      const target = this.originals.indexOf(event.target.closest('[data-slide]'));
      if (target >= 0) this.goTo(this.nearestIndexFor(target));
    });
  }

  observeVisibility() {
    if (!('IntersectionObserver' in window)) return;
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isVisible = entry.isIntersecting;
          if (entry.isIntersecting) this.resumeCurrent();
          else this.pauseCurrent();
        });
      },
      { threshold: 0.25 },
    );
    this.intersectionObserver.observe(this);
  }

  /* ------------------------------------------------------------ geometry */

  measure() {
    const first = this.slides[0]?.getBoundingClientRect();
    const second = this.slides[1]?.getBoundingClientRect();
    if (!first) return;

    const styles = getComputedStyle(this.track);
    const gap = parseFloat(styles.columnGap || styles.gap) || 0;

    // Measured centre to centre rather than edge to edge, so the step stays
    // correct whatever transform a card is carrying.
    this.step = second
      ? second.left + second.width / 2 - (first.left + first.width / 2)
      : first.width + gap;
    this.cardWidth = this.step - gap;
  }

  applyTransform() {
    if (!this.step) return;
    const x = this.viewport.clientWidth / 2 - (this.index * this.step + this.cardWidth / 2);
    this.track.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  withoutTransition(callback) {
    this.track.classList.add('is-snapping');
    callback();
    void this.track.offsetWidth; // commit the styles above before animating again
    this.track.classList.remove('is-snapping');
  }

  /* ------------------------------------------------------------ movement */

  normalize(index) {
    const span = this.count;
    let normalized = index;
    while (normalized < this.offset) normalized += span;
    while (normalized > this.offset + span - 1) normalized -= span;
    return normalized;
  }

  nearestIndexFor(blockIndex) {
    const target = this.offset + blockIndex;
    const candidates = [target - this.count, target, target + this.count];
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - this.index) < Math.abs(best - this.index) ? candidate : best,
    );
  }

  goTo(target) {
    if (!this.slides.length) return;

    const destination = this.normalize(target);
    const delta = target - this.index;
    const from = destination - delta;

    if (delta === 0) return;

    // Slide onto the identical copy that keeps the move a single step.
    if (from !== this.index && from >= 0 && from < this.slides.length) {
      this.withoutTransition(() => {
        this.index = from;
        this.setActiveVisual(from);
        this.applyTransform();
      });
    }

    this.index = destination;
    this.track.classList.add('is-animating');
    this.setActiveVisual(destination);
    this.applyTransform();
    this.startSlide(destination);
  }

  next() {
    this.goTo(this.index + 1);
  }

  setActiveVisual(index) {
    this.slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === index);
      if (i !== index) slide.classList.remove('is-paused', 'is-playing');
    });

    const active = index % this.count;
    this.dots?.forEach((dot, i) => dot.classList.toggle('is-active', i === active));
  }

  /* ------------------------------------------------------------ playback */

  startSlide(index) {
    this.stopTicker();
    this.detachVideo();
    this.isPaused = false;

    const slide = this.slides[index];
    if (!slide) return;

    this.currentSlide = slide;
    this.progressBar = slide.querySelector('[data-progress]');
    this.setProgress(0);
    this.primeNeighbour(index);

    const video = slide.querySelector('video');
    if (!video) {
      this.startFallbackTimer();
      return;
    }

    this.currentVideo = video;
    video.muted = true;
    video.loop = false;
    video.preload = 'auto';
    this.onVideoEnded = () => this.next();
    this.onVideoError = () => this.startFallbackTimer();
    video.addEventListener('ended', this.onVideoEnded);
    video.addEventListener('error', this.onVideoError);

    try {
      video.currentTime = 0;
    } catch (error) {
      /* metadata not ready yet — playback still starts from the beginning */
    }

    if (!this.isVisible || document.hidden) return;

    const played = video.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => this.startFallbackTimer());
    }
    slide.classList.add('is-playing');
    this.startTicker();
  }

  primeNeighbour(index) {
    const upcoming = this.slides[index + 1]?.querySelector('video');
    if (upcoming) upcoming.preload = 'auto';
  }

  detachVideo() {
    const video = this.currentVideo;
    if (!video) return;
    if (this.onVideoEnded) video.removeEventListener('ended', this.onVideoEnded);
    if (this.onVideoError) video.removeEventListener('error', this.onVideoError);
    video.pause();
    video.preload = 'metadata';
    try {
      video.currentTime = 0;
    } catch (error) {
      /* nothing loaded to rewind */
    }
    this.currentSlide?.classList.remove('is-playing', 'is-paused');
    this.currentVideo = null;
    this.onVideoEnded = null;
    this.onVideoError = null;
  }

  togglePlayback() {
    if (!this.currentSlide) return;

    if (this.isPaused) {
      this.isPaused = false;
      this.currentSlide.classList.remove('is-paused');
      this.currentSlide.classList.add('is-playing');
      this.currentVideo?.play().catch(() => {});
      this.fallbackStart = performance.now() - (this.fallbackElapsed || 0);
      this.startTicker();
    } else {
      this.isPaused = true;
      this.currentSlide.classList.add('is-paused');
      this.currentSlide.classList.remove('is-playing');
      this.currentVideo?.pause();
      this.stopTicker();
    }
  }

  pauseCurrent() {
    if (this.isPaused) return;
    this.currentVideo?.pause();
    this.stopTicker();
  }

  resumeCurrent() {
    if (this.isPaused || !this.isVisible || document.hidden || !this.currentSlide) return;
    if (this.currentVideo) {
      this.currentVideo.play().catch(() => {});
    } else {
      this.fallbackStart = performance.now() - (this.fallbackElapsed || 0);
    }
    this.startTicker();
  }

  /* ------------------------------------------------------------ progress */

  startFallbackTimer() {
    this.currentSlide?.classList.remove('is-playing');
    this.fallbackElapsed = 0;
    this.fallbackStart = performance.now();
    this.startTicker();
  }

  startTicker() {
    this.stopTicker();
    const tick = () => {
      this.tickerId = requestAnimationFrame(tick);
      this.updateProgress();
    };
    this.tickerId = requestAnimationFrame(tick);
  }

  stopTicker() {
    if (this.tickerId) cancelAnimationFrame(this.tickerId);
    this.tickerId = null;
  }

  updateProgress() {
    const video = this.currentVideo;

    if (video && Number.isFinite(video.duration) && video.duration > 0 && !video.paused) {
      this.setProgress(video.currentTime / video.duration);
      return;
    }

    if (video && !video.paused) return; // duration not known yet, keep waiting

    if (this.fallbackStart == null) return;
    this.fallbackElapsed = performance.now() - this.fallbackStart;
    const ratio = this.fallbackElapsed / this.fallbackDuration;
    this.setProgress(ratio);
    if (ratio >= 1) {
      this.fallbackStart = null;
      this.next();
    }
  }

  setProgress(ratio) {
    if (!this.progressBar) return;
    const clamped = Math.min(Math.max(ratio, 0), 1);
    this.progressBar.style.width = `${clamped * 100}%`;
  }
}

customElements.define('video-showcase', VideoShowcase);
