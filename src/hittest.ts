/* Handles hit testing logic against the board cells. Beware of higher than usual concentrations of math. */

import { clamp, times } from 'lodash';

import { addVec, Rectangle, subVec, v2, Vector2 } from './util';
import { CellIndex } from './game';
import { CELL_SIZE } from './render';

function insideRect(point: Vector2, topLeft: Vector2, bottomRight: Vector2) {
    return point.x >= topLeft.x
        && point.x <= bottomRight.x
        && point.y >= topLeft.y
        && point.y <= bottomRight.y;
}

const centerOffset = v2(CELL_SIZE / 2, CELL_SIZE / 2);
const hitOffset = v2(40, 40);
// Precalculate the rectangles used for hit testing when swiping
const swipeCellRects: Rectangle[] = times(9, cellIndex => {
    const xOrigin = (cellIndex % 3) * CELL_SIZE;
    const yOrigin = Math.floor(cellIndex / 3) * CELL_SIZE;
    const origin = v2(xOrigin, yOrigin);
    const center = addVec(origin, centerOffset);
    const topLeft = subVec(center, hitOffset);
    const bottomRight = addVec(center, hitOffset);
    return {
        topLeft,
        bottomRight,
    };
});

/** Returns the index of cell at the given point when swiping, or -1 if there's no hit.
 *
 *  Uses a smaller hitbox, for easier diagonal swiping.
 */
export function hitTestCellsSwipe(point: Vector2): CellIndex | -1 {
    for (let cellIndex = 0; cellIndex < 9; cellIndex += 1) {
        const { topLeft, bottomRight } = swipeCellRects[cellIndex];
        if (insideRect(point, topLeft, bottomRight)) {
            return cellIndex as CellIndex;
        }
    }
    return -1;
}

/** Returns the index of cell (full-size) at the given point, or -1 if there's no hit. */
export function hitTestCells(point: Vector2): CellIndex | -1 {
    if (point.x > 300 || point.y > 300) {
        return -1; // Outside input region
    }

    const xIndex = clamp(Math.floor(point.x / CELL_SIZE), 0, 2);
    const yIndex = clamp(Math.floor(point.y / CELL_SIZE), 0, 2);
    return yIndex * 3 + xIndex as CellIndex;
}
