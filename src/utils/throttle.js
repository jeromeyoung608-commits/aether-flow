// throttle.js — rate limiters used across the grid (resize, scroll, search)

export function throttle(fn, wait = 16) {
  let last = 0;
  let timer = null;
  let lastArgs = null;
  return function throttled(...args) {
    const now = Date.now();
    lastArgs = args;
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, lastArgs);
      }, remaining);
    }
  };
}

export function debounce(fn, wait = 200) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

// Coalesce high-frequency events to one callback per animation frame.
export function rafThrottle(fn) {
  let scheduled = false;
  let lastArgs = null;
  return function (...args) {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn.apply(this, lastArgs);
    });
  };
}
