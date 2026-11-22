export interface LyricRow {
  time:number;
  text:string;
  translation?:string;
  words?:{text:string;startTime:number;endTime?:number}[];
}
export function parseSongLyrics(content:string):{rows:LyricRow[];plain:string};
export function lyricLines(content:string):LyricRow[];
