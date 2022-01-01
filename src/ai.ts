import { CellIndex, endTurn, GameState, next, validInputs } from './game';

/** Find the optimal path for the given turn, according to a built-in scoring function ({@link evaluate}) */
export function enumerateAll(initState: GameState): CellIndex[] | undefined {
    let bestScore: number = Number.NEGATIVE_INFINITY;
    let bestPath: number[] | undefined = undefined;

    // Performance tracking info
    let pathCount = 0;
    let abandoned = 0;

    function enumerateFrom(start: GameState) {
        // Abandon path if we're already dead
        if (start.energy <= 0) {
            abandoned += 1;
            return;
        }
        // Consider ending the turn here
        if (start.path.length >= 2) {
            const finalTurn = endTurn(start);
            // NOTE: This is a tiny hack since endTurn clears the path in the final turn state
            const score = evaluate(finalTurn, start.path);
            if (score > bestScore) {
                bestScore = score;
                bestPath = start.path;
            }
        }
        const validMoves = validInputs(start);
        if (validMoves.length === 0) {
            return;
        }

        for (const move of validMoves) {
            pathCount += 1;
            const nextState = next(start, move);
            if (!(nextState instanceof Error)) {
                enumerateFrom(nextState.state);
            }
        }
    }

    // Depth-first-search // TODO: non-recursive equivalent?
    const start = performance.now();

    enumerateFrom(initState);

    const end = performance.now();
    const duration = end - start;
    console.debug(`Iterated ${pathCount} paths (abandoned ${abandoned}) in ${duration}ms`);

    return bestPath;
}

/** Assign a numeric score to a state. The higher the number, the more desirable is this outcome. */
function evaluate(state: GameState, path: CellIndex[]): number {
    // Normally, you'd consider various criteria (damage taken, damage given, gold gained), with various weights
    // allowing for different preferences (maximize damage, most cards removed, etc.) The weights can be determined
    // manually, or by a genetic algorithm to select the best weighting from a 1000 randomly generated games.
    return path.length * 0.5 + state.energy;
}
