document.querySelectorAll('.faq_wrapper_list_item').forEach((details) => {
  const answer = details.querySelector('.faq_wrapper_list_item_answer');
  const summary = details.querySelector('.faq_wrapper_list_item_summary');
  if (!answer || !summary || !window.gsap) return;

  summary.addEventListener('click', (event) => {
    event.preventDefault();
    const isOpen = details.hasAttribute('open');

    if (isOpen) {
      gsap.to(answer, {
        height: 0,
        paddingTop: 0,
        duration: 0.3,
        ease: 'power1.inOut',
        onComplete: () => details.removeAttribute('open'),
      });
      return;
    }

    document
      .querySelectorAll(`details[name="${details.getAttribute('name')}"][open]`)
      .forEach((openItem) => {
        if (openItem === details) return;
        const openAnswer = openItem.querySelector('.faq_wrapper_list_item_answer');
        gsap.to(openAnswer, {
          height: 0,
          paddingTop: 0,
          duration: 0.25,
          ease: 'power1.inOut',
          onComplete: () => openItem.removeAttribute('open'),
        });
      });

    details.setAttribute('open', '');
    const targetHeight = answer.scrollHeight;
    gsap.fromTo(
      answer,
      { height: 0, paddingTop: 0 },
      {
        height: targetHeight,
        paddingTop: 12,
        duration: 0.35,
        ease: 'power1.out',
        onComplete: () => gsap.set(answer, { height: 'auto' }),
      },
    );
  });
});
