import { indexToCoord } from './game';
import { scene, UICard } from './main';
import { addVec, scaleVec, v2 } from './util';

const CANVAS_SIZE = v2(300, 400);
export const CELL_SIZE = 100;

let ctx: CanvasRenderingContext2D;
export function init(context: CanvasRenderingContext2D) {
    ctx = context;
}

export function render() {
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

    for (const card of scene.cards) {
        drawCard(ctx, card);
    }
    drawPath(ctx, scene.path);

    ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, path: number[]) {
    const positions = path.map(idx => {
        const cellCoord = indexToCoord(idx);
        const scaled = scaleVec(cellCoord, CELL_SIZE);
        return addVec(scaled, v2(CELL_SIZE / 2, CELL_SIZE / 2));
    });

    ctx.save();

    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 8;
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
