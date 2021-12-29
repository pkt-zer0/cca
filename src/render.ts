import { Card, CellIndex, GameState, indexToCoord } from './game';
import { addVec, scaleVec, v2, Vector2 } from './util';
import { cloneDeep } from 'lodash';

export interface Scene {
    cards: UICard[];
    energy: number;
    energyChange: number;
    energyChangeOpacity: number;
    path: CellIndex[];
    /** Contains the path suggestion to display. Set to undefined if hidden. */
    suggestedPath: CellIndex[] | undefined;
}

export interface UICard {
    card: Card;
    position: Vector2;
    /** Can be animated between 0 and 1 */
    highlight: number;
}

const CANVAS_SIZE = v2(300, 400);
export const CELL_SIZE = 100;
const SELECTED_PATH_COLOR = 'rgba(255, 0, 0, 0.5)';
const SUGGESTED_PATH_COLOR = 'rgba(0,128,255,0.5)';

let ctx: CanvasRenderingContext2D;
export function initRenderer(context: CanvasRenderingContext2D) {
    ctx = context;
}
export function initScene(gameState: GameState): void {
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
    scene = {
        cards,
        energy: gameState.energy,
        energyChange: 0,
        energyChangeOpacity: 0,
        path: cloneDeep(gameState.path),
        suggestedPath: undefined,
    };
}

export let scene: Scene;

let needsRender = true;
export function invalidate() {
    needsRender = true;
}

export function render() {
    if (!needsRender) {
        return;
    }

    ctx.save();

    ctx.clearRect(0, 0, CANVAS_SIZE.x, CANVAS_SIZE.y);

    // Draw grid
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2; // With 1-width, this looks different on rerenders
    ctx.beginPath();
    ctx.moveTo(100, 0);
    ctx.lineTo(100, 300);
    ctx.moveTo(200, 0);
    ctx.lineTo(200, 300);
    ctx.moveTo(0, 100);
    ctx.lineTo(300, 100);
    ctx.moveTo(0, 200);
    ctx.lineTo(300, 200);
    ctx.stroke();

    drawStats(ctx, [
        'Energy: ' + scene.energy,
    ]);
    drawEnergyChange(ctx);

    for (const card of scene.cards) {
        drawCard(ctx, card);
    }
    drawPath(ctx, scene.path, SELECTED_PATH_COLOR);
    if (scene.suggestedPath) {
        drawPath(ctx, scene.suggestedPath, SUGGESTED_PATH_COLOR);
    }

    ctx.restore();
    needsRender = false;
}

function drawPath(ctx: CanvasRenderingContext2D, path: CellIndex[], color: string) {
    if (!path.length) {
        return;
    }

    const positions = path.map(idx => {
        const cellCoord = indexToCoord(idx);
        const scaled = scaleVec(cellCoord, CELL_SIZE);
        return addVec(scaled, v2(CELL_SIZE / 2, CELL_SIZE / 2));
    });

    ctx.save();

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;

    const firstPos = positions[0];
    const radius = 10;
    ctx.beginPath();
    ctx.ellipse(firstPos.x, firstPos.y, radius, radius, 0, 0, 2* Math.PI);
    ctx.fill();

    ctx.beginPath();
    for (const position of positions) {
        ctx.lineTo(position.x, position.y);
    }
    ctx.stroke();

    ctx.restore();
}

function drawStats(ctx: CanvasRenderingContext2D, stats: string[]) {
    ctx.save();

    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    let y = 300;
    for (const line of stats) {
        ctx.fillText(line, 0, y);
        y += 16;
    }

    ctx.restore();
}

function drawEnergyChange(ctx: CanvasRenderingContext2D) {
    ctx.save();

    ctx.fillStyle = `rgba(255, 255, 255, ${scene.energyChangeOpacity})`;
    ctx.font = '32px sans-serif';
    ctx.textBaseline = 'top';
    const sign = scene.energyChange > 0 ? '+' : '';
    const text = `${sign}${scene.energyChange.toFixed(0)} E`;
    ctx.fillText(text, 100, 300);

    ctx.restore();
}

function drawCard(ctx: CanvasRenderingContext2D, el: UICard) {
    ctx.save();

    const origin = el.position;
    ctx.fillStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillRect(origin.x, origin.y, 80, 80);
    if (el.highlight) {
        const rgb = `150, 150, 150`;
        ctx.strokeStyle = `rgba(${rgb}, ${el.highlight})`;
        ctx.strokeRect(origin.x, origin.y, 80, 80);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('' + el.card.cost, origin.x, origin.y);

    ctx.restore();
}
