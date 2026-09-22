/* Instagram tiles that carry a clip play it muted, on loop, and only while the
   tile is on screen - so a phone never decodes four videos at once. Nothing
   downloads until the tile is close, because the markup ships `preload="none"`. */
(() => {
  const SELECTOR = '.instagram-feed_wrapper_grid_item_video';

  const start = (video) => {
    if (video.preload === 'none') video.preload = 'auto';
    // Autoplay is only permitted while muted; re-assert it in case a script
    // elsewhere unmuted the element.
    video.muted = true;
    const played = video.play();
    if (played?.catch) played.catch(() => {});
  };

  const stop = (video) => {
    if (!video.paused) video.pause();
  };

  const init = () => {
    const videos = Array.from(document.querySelectorAll(SELECTOR));
    if (!videos.length) return;

    videos.forEach((video) => {
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.addEventListener('loadeddata', () => video.classList.add('is-ready'), { once: true });
    });

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    if (!('IntersectionObserver' in window)) {
      videos.forEach(start);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) start(entry.target);
          else stop(entry.target);
        });
      },
      { threshold: 0.4 },
    );

    videos.forEach((video) => observer.observe(video));

    // A backgrounded tab should not keep decoding.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) videos.forEach(stop);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // The theme editor re-renders the section on every change.
  document.addEventListener('shopify:section:load', init);
})();
