// Only object URLs created from this page's selected or persisted Blob are playable.
const sources = new Set<string>();

export function createDesktopVideoFileSource(blob: Blob): string {
    const source = URL.createObjectURL(blob);
    sources.add(source);
    return source;
}

export function revokeDesktopVideoFileSource(source: string | null) {
    if (source && sources.delete(source)) URL.revokeObjectURL(source);
}

export const isDesktopVideoFileSource = (value: unknown): value is string =>
    typeof value === 'string' && sources.has(value);
