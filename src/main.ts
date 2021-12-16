import { endTurn, EventType, GameEvent, GameState, initGame, next } from './game';
import { clamp, cloneDeep, last, times } from 'lodash';
import { addVec, Rectangle, scaleVec, subVec, v2, Vector2 } from './util';
import { CELL_SIZE, init as initRenderer, initScene, render, Scene, scene } from './render';
import {
    animateEnergyChange,
    animateHighlight,
    animateParallel,
    Animation,
    clearPreviewAnims,
    initAnims,
    scheduleAnims,
    setTurbo,
    undoLastAnim,
} from './anim';

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
    };
}

let committedState: GameState;
const previewStack: GameState[] = [];

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
    undoLastAnim();
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
    scheduleAnims(...getAnimations(nextStep.events));
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

            render();
        }
    }

    canvas.addEventListener('mousedown', e => {
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
        clearPreviewAnims();
        // TODO: Entirely different animation logic needed here
        updateScene(committedState);
        render();
    });
    $<HTMLButtonElement>('#undo')!.addEventListener('click', () => {
        undo();
        render();
    });

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
    initAnims();
}

document.addEventListener('DOMContentLoaded', init);
