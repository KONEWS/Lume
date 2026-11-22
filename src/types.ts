export type Channel = 'stereo' | 'left' | 'right' | 'mono';
export interface Track { localAudioKey?:string; detailKey?:string; addedAt?:number; lastPlayedAt?:number; sampleRate?:number; bitDepth?:number; channels?:number; bytes?: number; quality?: string; hasLyrics?: boolean; playCount?: number; id: string; title: string; artist: string; album: string; folder?: string; duration: number; format: string; artwork: string; source: 'demo' | 'import' | 'phone'; favorite: boolean }
export interface Device { id: string; name: string; platform: string; channel: Channel; volume: number; muted: boolean; enabled: boolean; lastSeen: number; delayMs?: number; profile?: string }
export interface Playback { trackId: string | null; playing: boolean; position: number; updatedAt: number; volume: number; muted: boolean; repeat: 'off' | 'all' | 'one'; shuffle: boolean }
export interface PhoneLibrary {id:string;name:string;platform:string;songs:{id:string;title:string}[]}
export interface Playlist { id: string; name: string; trackIds: string[] }
export interface GuestRoom {status:'joining'|'waiting'|'joined'|'disconnected'|'error';name:string;url:string;error:string}
export interface RoomState { playRecords?:import('./listening').PlayRecord[]; guestRoom?:GuestRoom|null; listeningDays?:Record<string,{starts:number;ms:number}>; playlists?: Playlist[]; phoneLibraries?:PhoneLibrary[];sourceStatus?:string; calibrating?:boolean; pending?:{id:string;platform:string;name?:string;until:number}[]; tracks: Track[]; queue: string[]; playback: Playback; devices: Device[]; room: { name: string; skin?: import('./appearance/RoomSkin').Skin }; serverTime: number }
export interface ServerInfo { name: string; version: string; urls: string[]; pairCode?: string; paired: boolean }
export interface RoomAction { playlistId?: string; deviceId?:string; type: string; trackId?: string; trackIds?: string[]; position?: number; value?: string | boolean | number }
export interface ImportResult {state:RoomState; imported:number; skipped:number; rejected:{name:string;reason:string}[]}
export interface ScannedFile {name:string;size:number;webkitRelativePath:string;scanIndex:number}
export type ImportFile = File | ScannedFile;
export interface ScanPolicy {history:string[];blocked:string[];skipShort:boolean}
export interface DesktopWindowState {fullscreen:boolean;maximized:boolean;alwaysOnTop:boolean}
declare global { interface Window {
  lumeScanRules:{snapshot:()=>ScanPolicy; remember:(folders:string[])=>void; block:(folder:string,enabled:boolean)=>void; covers:(parent:string,folder:string)=>boolean; migrate:(relative:string,absolute:string)=>void};
  lumeDesktop?: {
    getWindowState:()=>Promise<DesktopWindowState>;
    getSystemFonts:()=>Promise<string[]>;
    onWindowStateChange:(listener:(state:DesktopWindowState)=>void)=>()=>void;
    getFullscreen:()=>Promise<boolean>;
    setFullscreen:(value:boolean)=>Promise<void>;
    onFullscreenChange:(listener:(fullscreen:boolean)=>void)=>()=>void;
    getAlwaysOnTop:()=>Promise<boolean>;
    setAlwaysOnTop:(value:boolean)=>Promise<void>;
    onAlwaysOnTopChange:(listener:(alwaysOnTop:boolean)=>void)=>()=>void;
    pickScanFolder:(blockOnly:boolean)=>Promise<{root:string;name:string;token:string}|null>;
    scanEntries:(token:string,dir:string)=>Promise<{directories:string[];files:ScannedFile[];failed:number}>;
    scanBatch:(token:string,files:number[],attachments:number[],body:object)=>Promise<ImportResult>;
    endScan:(token:string)=>Promise<void>;
 readLyrics:(id:string)=>Promise<string>; importFiles:(files:File[],attachments:File[],body:{links:string;folders?:string})=>Promise<ImportResult>|null; joinRoom:(id:string)=>Promise<void>; platform: string; minimize: () => void; maximize: () => void; close: () => void; openWeb: () => void; } } }
