/**
 * Drag and swipe for every carousel, with a mouse and with a finger.
 *
 * Two kinds of carousel need two helpers:
 *
 *   zinaraSwipe(element, { onSwipe })
 *     One slide shown at a time (hero banner, announcement strip, product
 *     gallery, lightbox). A horizontal drag - mouse or finger - past a
 *     threshold calls onSwipe(1) for next or onSwipe(-1) for previous. The
 *     element gets `touch-action: pan-y pinch-zoom`, so a finger moving up or
 *     down still scrolls the page and two fingers still zoom, and a gesture
 *     that starts mostly vertical is left to the page altogether.
 *
 *   zinaraDragScroll(track, { settle })
 *     A natively scrolling row of cards (product carousels, the Instagram row).
 *     Touch and trackpads already scroll it; this gives a mouse the same drag.
 *     On release the row glides to the nearest card (or `settle()` decides).
 *
 * Both swallow the click that ends a real drag, so letting go over a card or a
 * banner button does not also open it, and stop the browser dragging images
 * and links around as ghost pictures.
 *
 * Loaded in <head> so that it is in place before any section script runs.
 */
(() => {
  /** Swallows the click that the end of a drag produces. */
  function clickGuard(element) {
    let armed = false;
    element.addEventListener(
      'click',
      (event) => {
        if (!armed) return;
        armed = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    element.addEventListener('dragstart', (event) => event.preventDefault());
    return () => {
      armed = true;
      // A drag that ends outside the element produces no click to eat.
      setTimeout(() => {
        armed = false;
      }, 0);
    };
  }

  window.zinaraSwipe = function zinaraSwipe(element, { onSwipe, threshold = 40, ignore } = {}) {
    if (!element || element.dataset.swipeBound) return;
    element.dataset.swipeBound = 'true';
    element.style.touchAction = 'pan-y pinch-zoom';
    const swallowClick = clickGuard(element);

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let swiping = false;

    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (ignore && event.target.closest(ignore)) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      swiping = false;
    });

    element.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId || swiping) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      // Mostly vertical: a page scroll, not ours.
      if (Math.abs(dy) > Math.abs(dx)) {
        pointerId = null;
        return;
      }
      swiping = true;
      element.setPointerCapture?.(pointerId);
      element.style.userSelect = 'none';
    });

    const end = (event, cancelled) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      element.style.userSelect = '';
      if (!swiping) return;
      swiping = false;
      swallowClick();
      const dx = event.clientX - startX;
      if (!cancelled && Math.abs(dx) >= threshold) onSwipe(dx < 0 ? 1 : -1);
    };
    element.addEventListener('pointerup', (event) => end(event, false));
    element.addEventListener('pointercancel', (event) => end(event, true));
  };

  /** Where a row should come to rest: on the nearest card. */
  function nearestCard(track) {
    const step = window.carouselScroll?.step(track) || 0;
    const max = track.scrollWidth - track.clientWidth;
    if (step <= 0) return Math.min(Math.max(track.scrollLeft, 0), max);
    return Math.min(Math.round(track.scrollLeft / step) * step, max);
  }

  window.zinaraDragScroll = function zinaraDragScroll(track, { settle } = {}) {
    if (!track || track.dataset.dragBound) return;
    track.dataset.dragBound = 'true';
    const swallowClick = clickGuard(track);

    let pointerId = null;
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    track.addEventListener('pointerdown', (event) => {
      // Touch and pens scroll the row natively.
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      if (track.scrollWidth <= track.clientWidth + 1) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startLeft = track.scrollLeft;
      moved = false;
    });

    track.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 5) return;
        moved = true;
        if (track.carouselTween) {
          cancelAnimationFrame(track.carouselTween);
          track.carouselTween = null;
          track.classList.remove('is-scrolling');
        }
        track.setPointerCapture(pointerId);
        track.classList.add('is-dragging');
      }
      track.scrollLeft = startLeft - dx;
    });

    const release = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (!moved) return;
      swallowClick();
      if (settle) {
        settle();
      } else if (window.carouselScroll) {
        // The glide sets is-scrolling first, which keeps snapping off once
        // is-dragging comes away.
        window.carouselScroll.to(track, nearestCard(track));
      } else {
        track.scrollTo({ left: nearestCard(track), behavior: 'smooth' });
      }
      track.classList.remove('is-dragging');
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
  };
})();
