/* Contains core game logic, independent of rendering, animations, etc. */

import { last, shuffle, times, difference } from 'lodash';
import { v2, Vector2 } from './util';

/** Constrain possible board indexes on the type level. We have 9 cells - no more, no less. */
export type CellIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const ALL_INDEXES: CellIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** List of adjacent cells for each cell. The board layout is the following:
 *
 * 012
 * 345
 * 678
 *
 * */
const pathAdjacentIndexes: Record<CellIndex, CellIndex[]> = {
    0: [1, 3, 4],
    1: [0, 2, 3, 4, 5],
    2: [1, 4, 5],
    3: [0, 1, 4, 6, 7],
    4: [0, 1, 2, 3, 5, 6, 7, 8],
    5: [1, 2, 4, 7, 8],
    6: [3, 4, 7],
    7: [3, 4, 5, 6, 8],
    8: [4, 5, 7],
};

export interface Card {
    cost: number;
}

export interface GameState {
    deck: Card[];
    discard: Card[];
    /** Cards on the board, in a 3x3 grid. */
    board: Card[];
    /** Index of the cards in the currently selected path. */
    path: CellIndex[];
    health: number;
    energy: number;
    gold: number;
}

export enum EventType {
    Unknown,
    EnergyLoss,
    PathSelection
}

export interface EnergyLoss {
    type: EventType.EnergyLoss;
    amount: number;
}
export interface PathSelection {
    type: EventType.PathSelection;
    selectedIndex: number;
}
export type GameEvent = EnergyLoss | PathSelection;

export interface StepResult {
    state: GameState;
    /** Indicates the events leading to the end state. */
    events: GameEvent[];
}

function cloneCards(cards: Card[]): Card[] {
    const length = cards.length;
    const result: Card[] = new Array(length);
    for (let i = 0; i < length; i += 1) {
        const original = cards[i];
        result[i] = {
            cost: original.cost
        };
    }
    return result;
}

/** Creates a deep copy of the given state. */
function cloneState(original: GameState): GameState {
    return {
        energy: original.energy,
        health: original.health,
        gold: original.gold,
        path: [...original.path],
        board: cloneCards(original.board),
        deck: cloneCards(original.deck),
        discard: cloneCards(original.discard),
    };
}

/** Creates a randomly generated starting state. */
export function initGame(): GameState {
    const startingDeck: Card[] = times(15, i => {
        return {
            cost: i % 3,
        };
    });

    const deck = shuffle(startingDeck);
    const board: Card[] = [];
    times(9, () => {
        const drawn = deck.pop()!; // Initial deck size must be greater than 9
        board.push(drawn);
    });

    return {
        deck,
        discard: [],
        board,
        path: [],
        health: 7,
        energy: 7,
        gold: 0,
    };
}

function isAdjacent(startIndex: CellIndex, endIndex: CellIndex) {
    const start = indexToCoord(startIndex);
    const end = indexToCoord(endIndex);
    return end.x >= start.x - 1
        && end.x <= start.x + 1
        && end.y >= start.y - 1
        && end.y <= start.y + 1;
}

/** Returns all inputs that are valid choices in the given state. */
export function validInputs(prev: GameState): CellIndex[] {
    const path = prev.path;
    if (path.length === 0) {
        return ALL_INDEXES;
    }
    const lastStep = path[path.length - 1];
    const adjacents = pathAdjacentIndexes[lastStep];
    return difference(adjacents, path);
}

/** Returns the new game state given the previous one and the current input. */
export function next(prev: GameState, input: CellIndex): StepResult | Error {
    // Copy original state, so we can mutate it and remain a pure function
    const state = cloneState(prev);
    const events: GameEvent[] = [];
    const selectedIndex = input;

    //-- Game logic
    // Check next step validity
    if (state.path.includes(selectedIndex)) {
        return Error('Invalid move, selection already on path.');
    }

    // If already started a path, only allow adjacent cards
    if (state.path.length) {
        const currentPos = last(state.path)!;
        if (!isAdjacent(currentPos, selectedIndex)) {
            return Error('Invalid move, selection must be adjacent to last step.');
        }
    }

    // Add selected card to path
    state.path.push(selectedIndex);
    events.push({ type: EventType.PathSelection, selectedIndex });
    const selectedCard = state.board[selectedIndex];

    // Handle effects of selected card
    state.energy -= selectedCard.cost;
    if (selectedCard.cost) {
        events.push({ type: EventType.EnergyLoss, amount: selectedCard.cost });
    }

    return { state, events };
}

/** Commit the path selected for the turn, trigger any resulting effects. */
export function endTurn(prev: GameState): GameState {
    const state = cloneState(prev);
    state.path = [];

    // NOTE: Discard selected cards, trigger end-of-turn events, etc.
    return state;
}

/** Returns the 2D coordinate pair for a 1D cell index. */
export function indexToCoord(index: CellIndex): Vector2 {
    const x = index % 3;
    const y = Math.floor(index / 3);
    return v2(x,y);
}
