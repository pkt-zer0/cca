import { render, scene, UICard } from './render';
import { clamp } from 'lodash';

export interface Animation {
    /** Called on each frame of an animation. Return true to indicate the animation has finished. */
    (timestamp: DOMHighResTimeStamp): boolean;
}

/** Global multiplier on animation speed. */
let animationSpeed = 1;
let turboMode = false;

export function setTurbo(newState: boolean) {
    turboMode = newState;
    animationSpeed = turboMode ? 4 : 1;
}

const animations: Animation[] = [];
let currentAnimation: any;

export const previewAnimations: Animation[] = []; // Animations for each step of the current turn
let animatedUntil = 0; // Last step for which animations have finished
let currentlyAnimating = -1; // Index of currently running animation

/** Runs on each frame, updates animations if needed. */
function runAnimations(timestamp: DOMHighResTimeStamp) {
    if (currentAnimation) {
        // Process current anim
        const done = currentAnimation(timestamp);
        if (done) {
            currentAnimation = undefined;
            animatedUntil += 1;
        }
    } else {
        // TODO: Decouple animation and gaemplay-triggered anim tracking/scheduling
        // We have a new anim to play
        if (previewAnimations.length > animatedUntil) {
            currentlyAnimating += 1;
            currentAnimation = previewAnimations[currentlyAnimating];
        }
        // TODO This only handles the turn-synchronized animations now, not background ones
    }
}

/** Wrapper for animation handling logic so the inner function can early-exit */
export function rafCallback(timestamp: DOMHighResTimeStamp) {
    runAnimations(timestamp);
    render();
    requestAnimationFrame(rafCallback);
}

export function scheduleAnims(...anims: Animation[]) {
    previewAnimations.push(...anims);
}

export function undoLastAnim() {
    if (previewAnimations.length > currentlyAnimating) {
        previewAnimations.pop();
    }
}

// TODO: Remove. This is a hack to keep existing functionality
export function clearPreviewAnims() {
    animatedUntil = 0;
    currentlyAnimating = -1;
}

/** Produces an animation callback from an updater function that works with elapsed time.
 *
 * The returned animation starts running when first invoked, and tracks elapsed time since then.
 */
function animationUpdater(updater: any) {
    let prevTimestamp: number | undefined = undefined;
    let elapsed = 0;

    function update(timestamp: DOMHighResTimeStamp) {
        if (!prevTimestamp) {
            prevTimestamp = timestamp;
        }
        const delta = timestamp - prevTimestamp;
        prevTimestamp = timestamp;
        elapsed += delta * animationSpeed;
        return updater(elapsed);
    }

    return update;
}

export function animateParallel(anims: Animation[]): Animation {
    return function update(timestamp: DOMHighResTimeStamp) {
        let done = true;
        for (const animation of anims) {
            done = animation(timestamp) && done;
        }
        return done;
    };
}

/** Tweens a card's highlight value from 0 to 1 over 500ms. */
export function animateHighlight(card: UICard, reverse: boolean) {
    const duration = 500;
    return animationUpdater((elapsed: DOMHighResTimeStamp) => {
        // Animation over
        if (elapsed >= duration) {
            return true;
        }

        card.highlight = !reverse ?
            clamp(elapsed / duration, 0, 1) :
            clamp(1 - (elapsed / duration), 0, 1);

        return false;
    });
}

export function animateEnergyChange(amount: number) {
    const rampUp = 200;
    const stable = 800;
    const duration = 1600;
    const fadeout = duration - stable;

    return animationUpdater((elapsed: DOMHighResTimeStamp) => {
        // Skipped in turbo mode
        if (turboMode) {
            scene.energyChangeOpacity = 0;
            return true;
        }

        scene.energyChange = amount; // TODO: Only set this once
        // Animation over
        if (elapsed >= duration) {
            scene.energyChangeOpacity = 0;
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
    });
}

export function initAnims() {
    requestAnimationFrame(rafCallback);
}