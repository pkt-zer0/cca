import { Card, endTurn, EventType, GameEvent, GameState, initGame, next } from './game';
import { clamp, cloneDeep, last, times } from 'lodash';
import { addVec, Rectangle, scaleVec, subVec, v2, Vector2 } from './util';
import { CELL_SIZE, init as initRenderer, render } from './render';

export interface Scene {
    cards: UICard[];
    // TODO: For simplicity, just copy the entire game state?
    energy: number;
    energyChange: number;
    energyChangeOpacity: number;
    path: number[];
}
export interface UICard {
    card: Card;
    position: Vector2;
    /** Can be animated between 0 and 1 */
    highlight: number;
}
interface Animation {
    /** Called on each frame of an animation. Return true to indicate the animation has finished. */
    (timestamp: DOMHighResTimeStamp): boolean;
}

const $ = document.querySelector.bind(document);

let canvas: HTMLCanvasElement;

const animations: Animation[] = [];
let currentAnimation: any;

const previewAnimations: Animation[] = []; // Animations for each step of the current turn
let animatedUntil = 0; // Last step for which animations have finished
let currentlyAnimating = -1; // Index of currently running animation

/** Global multiplier on animation speed. */
let animationSpeed = 1;
let turboMode = false;

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

function animateParallel(anims: Animation[]): Animation {
    return function update(timestamp: DOMHighResTimeStamp) {
        let done = true;
        for (const animation of anims) {
            done = animation(timestamp) && done;
        }
        return done;
    };
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

function animateEnergyChange(amount: number) {
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
        energyChange: 0,
        energyChangeOpacity: 0,
        path: cloneDeep(gameState.path),
    };
}

let committedState: GameState;
const previewStack: GameState[] = [];
export let scene: Scene; // TODO Have a more sensible way to share with with render.ts

// TODO Distinct solution for undo animations
/** Collect animations for the current step */
function getAnimations(events: GameEvent[]): Animation[] {
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

    return newAnimations.length ? [animateParallel(newAnimations)] : [];
}

function updateScene(nextStep: GameState) {
    scene.energy = nextStep.energy;
    scene.path = cloneDeep(nextStep.path);
}

function undo() {
    previewStack.pop();
    // Cancel animations not yet played
    if (previewAnimations.length > currentlyAnimating) {
        previewAnimations.pop();
    }
    const latestState = previewStack.length ? last(previewStack)! : committedState;
    // FIXME: Add undo animations for the reverted step
    updateScene(latestState);
}

function advance(state: GameState, inputCellIndex: number): boolean {
    const nextStep = next(state, inputCellIndex);
    if (nextStep instanceof Error) {
        console.log(nextStep.message);
        return true;
    }

    previewStack.push(nextStep.state);
    previewAnimations.push(...getAnimations(nextStep.events));
    updateScene(nextStep.state);
    return false;
}

/** Returns the index of cell (full-size) at the given point, or -1 if there's no hit. */
function hitTestCells(point: Vector2): number {
    if (point.x > 300 || point.y > 300) {
        return -1; // Outside input region
    }

    const xIndex = clamp(Math.floor(point.x / CELL_SIZE), 0, 2);
    const yIndex = clamp(Math.floor(point.y / CELL_SIZE), 0, 2);
    return yIndex * 3 + xIndex;
}

function insideRect(point: Vector2, topLeft: Vector2, bottomRight: Vector2) {
    return point.x >= topLeft.x
        && point.x <= bottomRight.x
        && point.y >= topLeft.y
        && point.y <= bottomRight.y;
}

const centerOffset = v2(CELL_SIZE / 2, CELL_SIZE / 2);
const hitOffset = v2(40, 40);
const swipeCellRects: Rectangle[] = times(9, cellIndex => {
    const xOrigin = (cellIndex % 3) * CELL_SIZE;
    const yOrigin = Math.floor(cellIndex / 3) * CELL_SIZE;
    const origin = v2(xOrigin, yOrigin);
    const center = addVec(origin, centerOffset);
    const topLeft = subVec(center, hitOffset);
    const bottomRight = addVec(center, hitOffset);
    return {
        topLeft: topLeft,
        bottomRight: bottomRight,
    };
});
/** Returns the index of cell at the given point when swiping, or -1 if there's no hit.
 *
 *  Uses a smaller hitbox, for easier diagonal swiping.
 */
function hitTestCellsSwipe(point: Vector2): number {
    for (let cellIndex = 0; cellIndex < 9; cellIndex += 1) {
        const { topLeft, bottomRight } = swipeCellRects[cellIndex];
        if (insideRect(point, topLeft, bottomRight)) {
            return cellIndex;
        }
    }
    return -1;
}

function init() {
    canvas = $<HTMLCanvasElement>('#screen')!;
    initRenderer(canvas.getContext('2d')!);

    let lastSwipedCell = -1;
    // NOTE: With fast movements, this can skip over a cell. Checking intersection for a line from the previous position would help.
    function handleMove(e: MouseEvent) {
        // FIXME: Check perf
        // TODO: Cache bounding rect
        const origin = canvas.getBoundingClientRect();
        const relative = {
            x: e.clientX - origin.x,
            y: e.clientY - origin.y,
        };
        const cell = hitTestCellsSwipe(relative);
        // New cell selected
        if (cell !== lastSwipedCell && cell !== -1) {
            lastSwipedCell = cell;

            const cellIndex = cell;
            const latestState = previewStack.length ? last(previewStack)! : committedState;

            const currentPath = latestState.path;
            if (currentPath.length > 1 && currentPath[currentPath.length-2] === cellIndex) {
                // Moved back to next-to-last cell in path, revert one step
                undo();
            } else {
                // Selected card not in path, try moving forward with it
                const invalidMove = advance(latestState, cellIndex);
                if (invalidMove) {
                    return;
                }
            }

            render();
        }
    }

    canvas.addEventListener('mousedown', e => {
        // TODO: Cache this, recalc on change only
        const origin = canvas.getBoundingClientRect();
        const relative = {
            x: e.clientX - origin.x,
            y: e.clientY - origin.y,
        };

        const cellIndex = hitTestCells(relative);
        // Initial click outside board, ignore it
        if (cellIndex === -1) {
            return;
        }

        // Get current path to check if it's already selected
        const latestState = previewStack.length ? last(previewStack)! : committedState;
        const currentPath = latestState.path;
        const indexInPath = currentPath.indexOf(cellIndex);

        if (indexInPath === -1) {
            // Selected card not in path, try moving forward with it
            const invalidMove = advance(latestState, cellIndex);
            if (invalidMove) {
                return;
            }
        }
        else {
            // Clicked already selected card
            const stepsFromLast = currentPath.length - indexInPath - 1;
            // If it's the last card deselect just that one. Otherwise, everything after it.
            const undoCount = stepsFromLast !== 0 ? stepsFromLast : 1;
            for (let i = 0; i < undoCount; i += 1) {
                undo();
            }
        }

        // Enable swiping for successive cards
        canvas.addEventListener('mousemove', handleMove);
        lastSwipedCell = cellIndex;

        render();
    });
    document.addEventListener('mouseup', () => {
        canvas.removeEventListener('mousemove', handleMove);
    });

    $<HTMLButtonElement>('#commit')!.addEventListener('click', () => {
        if (!previewStack.length) {
            return;
        }
        const previous = last(previewStack)!;
        committedState = endTurn(previous);
        previewStack.length = 0;
        animatedUntil = 0;
        currentlyAnimating = -1;
        // TODO: Entirely different animation logic needed here
        updateScene(committedState);
        render();
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
