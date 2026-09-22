/**
 * One horizontal scroll animation, shared by every carousel on the page so they
 * all travel on the same curve.
 *
 * Deliberately not gsap.to({scrollLeft}) or scrollTo({behavior:'smooth'}): both
 * write scrollLeft once per frame, and `scroll-snap-type: mandatory` re-snaps
 * after every write, which collapses the whole animation into a single jump.
 * Snapping is suspended for the duration instead and the easing run explicitly.
 */
window.carouselScroll = {
  duration: 450,

  easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  },

  /* Distance between two cards, so a move always lands on a snap point. */
  step(track) {
    const items = track.children;
    if (items.length < 2) return 0;
    const first = items[0].getBoundingClientRect();
    const second = items[1].getBoundingClientRect();
    return Math.max(0, second.left - first.left);
  },

  to(track, left) {
    const start = track.scrollLeft;
    const distance = left - start;
    if (Math.abs(distance) < 1) return;

    if (track.carouselTween) cancelAnimationFrame(track.carouselTween);

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      track.scrollLeft = left;
      return;
    }

    track.classList.add('is-scrolling');

    // Anchor to the first frame's own timestamp. rAF can hand back a timestamp
    // from before this call, which would make the first step negative and kick
    // the track backwards before it sets off.
    let startedAt = null;

    const frame = (now) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / this.duration));
      track.scrollLeft = start + distance * this.easeOutCubic(progress);

      if (progress < 1) {
        track.carouselTween = requestAnimationFrame(frame);
      } else {
        track.carouselTween = null;
        track.classList.remove('is-scrolling');
      }
    };

    track.carouselTween = requestAnimationFrame(frame);
  },
};
