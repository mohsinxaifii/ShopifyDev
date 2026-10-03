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
    this.bindSwipe();
    this.bindProductCards();
    this.initPopup();
    this.observeVisibility();

    // Wait for layout to settle (fonts/images) before trusting the measurement.
    requestAnimationFrame(() => {
      this.measure();
      this.applyTransform();
      this.startSlide(this.index);
    });
  }

  /* The buy row on a slide. Delegated, because buildLoop() clones the slides
     for the infinite track and a listener bound to the originals would be lost
     on every copy. Clicks are kept away from the slide itself, which otherwise
     treats any click as "make me the active slide". */
  bindProductCards() {
    this.addEventListener('click', (event) => {
      const card = event.target.closest('[data-product-card]');
      if (!card || !this.contains(card)) return;

      const button = event.target.closest('[data-add-to-cart]');
      if (!button) {
        // A tap on the title or thumbnail should just follow the link.
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.addProduct(button);
    });
  }

  async addProduct(button) {
    if (button.disabled) return;

    // Anything with options has to be chosen first; the drawer then adds it.
    const variantCount = Number(button.dataset.variantCount || 1);
    const drawer = document.querySelector('variant-drawer');
    if (variantCount > 1 && drawer && button.dataset.productUrl) {
      drawer.open(button.dataset.productUrl, button);
      return;
    }

    const variantId = Number(button.dataset.variantId);
    if (!variantId) return;
    await window.zinaraCart?.add([{ id: variantId, quantity: 1 }], button);
  }

  disconnectedCallback() {
    this.stopTicker();
    this.stopPopupTicker();
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
        if (this.popup) this.openPopup(Number(slide.dataset.index) || 0);
        else if (i === this.index) this.togglePlayback();
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

  /* Drag the track with a finger (or mouse) and it follows; let go past a
     small threshold and it moves one card, otherwise it springs back. The
     viewport is `touch-action: pan-y`, so vertical page scrolling still belongs
     to the browser and a scroll that starts vertical cancels the pointer. */
  bindSwipe() {
    const threshold = () => Math.min(50, (this.step || 200) * 0.2);
    let pointerId = null;
    let startX = 0;
    let startY = 0;

    const release = (event, cancelled) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (!this.isDragging) return;

      this.isDragging = false;
      this.track.classList.remove('is-snapping');
      this.track.classList.add('is-animating');

      // The finger lifting fires a click on whatever it was over; eat it.
      this.suppressClick = true;
      setTimeout(() => {
        this.suppressClick = false;
      }, 0);

      const offset = this.dragOffset;
      if (!cancelled && offset <= -threshold()) {
        this.goTo(this.index + 1);
      } else if (!cancelled && offset >= threshold()) {
        this.goTo(this.index - 1);
      } else {
        this.dragOffset = 0;
        this.applyTransform();
        if (this.pendingNext) this.next();
      }
      this.pendingNext = false;
    };

    this.viewport.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.closest('[data-product-card]')) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    });

    this.viewport.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!this.isDragging) {
        if (Math.abs(dx) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          pointerId = null;
          return;
        }
        this.isDragging = true;
        this.viewport.setPointerCapture?.(pointerId);
        this.track.classList.remove('is-animating');
        this.track.classList.add('is-snapping');
      }

      this.dragOffset = dx;
      this.applyTransform();
    });

    this.viewport.addEventListener('pointerup', (event) => release(event, false));
    this.viewport.addEventListener('pointercancel', (event) => release(event, true));

    // Stop the browser dragging posters and links around as ghost images.
    this.viewport.addEventListener('dragstart', (event) => event.preventDefault());

    this.addEventListener(
      'click',
      (event) => {
        if (!this.suppressClick) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
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
    const x =
      this.viewport.clientWidth / 2 - (this.index * this.step + this.cardWidth / 2) + (this.dragOffset || 0);
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
      // Any drag offset is kept here so the swap onto the copy stays invisible.
      this.withoutTransition(() => {
        this.index = from;
        this.setActiveVisual(from);
        this.applyTransform();
      });
    }

    this.dragOffset = 0;
    this.index = destination;
    this.track.classList.add('is-animating');
    this.setActiveVisual(destination);
    this.applyTransform();
    this.startSlide(destination);
  }

  next() {
    // A video ending mid-swipe waits for the finger; release() picks it up.
    if (this.isDragging) {
      this.pendingNext = true;
      return;
    }
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
    if (this.popupOpen) return;
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

  /* --------------------------------------------------------------- popup */

  /* Tapping a card opens every clip as a reel (Figma 8106:46859 / 8106:61387).
     The inline carousel holds still underneath until the popup closes. Clips
     get their `src` only once they are on screen, as the active clip or one of
     its neighbours, so opening the popup never downloads the whole set. */
  initPopup() {
    this.popup = this.querySelector('[data-popup]');
    if (!this.popup) return;

    this.popupSlides = Array.from(this.popup.querySelectorAll('[data-popup-slide]'));
    this.popupShops = Array.from(this.popup.querySelectorAll('[data-popup-shop]'));
    this.popupIndex = 0;
    this.popupMuted = false;
    this.popup.classList.toggle('is-single', this.popupSlides.length < 2);

    this.popupSlides.forEach((slide) => {
      slide.querySelector('video')?.addEventListener('ended', () => {
        if (this.popupOpen && slide.classList.contains('is-active')) this.showPopup(this.popupIndex + 1);
      });
    });

    this.popup.addEventListener('click', (event) => {
      if (performance.now() - (this.popupSwipedAt || 0) < 400) return;

      if (event.target.closest('[data-popup-close]')) {
        this.popup.close();
        return;
      }
      if (event.target.closest('[data-popup-prev]')) {
        this.showPopup(this.popupIndex - 1);
        return;
      }
      if (event.target.closest('[data-popup-next]')) {
        this.showPopup(this.popupIndex + 1);
        return;
      }
      if (event.target.closest('[data-popup-sound]')) {
        this.setPopupMuted(!this.popupMuted);
        return;
      }

      const add = event.target.closest('[data-popup-add]');
      if (add) {
        event.preventDefault();
        this.addProduct(add);
        return;
      }

      const slide = event.target.closest('[data-popup-slide]');
      if (slide) {
        const index = this.popupSlides.indexOf(slide);
        if (index === this.popupIndex) this.togglePopupPlayback();
        else this.showPopup(index);
        return;
      }

      // Anything else is the dark space around the reel.
      if (!event.target.closest('a, button, .video-showcase-popup_shop_card')) this.popup.close();
    });

    this.popup.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') this.showPopup(this.popupIndex - 1);
      if (event.key === 'ArrowRight') this.showPopup(this.popupIndex + 1);
    });

    this.popup.addEventListener('close', () => this.onPopupClose());
    this.bindPopupSwipe();
  }

  /* A sideways swipe on the clip changes clip; the stage is `touch-action:
     pan-y`, so a vertical drag is still the browser's to handle. */
  bindPopupSwipe() {
    const stage = this.popup.querySelector('[data-popup-stage]');
    if (!stage) return;
    let startX = null;
    let startY = 0;

    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      startX = event.clientX;
      startY = event.clientY;
    });

    stage.addEventListener('pointerup', (event) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      startX = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      this.popupSwipedAt = performance.now();
      this.showPopup(this.popupIndex + (dx < 0 ? 1 : -1));
    });

    stage.addEventListener('pointercancel', () => {
      startX = null;
    });
  }

  openPopup(index) {
    if (!this.popup || this.popup.open) return;
    this.popupOpen = true;
    this.pauseCurrent();

    // The popup only ever opens from a tap, which lets the clip play with sound.
    this.setPopupMuted(false);
    this.popup.showModal();
    this.showPopup(index);
    this.startPopupTicker();
  }

  onPopupClose() {
    this.popupOpen = false;
    this.stopPopupTicker();
    this.popupSlides.forEach((slide) => {
      slide.querySelector('video')?.pause();
      slide.classList.remove('is-paused');
    });
    this.resumeCurrent();
  }

  showPopup(index) {
    const total = this.popupSlides.length;
    if (!total) return;
    this.popupIndex = ((index % total) + total) % total;

    const prev = (this.popupIndex - 1 + total) % total;
    const next = (this.popupIndex + 1) % total;

    this.popupSlides.forEach((slide, i) => {
      const isActive = i === this.popupIndex;
      const isPrev = !isActive && total > 2 && i === prev;
      const isNext = !isActive && total > 1 && i === next;
      slide.classList.toggle('is-active', isActive);
      slide.classList.toggle('is-prev', isPrev);
      slide.classList.toggle('is-near', isPrev || isNext);
      slide.classList.remove('is-paused');

      const video = slide.querySelector('video');
      if (!video) return;

      if ((isActive || isPrev || isNext) && !video.getAttribute('src') && slide.dataset.src) {
        // #t=0.1 makes a resting neighbour show its first frame, not black.
        video.preload = 'metadata';
        video.src = `${slide.dataset.src}#t=0.1`;
      }

      if (isActive) {
        video.muted = this.popupMuted;
        video.preload = 'auto';
        try {
          video.currentTime = 0;
        } catch (error) {
          /* metadata not ready yet - playback still starts from the beginning */
        }
        video.play().catch(() => {
          // Sound was refused (e.g. iOS low-power mode); play silently instead.
          this.setPopupMuted(true);
          video.play().catch(() => slide.classList.add('is-paused'));
        });
      } else {
        video.pause();
        try {
          if (video.currentTime > 0.1) video.currentTime = 0.1;
        } catch (error) {
          /* nothing loaded to rewind */
        }
      }
    });

    this.popupShops.forEach((shop) => {
      const isActive = Number(shop.dataset.index) === this.popupIndex;
      shop.hidden = !isActive;
      if (isActive) shop.scrollLeft = 0;
    });

    this.setPopupProgress(0);
  }

  togglePopupPlayback() {
    const slide = this.popupSlides[this.popupIndex];
    const video = slide?.querySelector('video');
    if (!video) return;

    if (video.paused) video.play().catch(() => {});
    else video.pause();
    slide.classList.toggle('is-paused', !video.paused);
  }

  setPopupMuted(muted) {
    this.popupMuted = muted;
    this.popup.classList.toggle('is-muted', muted);

    const video = this.popupSlides[this.popupIndex]?.querySelector('video');
    if (video && this.popupOpen) video.muted = muted;

    this.popup.querySelectorAll('[data-popup-sound]').forEach((button) => {
      button.setAttribute('aria-label', muted ? button.dataset.labelUnmute : button.dataset.labelMute);
    });
  }

  startPopupTicker() {
    this.stopPopupTicker();
    const tick = () => {
      this.popupTickerId = requestAnimationFrame(tick);
      const video = this.popupSlides[this.popupIndex]?.querySelector('video');
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        this.setPopupProgress(video.currentTime / video.duration);
      }
    };
    this.popupTickerId = requestAnimationFrame(tick);
  }

  stopPopupTicker() {
    if (this.popupTickerId) cancelAnimationFrame(this.popupTickerId);
    this.popupTickerId = null;
  }

  setPopupProgress(ratio) {
    const bar = this.popupSlides[this.popupIndex]?.querySelector('[data-popup-progress]');
    if (!bar) return;
    bar.style.width = `${Math.min(Math.max(ratio, 0), 1) * 100}%`;
  }
}

customElements.define('video-showcase', VideoShowcase);
