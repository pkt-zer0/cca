/* Animations are updates to the scene that happen over time. Defining and running animations are both handled here. */

import { invalidate, scene, UICard } from './render';
import { clamp, noop } from 'lodash';

export interface Animation {
    /** Called on each frame to update the scene accordingly. Return true to indicate the animation has finished. */
    (timestamp: DOMHighResTimeStamp): boolean;
}

/** Global multiplier on animation speed. */
let animationSpeed = 1;
let turboMode = false;

/** Toggles turbo mode, where animations are sped up, and certain ones skipped entirely. */
export function setTurbo(newState: boolean) {
    turboMode = newState;
    animationSpeed = turboMode ? 4 : 1;
}

let currentAnimation: Animation | undefined = undefined;

/** Runs on each frame, updates animations if needed. Returns true if no animation is running, false otherwise. */
export function updateAnimations(timestamp: DOMHighResTimeStamp): boolean {
    // NOTE: Only handles one simultaneous animation, because that's all we need. Easy to extend to an array, though.
    let done = true;
    if (currentAnimation) {
        // Process current anim
        done = currentAnimation(timestamp);
        if (done) {
            currentAnimation = undefined;
        }
        invalidate();
    }
    return done;
}

/** Immediately start an animation. */
export function scheduleAnimation(anim: Animation): void {
    if (currentAnimation) {
        // NOTE: Only an error due to the self-imposed single-anim limitation
        throw Error('Already running an animation. This should never happen.');
    }
    currentAnimation = anim;
}

/** Allows defining an animation in terms of elapsed time. Optional callbacks for one-time init / cleanup logic. */
interface AnimationCallbacks {
    init?(): void;
    update(elapsed: number): boolean;
    cleanup?(): void;
}

/** Produces an animation callback from an updater function that works with elapsed time.
 *
 * The returned animation starts running when first invoked, and tracks elapsed time since then.
 */
function animationUpdater(callbacks: AnimationCallbacks): Animation {
    let prevTimestamp: number | undefined = undefined;
    let elapsed = 0;

    const init = callbacks.init ?? noop;
    const updater = callbacks.update;
    const cleanup = callbacks.cleanup ?? noop;

    return function update(timestamp: DOMHighResTimeStamp) {
        if (!prevTimestamp) {
            prevTimestamp = timestamp;
        }
        // Time since previous frame
        const delta = timestamp - prevTimestamp;
        prevTimestamp = timestamp;
        elapsed += delta * animationSpeed;
        if (elapsed === 0) {
            init();
            return false;
        }
        const done = updater(elapsed);
        if (done) {
            cleanup();
        }
        return done;
    };
}

/** Animation combinator: runs the given animations in parallel, until all are finished. */
export function animateParallel(anims: Animation[]): Animation {
    return function update(timestamp: DOMHighResTimeStamp) {
        let done = true;
        for (const animation of anims) {
            done = animation(timestamp) && done;
        }
        return done;
    };
}

export function animateSequence(anims: Animation[]): Animation {
    let current = 0;
    return function update(timestamp: DOMHighResTimeStamp) {
        if (current >= anims.length) {
            return true;
        }
        const animation = anims[current];
        const done = animation(timestamp);
        if (done) {
            current += 1;
        }
        return false;
    };
}

/** Tweens a card's highlight value from 0 to 1 over 500ms. */
export function animateHighlight(card: UICard, reverse: boolean) {
    const duration = 500;
    return animationUpdater({
        update(elapsed: DOMHighResTimeStamp) {
            // Animation over
            if (elapsed >= duration) {
                return true;
            }

            card.highlight = !reverse ?
                clamp(elapsed / duration, 0, 1) :
                clamp(1 - (elapsed / duration), 0, 1);

            return false;
        }
    });
}

/** Show a text popup for energy changes that fades in and out. */
export function animateEnergyChange(amount: number) {
    const rampUp = 200;
    const stable = 800;
    const duration = 1600;
    const fadeout = duration - stable;

    return animationUpdater({
        init() { scene.energyChange = amount; },
        cleanup() { scene.energyChangeOpacity = 0; },
        update(elapsed: DOMHighResTimeStamp) {
            // Skipped in turbo mode, otherwise ends after duration has passed
            if (turboMode || elapsed >= duration) {
                return true;
            }

            // Three phases for the animation: fade in, stay, fade out
            if (elapsed < rampUp) {
                scene.energyChangeOpacity = clamp(elapsed / rampUp, 0, 1);
            } else if (elapsed < stable) {
                scene.energyChangeOpacity = 1;
            } else {
                const fadeoutElapsed = elapsed - stable;
                scene.energyChangeOpacity = clamp(1 - fadeoutElapsed / fadeout, 0, 1);
            }

            return false;
        }
    });
}
