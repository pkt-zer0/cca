export interface Vector2 {
    x: number;
    y: number;
}

export function v2(x: number, y: number): Vector2 {
    return { x, y };
}
export function addVec(l: Vector2, r: Vector2): Vector2 {
    return v2(l.x + r.x, l.y + r.y);
}
export function subVec(l: Vector2, r: Vector2): Vector2 {
    return v2(l.x - r.x, l.y - r.y);
}
export function scaleVec(v: Vector2, s: number): Vector2 {
    return v2(v.x * s, v.y * s);
}
