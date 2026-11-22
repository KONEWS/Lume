import { create } from 'zustand';
import { useVideoLayerSettingsStore } from '../../../stores/useVideoLayerSettingsStore';
import { createDesktopVideoFileSource, revokeDesktopVideoFileSource } from './desktopVideoSources';

// The embedded PC page owns a copy of the chosen file. It never receives a native path.
export type DesktopVideoFile = {
    status: 'none' | 'ready' | 'missing';
    name: string | null;
    source: string | null;
    error?: string;
    picked?: boolean;
};
type State = DesktopVideoFile & { busy: boolean; playbackError: boolean };
type SavedVideo = { name: string; blob: Blob };
export const useDesktopVideoFileStore = create<State>(() => ({ status: 'none', name: null, source: null, busy: false, playbackError: false }));

const DATABASE = 'lume-pc-lyrics-local-video';
const STORE = 'files';
const KEY = 'current';
let database: Promise<IDBDatabase> | undefined;
let revision = 0, connections = 0, restored = false;
let cancelPicker: (() => void) | null = null;

function openDatabase(): Promise<IDBDatabase> {
    if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error ?? new Error('Video storage unavailable'));
        request.onblocked = () => reject(new Error('Video storage is busy'));
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); database = undefined; };
            resolve(db);
        };
    }).catch(error => { database = undefined; throw error; });
    return database;
}

async function readVideo(): Promise<SavedVideo | null> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
    });
}

async function saveVideo(video: SavedVideo | null) {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        if (video) store.put(video, KEY);
        else store.delete(KEY);
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('Video storage failed'));
    });
}

function replaceSource(next: DesktopVideoFile) {
    const previous = useDesktopVideoFileStore.getState().source;
    useDesktopVideoFileStore.setState({ ...next, busy: false, playbackError: false });
    if (previous !== next.source) revokeDesktopVideoFileSource(previous);
}

async function restoreVideo() {
    const token = ++revision;
    useDesktopVideoFileStore.setState({ busy: true, error: undefined });
    try {
        const saved = await readVideo();
        if (token !== revision) return;
        restored = true;
        if (!saved) {
            replaceSource({ status: 'none', name: null, source: null, error: undefined, picked: false });
        } else if (typeof saved.name !== 'string' || !(saved.blob instanceof Blob) || !saved.blob.size) {
            replaceSource({ status: 'missing', name: typeof saved.name === 'string' ? saved.name : null,
                source: null, error: 'desktopVisual.videoFileReadFailed', picked: false });
        } else {
            replaceSource({ status: 'ready', name: saved.name, source: createDesktopVideoFileSource(saved.blob), error: undefined, picked: false });
        }
    } catch {
        if (token === revision) replaceSource({ status: 'missing', name: null, source: null,
            error: '无法恢复本地视频，请重新选择文件。', picked: false });
    }
}

export function connectDesktopVideoFile() {
    connections++;
    if (!restored && !useDesktopVideoFileStore.getState().busy) void restoreVideo();
    let connected = true;
    return () => {
        if (!connected) return;
        connected = false;
        connections--;
        // React StrictMode reconnects synchronously; keep that connection's source and restore.
        queueMicrotask(() => {
            if (connections) return;
            cancelPicker?.();
            revision++; restored = false;
            replaceSource({ status: 'none', name: null, source: null, error: undefined, picked: false });
        });
    };
}

async function acceptVideo(file: File, token: number) {
    if (!file.size || !(file.type.startsWith('video/') || /\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi)$/i.test(file.name))) {
        if (token === revision) useDesktopVideoFileStore.setState({ busy: false, error: '请选择非空的视频文件。' });
        return;
    }
    let source: string;
    try { source = createDesktopVideoFileSource(file); }
    catch {
        if (token === revision) useDesktopVideoFileStore.setState({ busy: false, error: 'desktopVisual.videoFileReadFailed' });
        return;
    }
    try {
        // Commit before replacing the previous playable source. A failed save still allows this session to play.
        await saveVideo({ name: file.name, blob: file });
        if (token !== revision) { revokeDesktopVideoFileSource(source); return; }
        restored = true;
        replaceSource({ status: 'ready', name: file.name, source, error: undefined, picked: true });
    } catch {
        if (token !== revision) { revokeDesktopVideoFileSource(source); return; }
        replaceSource({ status: 'ready', name: file.name, source,
            error: '视频可在本次使用，但未能保存。请检查可用存储空间，重启后重新选择。', picked: true });
    }
    useVideoLayerSettingsStore.getState().setVideoLayerEnabled(true);
}

export function selectDesktopVideoFile() {
    if (useDesktopVideoFileStore.getState().busy) return;
    const token = ++revision;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'video/*'; input.hidden = true;
    input.setAttribute('aria-label', '选择本地视频');
    document.body.append(input);
    useDesktopVideoFileStore.setState({ busy: true, error: undefined, playbackError: false });
    let finished = false;
    const finish = (file?: File) => {
        if (finished) return;
        finished = true;
        input.remove(); cancelPicker = null;
        if (token !== revision) return;
        if (file) void acceptVideo(file, token);
        else useDesktopVideoFileStore.setState({ busy: false });
    };
    cancelPicker = () => finish();
    input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
    input.addEventListener('cancel', () => finish(), { once: true });
    try { input.click(); }
    catch { finish(); useDesktopVideoFileStore.setState({ error: '无法打开文件选择器，请重试。' }); }
}

export function clearDesktopVideoFile() {
    cancelPicker?.();
    if (useDesktopVideoFileStore.getState().busy) return;
    const token = ++revision;
    useDesktopVideoFileStore.setState({ busy: true, error: undefined });
    void saveVideo(null).then(() => {
        if (token !== revision) return;
        restored = true;
        replaceSource({ status: 'none', name: null, source: null, error: undefined, picked: false });
        useVideoLayerSettingsStore.getState().setVideoLayerEnabled(false);
    }).catch(() => {
        if (token === revision) useDesktopVideoFileStore.setState({ busy: false, error: '未能清除已保存的视频，请重试。' });
    });
}

export const reportDesktopVideoError = () => useDesktopVideoFileStore.setState({ playbackError: true });
