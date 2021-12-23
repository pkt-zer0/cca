import { invalidate, render, scene, UICard } from './render';
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

let currentAnimation: Animation | undefined = undefined;

/** Runs on each frame, updates animations if needed. */
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

export function scheduleAnimation(anim: Animation): void {
    if (currentAnimation) {
        // NOTE: Only an error due to the self-imposed single-anim limitation
        throw Error('Already running an animation. This should never happen.');
    }
    currentAnimation = anim;
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
