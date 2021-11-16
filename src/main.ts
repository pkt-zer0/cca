import { Card, GameState, indexToCoord, initGame, next } from './game';
import { clamp, cloneDeep, last } from 'lodash';
import { addVec, scaleVec, v2, Vector2 } from './util';

interface Scene {
    cards: UICard[];
    // TODO: For simplicity, just copy the entire game state?
    energy: number;
    path: number[];
}
interface UICard {
    card: Card;
    position: Vector2;
    isHighlighted: boolean;
}

const CANVAS_SIZE = v2(300, 400);
const CELL_SIZE = 100;

const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);
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
            isHighlighted: false,
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
let scene: Scene;

function updateScene(nextStep: GameState) {
    nextStep.board.forEach((card, index) => {
        // Highlight cards on the path
        scene.cards[index].isHighlighted = nextStep.path.includes(index);
    });
    scene.energy = nextStep.energy;
    scene.path = cloneDeep(nextStep.path);
}

function init() {
    canvas = $<HTMLCanvasElement>('#screen')!;
    const commit = $<HTMLButtonElement>('#commit')!;
    const undo = $<HTMLButtonElement>('#undo')!;
    const ctx = canvas.getContext('2d')!;

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
        const nextStep = next(latestState, cellIndex);
        if (nextStep instanceof Error) {
            console.log(nextStep.message);
            return;
        }

        previewStack.push(nextStep);
        updateScene(nextStep);

        render(ctx);

    });
    commit.addEventListener('click', () => {
        if (!previewStack.length) {
            return;
        }
        committedState = last(previewStack)!;
        previewStack.length = 0;
    });
    undo.addEventListener('click', () => {
        previewStack.pop();
        const latestState = previewStack.length ? last(previewStack)! : committedState;
        updateScene(latestState);
        render(ctx);
    });

    const gameState = initGame();
    scene = initView(gameState);
    committedState = gameState;

    render(ctx);
}

function render(ctx: CanvasRenderingContext2D) {
    ctx.save();

    ctx.clearRect(0,0, CANVAS_SIZE.x, CANVAS_SIZE.y);

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
        "Energy: " + scene.energy,
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
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.fillRect(origin.x, origin.y, 80, 80);
    if (el.isHighlighted) {
        ctx.strokeRect(origin.x, origin.y, 80, 80);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('' + el.card.cost, origin.x, origin.y);

    ctx.restore();
}

document.addEventListener('DOMContentLoaded', init);
