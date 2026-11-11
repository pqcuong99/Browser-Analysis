import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * Đếm từ 0 lên `target` trong `duration` ms (easeOutCubic). Chạy lại khi `key` đổi (vd scanId).
 * Trả { value, done }. Người dùng bật "giảm chuyển động" thì nhảy thẳng tới đích.
 */
export function useCountUp(target, { duration = 1500, key } = {}) {
  const reduce = useReducedMotion();
  const [state, setState] = useState({ value: reduce ? target : 0, done: !!reduce });
  const frame = useRef(0);

  useEffect(() => {
    if (reduce) {
      setState({ value: target, done: true });
      return undefined;
    }
    setState({ value: 0, done: false });
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const value = target * easeOutCubic(t);
      if (t < 1) {
        setState({ value, done: false });
        frame.current = requestAnimationFrame(tick);
      } else {
        setState({ value: target, done: true });
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration, key, reduce]);

  return state;
}
