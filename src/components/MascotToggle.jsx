import { useEffect, useRef, useState } from 'react';
import mascotAsset from '../../resources/videos/animation-transparentv2.webm';
import { Switch } from './ui';
import './MascotToggle.css';

// Timings are aligned with the push frame and duration of the bundled animation.
const PUSH_TRIGGER_MS = 3200;
const ANIMATION_FALLBACK_MS = 6000;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function getInitialReducedMotionPreference() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function MascotToggle({
  checked = false,
  onChange,
  disabled = false,
  reducedMotion = false,
  ariaLabel = ''
}) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationRunId, setAnimationRunId] = useState(0);
  const [hasReachedPushFrame, setHasReachedPushFrame] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getInitialReducedMotionPreference);

  const pushTimerRef = useRef(null);
  const completionTimerRef = useRef(null);
  const deferredSuccessRef = useRef(null);
  const interactionLockRef = useRef(false);
  const shouldReduceMotion = reducedMotion || prefersReducedMotion;

  function completeAnimation() {
    if (!interactionLockRef.current) {
      return;
    }

    window.clearTimeout(pushTimerRef.current);
    window.clearTimeout(completionTimerRef.current);
    pushTimerRef.current = null;
    completionTimerRef.current = null;
    interactionLockRef.current = false;
    setHasReachedPushFrame(false);
    setIsAnimating(false);

    const completeDeferredSuccess = deferredSuccessRef.current;
    deferredSuccessRef.current = null;
    completeDeferredSuccess?.();
  }

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handlePreferenceChange = (event) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', handlePreferenceChange);

    return () => {
      mediaQuery.removeEventListener('change', handlePreferenceChange);
    };
  }, []);

  useEffect(() => {
    if (!shouldReduceMotion || !interactionLockRef.current) {
      return;
    }

    completeAnimation();
  }, [shouldReduceMotion]);

  useEffect(() => (
    () => {
      window.clearTimeout(pushTimerRef.current);
      window.clearTimeout(completionTimerRef.current);
      interactionLockRef.current = false;
      deferredSuccessRef.current?.();
      deferredSuccessRef.current = null;
    }
  ), []);

  async function handleToggle(nextChecked) {
    if (disabled || interactionLockRef.current || isAnimating) {
      return;
    }

    if (!nextChecked || shouldReduceMotion) {
      await onChange?.(nextChecked);
      return;
    }

    // Wait for confirmations and a successful apply before presenting the activation animation.
    interactionLockRef.current = true;
    let result;
    try {
      result = await onChange?.(nextChecked, { deferSuccessNotification: true });
    } catch (_error) {
      interactionLockRef.current = false;
      return;
    }
    if (!result?.ok) {
      interactionLockRef.current = false;
      return;
    }

    deferredSuccessRef.current = typeof result.completeDeferredSuccess === 'function'
      ? result.completeDeferredSuccess
      : null;

    setHasReachedPushFrame(false);
    setAnimationRunId((currentRunId) => currentRunId + 1);
    setIsAnimating(true);

    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      setHasReachedPushFrame(true);
    }, PUSH_TRIGGER_MS);

    completionTimerRef.current = window.setTimeout(completeAnimation, ANIMATION_FALLBACK_MS);
  }

  const visibleChecked = isAnimating ? hasReachedPushFrame : checked;

  return (
    <span className="mascotToggle">
      {isAnimating ? (
        <video
          key={animationRunId}
          className="mascotToggle__mascot"
          src={mascotAsset}
          autoPlay
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
          onEnded={completeAnimation}
          onError={completeAnimation}
        />
      ) : null}

      <Switch
        checked={visibleChecked}
        disabled={disabled || isAnimating}
        onChange={handleToggle}
        ariaLabel={ariaLabel}
        className="mascotToggle__toggle"
      />
    </span>
  );
}

export default MascotToggle;
