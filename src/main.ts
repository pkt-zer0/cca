import { Card, EventType, GameEvent, GameState, initGame, next } from './game';
import { clamp, cloneDeep, last } from 'lodash';
import { addVec, scaleVec, v2, Vector2 } from './util';
import { render, init as initRenderer, CELL_SIZE } from './render';

export interface Scene {
    cards: UICard[];
    // TODO: For simplicity, just copy the entire game state?
    energy: number;
    path: number[];
}
export interface UICard {
    card: Card;
    position: Vector2;
    /** Can be animated between 0 and 1 */
    highlight: number;
}

const $ = document.querySelector.bind(document);

let canvas: HTMLCanvasElement;

const animations: any[] = [];
let currentAnimation: any;
/** Global multiplier on animation speed. */
let animationSpeed = 1;
let turboMode = false;

/** Runs on each frame, updates animations if needed. */
function runAnimations(timestamp: DOMHighResTimeStamp) {
    // TODO: Don't run RAF callback if we have no active/pending animations
    if (!currentAnimation && !animations.length) {
        // No pending/running animations, we're done
    }

    if (currentAnimation) {
        // Process current anim
        const done = currentAnimation(timestamp);
        if (done) {
            currentAnimation = undefined;
        }
    } else if (animations.length) {
        // TODO: We should start this already on the current frame, not just the next
        currentAnimation = animations.shift();
    }
}

/** Wrapper for animation handling logic so the inner function can early-exit */
function rafCallback(timestamp: DOMHighResTimeStamp) {
    runAnimations(timestamp);
    render();
    requestAnimationFrame(rafCallback);
}
requestAnimationFrame(rafCallback);

/** Produces an animation callback from an updater function that works with elapsed time.
 *
 * The returned animation starts running when first invoked, and tracks elapsed time since then.
 */
function animationUpdater(updater: any) {
    let start: number | undefined = undefined;
    function update(timestamp: DOMHighResTimeStamp) {
        if (!start) { start = timestamp; }
        const elapsed = timestamp - start;
        // TODO This won't work correctly when changing speed mid-animation
        return updater(elapsed * animationSpeed);
    }
    return update;
}

/** Tweens a card's highlight value from 0 to 1 over 500ms. */
function animateHighlight(card: UICard, reverse: boolean) {
    const duration = 500;
    // TODO: Use an explicit object instead of a func + closure
    return animationUpdater((elapsed: DOMHighResTimeStamp) => {
        // Animation over
        if (elapsed >= duration) { return true; }

        card.highlight = !reverse ?
            clamp(elapsed / duration, 0, 1) :
            clamp(1 - (elapsed / duration), 0, 1);

        return false;
    });
}

function initView(gameState: GameState): Scene {
    let cards = gameState.board.map((c, index) => {
        const xPos = index % 3;
        const yPos = Math.floor(index / 3);
        const cellPos = scaleVec({ x: xPos, y: yPos }, CELL_SIZE);
        const position = addVec(cellPos, v2(10, 10));
        return {
            card: c,
            position,
            highlight: 0,
        };
    });
    return {
        cards,
        energy: gameState.energy,
        path: cloneDeep(gameState.path),
    };
}

let committedState: GameState;
const previewStack: GameState[] = [];
export let scene: Scene; // TODO Have a more sensible way to share with with render.ts

function updateScene(nextStep: GameState, prevStep: GameState, events: GameEvent[]) {
    // Trigger an animation for cards newly added to the path
    for (let event of events) {
        if (event.type === EventType.PathSelection) {
            animations.push(animateHighlight(scene.cards[event.selectedIndex], false));
        }
    }

    nextStep.board.forEach((card, index) => {
        // Highlight cards on the path
        const inPath = nextStep.path.includes(index);
        const wasInPath = prevStep.path.includes(index);
        // TODO This is an animation being reverted, needs a distinct solution
        if (!inPath && wasInPath) {
            // Removed from path
            animations.push(animateHighlight(scene.cards[index], true));
        }
    });
    scene.energy = nextStep.energy;
    scene.path = cloneDeep(nextStep.path);
}

function undo() {
    const prevState = previewStack.pop()!;
    const latestState = previewStack.length ? last(previewStack)! : committedState;
    updateScene(latestState, prevState, []);
}

function init() {
    canvas = $<HTMLCanvasElement>('#screen')!;
    initRenderer(canvas.getContext('2d')!);

    canvas.addEventListener('click', e => {
        // TODO: Cache this, recalc on change only
        const origin = canvas.getBoundingClientRect();
        const relative = {
            x: e.clientX - origin.x,
            y: e.clientY - origin.y,
        };

        if (relative.x > 300 || relative.y > 300) {
            return; // Outside input region
        }
        const xIndex = clamp(Math.floor(relative.x / CELL_SIZE), 0, 2);
        const yIndex = clamp(Math.floor(relative.y / CELL_SIZE), 0, 2);
        const cellIndex = yIndex * 3 + xIndex;

        const latestState = previewStack.length ? last(previewStack)! : committedState;

        const currentPath = latestState.path;
        const indexInPath = currentPath.indexOf(cellIndex);
        if (indexInPath === -1) {
            // Selected card not in path, try moving forward with it
            const nextStep = next(latestState, cellIndex);
            if (nextStep instanceof Error) {
                console.log(nextStep.message);
                return;
            }

            previewStack.push(nextStep.state);
            updateScene(nextStep.state, latestState, nextStep.events);
            render();
        } else {
            // Clicked already selected card, roll back to the step before it
            const undoCount = currentPath.length - indexInPath;
            for (let i = 0; i < undoCount; i++) {
                undo();
            }
            render();
        }

    });
    $<HTMLButtonElement>('#commit')!.addEventListener('click', () => {
        if (!previewStack.length) {
            return;
        }
        committedState = last(previewStack)!;
        previewStack.length = 0;
    });
    $<HTMLButtonElement>('#undo')!.addEventListener('click', () => {
        undo();
        render();
    });
    $<HTMLInputElement>('#turbo')!.addEventListener('change', () => {
        turboMode = !turboMode;
        animationSpeed = turboMode ? 4 : 1;
    });

    const gameState = initGame();
    scene = initView(gameState);
    committedState = gameState;

    render();
}

document.addEventListener('DOMContentLoaded', init);
