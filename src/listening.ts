import '../mobile/player-assets/player/listening.js';
export interface PlayRecord {session:string;id:string;title:string;startedAt:number;completed:boolean;completedAt?:number;listenedMs:number;days:Record<string,number>}
export interface ListeningData {days:Record<string,{starts:number;ms:number}>;records:PlayRecord[];now:number;playlists?:{id:string;name:string;trackIds?:string[];songs?:string[]}[]}
