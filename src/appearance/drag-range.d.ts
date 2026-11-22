export function paintRangeValue(input: HTMLInputElement, value: number): number;
export function bindRangeDrag(input: HTMLInputElement, preview: (value: number) => void, commit: (value: number) => void, cancel: () => void): () => void;
