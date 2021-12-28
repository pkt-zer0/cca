import { endTurn, EventType, GameEvent, GameState, initGame, next } from './game';
import { clamp, cloneDeep, flatMap, last, times } from 'lodash';
import { addVec, Rectangle, scaleVec, subVec, v2, Vector2 } from './util';
import { CELL_SIZE, init as initRenderer, initScene, invalidate, render, Scene, scene } from './render';
import {
    animateEnergyChange,
    animateHighlight,
    animateParallel,
    Animation,
    scheduleAnimation,
    setTurbo,
    updateAnimations,
} from './anim';
import { enumerateAll } from './ai';

const $ = document.querySelector.bind(document);

let canvas: HTMLCanvasElement;

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
        suggestedPath: undefined,
    };
}

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

function undo() {
    previewStack.pop();
    desiredSteps.pop();
    checkForAnimation = true;
    const latestState = previewStack.length ? last(previewStack)! : committedState;
    updateScene(latestState);
}

function commit() {
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

function advance(state: GameState, inputCellIndex: number): boolean {
    const nextStep = next(state, inputCellIndex);
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

function showHint() {
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

    // Track updates to bounding rectangle of canvas, only update if needed
    let _canvasOrigin: DOMRect | null = null;
    function getCanvasOrigin() {
        if (!_canvasOrigin) {
            _canvasOrigin = canvas.getBoundingClientRect();
        }
        return _canvasOrigin;
    }
    // Invalidate cached origin on resize/scroll
    window.addEventListener('resize', () => { _canvasOrigin = null; });
    document.addEventListener('scroll', () => { _canvasOrigin = null; });

    let lastSwipedCell = -1;
    // NOTE: With fast movements, this can skip over a cell. Checking intersection for a line from the previous position would help.
    function handleMove(e: MouseEvent) {
        // FIXME: Check perf
        const origin = getCanvasOrigin();
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

            invalidate();
        }
    }
    function handleMousedown(e: MouseEvent) {
        const origin = getCanvasOrigin();
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
        } else {
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

        invalidate();
    }

    canvas.addEventListener('mousedown', handleMousedown);
    document.addEventListener('mouseup', () => {
        canvas.removeEventListener('mousemove', handleMove);
    });

    $<HTMLButtonElement>('#commit')!.addEventListener('click', commit);
    $<HTMLButtonElement>('#undo')!.addEventListener('click', undo);
    $<HTMLButtonElement>('#hint')!.addEventListener('click', showHint);

    // Support toggled and hold-to-enable turbo mode
    const turboButton = $<HTMLInputElement>('#turbo')!;
    turboButton.addEventListener('change', () => {
        setTurbo(turboButton.checked);
    });
    const TURBO_KEY = 't';
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.repeat) { return; }
        if (e.key !== TURBO_KEY) { return; }
        setTurbo(true);
        turboButton.checked = true;
    });
    document.addEventListener('keyup', (e: KeyboardEvent) => {
        if (e.key !== TURBO_KEY) { return; }
        setTurbo(false);
        turboButton.checked = false;
    });

    const gameState = initGame();
    committedState = gameState;
    initScene(initView(gameState));

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
