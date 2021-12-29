import { advance, commit, getCurrentPath, showHint, undo } from './main';
import { setTurbo } from './anim';
import { hitTestCells, hitTestCellsSwipe } from './hittest';

/** Holds references to all UI elements in the DOM. Must be initialized after document load. */
class UIElements {
    constructor(
        public readonly canvas: HTMLCanvasElement,
        public readonly commitButton: HTMLButtonElement,
        public readonly undoButton: HTMLButtonElement,
        public readonly hintButton: HTMLButtonElement,
        public readonly turboButton: HTMLInputElement,
    ) {}

    static init(): UIElements {
        return new UIElements(
            $<HTMLCanvasElement>('#screen')!,
            $<HTMLButtonElement>('#commit')!,
            $<HTMLButtonElement>('#undo')!,
            $<HTMLButtonElement>('#hint')!,
            $<HTMLInputElement>('#turbo')!,
        );
    }
}

const $ = document.querySelector.bind(document);
const TURBO_KEY = 't';

let elements: UIElements;
let inputsEnabled = false;
let lastSwipedCell = -1;
let _canvasOrigin: DOMRect | null = null;

export function initInputs() {
    elements = UIElements.init();
    document.addEventListener('mouseup', () => {
        elements.canvas.removeEventListener('mousemove', handleMove);
    });

    // Support toggled and hold-to-enable turbo mode
    elements.turboButton.addEventListener('change', () => {
        setTurbo(elements.turboButton.checked);
    });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Invalidate cached origin on resize/scroll
    window.addEventListener('resize', () => { _canvasOrigin = null; });
    document.addEventListener('scroll', () => { _canvasOrigin = null; });

    // Start enabled by default
    toggleInput(true);
}

/** Enables or disables input, depending on the parameter. */
export function toggleInput(enabled: boolean): void {
    if (inputsEnabled === enabled) {
        // Already in desired state
        return;
    }

    inputsEnabled = enabled;

    const { canvas, commitButton, undoButton, hintButton } = elements;
    if (enabled) {

        canvas.addEventListener('mousedown', handleMousedown);
        commitButton.addEventListener('click', commit);
        undoButton.addEventListener('click', undo);
        hintButton.addEventListener('click', showHint);

        lastSwipedCell = -1;
    } else {
        canvas.removeEventListener('mousedown', handleMousedown);
        canvas.removeEventListener('mousemove', handleMove);
        commitButton.removeEventListener('click', commit);
        undoButton.removeEventListener('click', undo);
        hintButton.removeEventListener('click', showHint);
    }
}

function handleKeyDown(e: KeyboardEvent) {
    if (e.repeat) {
        return;
    }
    if (e.key !== TURBO_KEY) {
        return;
    }
    setTurbo(true);
    elements.turboButton.checked = true;
}
function handleKeyUp(e: KeyboardEvent) {
    if (e.key !== TURBO_KEY) {
        return;
    }
    setTurbo(false);
    elements.turboButton.checked = false;
}

/** Track updates to bounding rectangle of canvas, only updated if needed */
function getCanvasOrigin(): DOMRect {
    if (!_canvasOrigin) {
        _canvasOrigin = elements.canvas.getBoundingClientRect();
    }
    return _canvasOrigin;
}

// NOTE: With fast movements, this can skip over a cell. Checking intersection for a line from the previous position would help.
function handleMove(e: MouseEvent) {
    const origin = getCanvasOrigin();
    const relative = {
        x: e.clientX - origin.x,
        y: e.clientY - origin.y,
    };
    const cell = hitTestCellsSwipe(relative);
    // New cell selected
    if (cell !== lastSwipedCell && cell !== -1) {
        lastSwipedCell = cell;

        // TODO: This should be moved to the main game loop
        const cellIndex = cell;
        const currentPath = getCurrentPath();

        if (currentPath.length > 1 && currentPath[currentPath.length - 2] === cellIndex) {
            // Moved back to next-to-last cell in path, revert one step
            undo();
        } else {
            // Selected card not in path, try moving forward with it
            const invalidMove = advance(cellIndex);
            if (invalidMove) {
                return;
            }
        }
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

    // TODO: This should be moved to the main game loop
    // Get current path to check if it's already selected
    const currentPath = getCurrentPath();
    const indexInPath = currentPath.indexOf(cellIndex);

    if (indexInPath === -1) {
        // Selected card not in path, try moving forward with it
        const invalidMove = advance(cellIndex);
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
    elements.canvas.addEventListener('mousemove', handleMove);
    lastSwipedCell = cellIndex;
}
