import { CellIndex, endTurn, EventType, GameEvent, GameState, initGame, next } from './game';
import { cloneDeep, flatMap, last, } from 'lodash';
import { initRenderer, initScene, invalidate, render, scene } from './render';
import {
    animateEnergyChange,
    animateHighlight,
    animateParallel,
    Animation,
    scheduleAnimation,
    updateAnimations,
} from './anim';
import { enumerateAll } from './ai';
import { initInputs } from './input';

const $ = document.querySelector.bind(document);

let canvas: HTMLCanvasElement;

let committedState: GameState;
const previewStack: GameState[] = [];

/** Collect animations for the current step */
function getAnimation(events: GameEvent[]): Animation | undefined {
    const newAnimations = [];
    // Trigger an animation for cards newly added to the path
    for (let event of events) {
        switch (event.type) {
            case EventType.PathSelection:
                newAnimations.push(animateHighlight(scene.cards[event.selectedIndex], false));
                break;
            case EventType.EnergyLoss:
                newAnimations.push(animateEnergyChange(-event.amount));
                break;
        }
    }

    return newAnimations.length ? animateParallel(newAnimations) : undefined;
}

/** Collect undo animations for a step */
function getReverseAnimation(events: GameEvent[]): Animation | undefined {
    const newAnimations = [];
    let totalEnergyLoss = 0;
    for (let event of events) {
        switch (event.type) {
            case EventType.PathSelection:
                newAnimations.push(animateHighlight(scene.cards[event.selectedIndex], true));
                break;
            case EventType.EnergyLoss:
                totalEnergyLoss += event.amount;
                break;
        }
    }
    if (totalEnergyLoss) {
        newAnimations.push(animateEnergyChange(totalEnergyLoss));
    }

    return newAnimations.length ? animateParallel(newAnimations) : undefined;
}

function updateScene(nextStep: GameState) {
    scene.energy = nextStep.energy;
    scene.path = cloneDeep(nextStep.path);
    invalidate();
}

/** Undo the last chosen step. */
export function undo() {
    previewStack.pop();
    desiredSteps.pop();
    checkForAnimation = true;
    const latestState = previewStack.length ? last(previewStack)! : committedState;
    updateScene(latestState);
}

/** Confirm the currently selected steps as final for the current turn. */
export function commit() {
    if (!previewStack.length) {
        return;
    }
    const previous = last(previewStack)!;
    committedState = endTurn(previous);
    previewStack.length = 0;
    // clearPreviewAnims(); // FIXME Set commit flag, only update after anims are done
    // TODO: Entirely different animation logic needed here
    updateScene(committedState);
}

/** Pick the given cell as the next step. Returns true in case it's an invalid move. */
export function advance(inputCellIndex: CellIndex): boolean {
    const latestState = previewStack.length ? last(previewStack)! : committedState;
    const nextStep = next(latestState, inputCellIndex);
    if (nextStep instanceof Error) {
        console.log(nextStep.message);
        return true;
    }

    previewStack.push(nextStep.state);
    // TODO: Merge with previewStack so the two are guaranteed to be in sync
    desiredSteps.push({
        input: inputCellIndex,
        events: nextStep.events,
    });
    checkForAnimation = true;
    updateScene(nextStep.state);
    return false;
}

/** Shows the suggested move for the current turn. */
export function showHint() {
    const suggestedPath = enumerateAll(committedState);
    if (suggestedPath) {
        scene.suggestedPath = suggestedPath;
        invalidate();
        // TODO: This is a hack to bypass the anim system, since it would need multi-anim support to work properly.
        setTimeout(() => {
            scene.suggestedPath = undefined;
            invalidate();
        }, 1500);
    }
}

export function getCurrentPath(): CellIndex[] {
    const latestState = previewStack.length ? last(previewStack)! : committedState;
    return latestState.path;
}

function init() {
    canvas = $<HTMLCanvasElement>('#screen')!;
    initRenderer(canvas.getContext('2d')!);

    const gameState = initGame();
    committedState = gameState;
    initScene(gameState);
    initInputs();

    // Start main loop
    requestAnimationFrame(update);
}

interface AnimationStep {
    input: number; // cell index
    events: GameEvent[];
}

const animatedSteps: AnimationStep[] = [];
const desiredSteps: AnimationStep[] = [];
/** Indicates that we might have some new steps to animate. Cleared when animations have caught up with input. */
let checkForAnimation = false;

/** Returns the number of elements at the start of the arrays that are identical in both. */
function sharedPrefixLength(current: number[], desired: number[]): number {
    let i;
    for (i = 0; i < current.length && i < desired.length; i += 1) {
        if (current[i] !== desired[i]) {
            break;
        }
    }
    return i;
}

/** Gets the next animation to run.
 *
 * Since inputs are decoupled from animations, they each proceed independently. For example, while the animation for
 * the current step is playing, you can undo the last two steps and choose some other path. We handle this by tracking
 * the animations we've played so far ({@link animatedSteps}), and also the path corresponding to the latest inputs
 * ({@link desiredSteps}).
 *
 * Since the path (cell indices) unambiguously determines the animations, we only need to compare those to figure out
 * where the animated state and the desired state diverged. Then, we roll back to the point of divergence, then play
 * the remaining animations to reach the desired state.
 *
 * Currently, we animate one step at a time, whether going backwards or forwards.
 *
 * @example Path difference logic
 *
 * animated: 2137
 * desired : 2157
 * -> rollback 37, animate 57
 */
function scheduleNextAnimation(): void {
    // Find where the animations diverged, i.e. the longest initial substring of the path
    const sharedPrefix = sharedPrefixLength(
        animatedSteps.map(_ => _.input),
        desiredSteps.map(_ => _.input),
    );
    // Already animated, but no longer needed
    const rollback = animatedSteps.slice(sharedPrefix);
    // Not yet animated
    const animate = desiredSteps.slice(sharedPrefix);

    if (rollback.length) {
        // Merge multiple undone steps into a single one
        animatedSteps.length = sharedPrefix;
        const anim = getReverseAnimation(flatMap(rollback, _ => _.events));
        if (anim) {
            scheduleAnimation(anim);
        }
        return;
    }
    if (animate.length) {
        const nextStep = animate[0];
        animatedSteps.push(nextStep);
        const anim = getAnimation(nextStep.events);
        if (anim) {
            scheduleAnimation(anim);
        }
        return;
    }
    // TODO: Handle commit anims

    // The two paths have caught up, no need to calculate their changes until new input comes in
    checkForAnimation = false;

}

/** Main game loop, runs every frame. Coordinates between the various subsystems, where needed. */
function update(timestamp: DOMHighResTimeStamp) {
    // We wait for the current animation (if any) to finish before starting a new one
    const done = updateAnimations(timestamp);
    if (checkForAnimation && done) {
        scheduleNextAnimation();
    }
    render();
    requestAnimationFrame(update);
}

document.addEventListener('DOMContentLoaded', init);
