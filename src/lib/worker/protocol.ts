import type { CategoryGuess, FontMetrics, Category } from "../analysis/metrics";
import type { AnalysisOptions, GlyphReport, StyleModel } from "../analysis/model";
import type { FontNames } from "../font/sfnt";
import type { TransferParams } from "../transform/params";
import type { TransferResult } from "../transform/font";
import type { RankEntry } from "../analysis/rank";

export interface FontInfo {
  family: string;
  style: string;
  upm: number;
  numGlyphs: number;
  axes: Record<string, { name: string; min: number; default: number; max: number }>;
  names: Record<number, string>;
}

export interface SourceInfo extends FontInfo {
  metrics: FontMetrics;
  guess: CategoryGuess;
  latinCount: number;
  /** mean outline length of a basic Latin glyph, 1000-em units */
  meanOutline: number;
}

export interface KhmerInfo extends FontInfo {
  metrics: FontMetrics;
  khmerGlyphs: number;
}

export type Req =
  | { id: number; type: "loadSource"; bytes: ArrayBuffer }
  | {
      id: number;
      type: "analyze";
      reference: { id: string; name: string; files: string[] };
      category: Category;
      options: AnalysisOptions;
    }
  | { id: number; type: "loadKhmer"; bytes?: ArrayBuffer; url?: string }
  | { id: number; type: "transfer"; params: TransferParams; names: FontNames }
  | { id: number; type: "woff"; ttf: Uint8Array }
  | { id: number; type: "rank"; references: { id: string; name: string; category: string; trait?: string; files: string[] }[] };

export type Res =
  | { id: number; type: "progress"; msg: string; frac: number }
  | { id: number; type: "error"; error: string }
  | { id: number; type: "sourceInfo"; info: SourceInfo }
  | { id: number; type: "analysis"; model: StyleModel; glyphs: GlyphReport[]; refNote: string }
  | { id: number; type: "khmerInfo"; info: KhmerInfo }
  | { id: number; type: "transfer"; result: TransferResult }
  | { id: number; type: "woff"; bytes: Uint8Array }
  | { id: number; type: "rank"; ranking: RankEntry[] };
